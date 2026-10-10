import {describe, expect, it} from 'vitest';
import {
    CONFIG_ENCRYPTION_ALGORITHM,
    CONFIG_ENCRYPTION_FORMAT,
    CONFIG_ENCRYPTION_VERSION,
    FLUENTREAD_CONFIG_ENCRYPTION_KEY,
    decryptConfigValue,
    encryptConfigValue,
    isEncryptedConfigPayload,
} from '@/src/platform/storage/configEncryption';

function flipLastByte(encoded: string): string {
    const bytes = Uint8Array.from(atob(encoded), character => character.charCodeAt(0));
    bytes[bytes.length - 1] ^= 1;
    return btoa(String.fromCharCode(...bytes));
}

describe('配置 AES-GCM 加密', () => {
    it('使用指定对称密钥往返完整 Unicode 配置，同时只暴露密文 envelope', async () => {
        const value = {
            service: 'openai',
            token: {openai: 'sk-sensitive-sentinel'},
            user_role: {openai: '请翻译成自然中文'},
            system_role: {openai: '你是专业译者'},
            sites: ['例子.测试'],
        };

        const encrypted = await encryptConfigValue(value);

        expect(FLUENTREAD_CONFIG_ENCRYPTION_KEY).toBe('FluentReadEncryption');
        expect(encrypted).toMatchObject({
            format: CONFIG_ENCRYPTION_FORMAT,
            version: CONFIG_ENCRYPTION_VERSION,
            algorithm: CONFIG_ENCRYPTION_ALGORITHM,
        });
        expect(JSON.stringify(encrypted)).not.toContain('sk-sensitive-sentinel');
        await expect(decryptConfigValue(encrypted)).resolves.toEqual(value);
    });

    it('相同明文每次生成不同 IV 和密文', async () => {
        const first = await encryptConfigValue({to: 'zh-Hans'});
        const second = await encryptConfigValue({to: 'zh-Hans'});

        expect(first.iv).not.toBe(second.iv);
        expect(first.ciphertext).not.toBe(second.ciphertext);
        await expect(decryptConfigValue(first)).resolves.toEqual({to: 'zh-Hans'});
        await expect(decryptConfigValue(second)).resolves.toEqual({to: 'zh-Hans'});
    });

    it('密钥、AAD、IV 或密文被替换时拒绝解密', async () => {
        const encrypted = await encryptConfigValue(
            {secret: 'value'},
            undefined,
            FLUENTREAD_CONFIG_ENCRYPTION_KEY,
            'FluentReadConfiguration\0local:config',
        );
        const tamperedCiphertext = {
            ...encrypted,
            ciphertext: flipLastByte(encrypted.ciphertext),
        };
        const tamperedIv = {
            ...encrypted,
            iv: flipLastByte(encrypted.iv),
        };

        await expect(decryptConfigValue(
            encrypted,
            undefined,
            'wrong-key',
            'FluentReadConfiguration\0local:config',
        )).rejects.toThrow('配置密文校验失败');
        await expect(decryptConfigValue(
            encrypted,
            undefined,
            FLUENTREAD_CONFIG_ENCRYPTION_KEY,
            'FluentReadConfiguration\0local:credentials',
        )).rejects.toThrow('配置密文校验失败');
        await expect(decryptConfigValue(
            tamperedCiphertext,
            undefined,
            FLUENTREAD_CONFIG_ENCRYPTION_KEY,
            'FluentReadConfiguration\0local:config',
        )).rejects.toThrow('配置密文校验失败');
        await expect(decryptConfigValue(
            tamperedIv,
            undefined,
            FLUENTREAD_CONFIG_ENCRYPTION_KEY,
            'FluentReadConfiguration\0local:config',
        )).rejects.toThrow('配置密文校验失败');
    });

    it('IV 编码以 AA 结尾时，相同编码仍能解密，单比特修改必须拒绝', async () => {
        const runtime = {
            crypto: {
                subtle: globalThis.crypto.subtle,
                getRandomValues: (bytes: Uint8Array) => bytes.fill(0),
            },
            encoder: new TextEncoder(),
            decoder: new TextDecoder(),
        } as unknown as Parameters<typeof encryptConfigValue>[1];
        const value = {secret: 'value'};
        const encrypted = await encryptConfigValue(value, runtime);
        const unchanged = {...encrypted, iv: `${encrypted.iv.slice(0, -2)}AA`};
        expect(unchanged.iv).toBe(encrypted.iv);
        await expect(decryptConfigValue(unchanged, runtime)).resolves.toEqual(value);

        const tampered = {...encrypted, iv: flipLastByte(encrypted.iv)};
        expect(tampered.iv).not.toBe(encrypted.iv);
        expect(atob(tampered.iv).length).toBe(atob(encrypted.iv).length);
        await expect(decryptConfigValue(tampered, runtime)).rejects.toThrow('配置密文校验失败');
    });

    it('拒绝未知格式、空字段、旧版本和解密后非 JSON 内容', async () => {
        const valid = await encryptConfigValue({on: true});
        expect(isEncryptedConfigPayload(null)).toBe(false);
        expect(isEncryptedConfigPayload([])).toBe(false);
        expect(isEncryptedConfigPayload({...valid, format: 'unknown'})).toBe(false);
        expect(isEncryptedConfigPayload({...valid, version: 2})).toBe(false);
        expect(isEncryptedConfigPayload({...valid, algorithm: 'AES-CBC'})).toBe(false);
        expect(isEncryptedConfigPayload({...valid, iv: ''})).toBe(false);
        expect(isEncryptedConfigPayload({...valid, ciphertext: ''})).toBe(false);
        await expect(decryptConfigValue({plaintext: {on: true}})).rejects.toThrow('配置密文格式无效');

        const nonJson = await encryptConfigValue('not-json');
        const invalidJsonRuntime = {
            crypto: {
                subtle: {
                    digest: globalThis.crypto.subtle.digest.bind(globalThis.crypto.subtle),
                    importKey: globalThis.crypto.subtle.importKey.bind(globalThis.crypto.subtle),
                    decrypt: async () => new TextEncoder().encode('not-json').buffer,
                },
            },
            encoder: new TextEncoder(),
            decoder: new TextDecoder(),
        } as unknown as Parameters<typeof decryptConfigValue>[1];
        await expect(decryptConfigValue(nonJson, invalidJsonRuntime)).rejects.toThrow('配置明文不是有效 JSON');
    });

    it('浏览器缺少 Web Crypto 时明确拒绝写入', async () => {
        const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
        Object.defineProperty(globalThis, 'crypto', {configurable: true, value: undefined});
        try {
            await expect(encryptConfigValue({on: true})).rejects.toThrow('不支持配置加密');
        } finally {
            if (descriptor) Object.defineProperty(globalThis, 'crypto', descriptor);
        }
    });
});
