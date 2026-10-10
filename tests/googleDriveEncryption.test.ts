import {afterEach, describe, expect, it, vi} from 'vitest';
import {decryptDriveConfig, DRIVE_ENCRYPTION_FORMAT, DRIVE_ENCRYPTION_ITERATIONS, encryptDriveConfig, encryptDrivePreview, decryptDrivePreview, validateDrivePassphrase} from '@/src/platform/google-drive/encryption';
import {GOOGLE_DRIVE_MAX_BYTES, GOOGLE_DRIVE_MAX_CONFIG_BYTES, GOOGLE_DRIVE_MAX_PREVIEW_BYTES} from '@/src/platform/google-drive/constants';

const password = 'fixture only long passphrase';
afterEach(() => vi.unstubAllGlobals());
describe('Google Drive 本机认证加密', () => {
    it('真实 Web Crypto 加密完整私密内容，随机化密文，并在另一端完整恢复', async () => {
        const value = {token: 'fixture-oauth-token', apiKeys: ['fixture-key'], headers: {Authorization: 'fixture-header'}, body: 'fixture-body', url: 'https://fixture.invalid/?auth=fixture-query'};
        const first = await encryptDriveConfig(value, password);
        const second = await encryptDriveConfig(value, password);
        expect(first).not.toBe(second);
        for (const privateValue of Object.values(value).flatMap(value => typeof value === 'string' ? [value] : Object.values(value))) expect(first).not.toContain(privateValue);
        expect(JSON.parse(first)).toMatchObject({format: DRIVE_ENCRYPTION_FORMAT, iterations: DRIVE_ENCRYPTION_ITERATIONS, cipher: 'AES-256-GCM'});
        expect(await decryptDriveConfig(first, password)).toEqual(value);
        await expect(decryptDriveConfig(first, 'a different fixture password')).rejects.toThrow('口令不正确');
        const tampered = JSON.parse(first);
        const bytes = Uint8Array.from(atob(tampered.ciphertext), c => c.charCodeAt(0));
        bytes[0] ^= 1;
        tampered.ciphertext = btoa(String.fromCharCode(...bytes));
        await expect(decryptDriveConfig(JSON.stringify(tampered), password)).rejects.toThrow('已损坏');
    });
    it('拒绝短口令、空格、超长口令和非字符串，保留合法口令的空格', async () => {
        for (const invalid of [null, 12, '', '12345678901', '            ', 'a'.repeat(1025)]) expect(() => validateDrivePassphrase(invalid)).toThrow('12');
        validateDrivePassphrase('123456789012');
        const content = await encryptDriveConfig({a: 1}, `  ${password}  `);
        await expect(decryptDriveConfig(content, password)).rejects.toThrow('口令不正确');
    });
    it('拒绝明文、降级版本、非法长度与无效编码', async () => {
        const content = await encryptDriveConfig({a: 1}, password);
        const envelope = JSON.parse(content);
        for (const invalid of ['broken', 'null', '[]', '{}', JSON.stringify({format: 'plaintext'}), JSON.stringify({...envelope, version: 2}), JSON.stringify({...envelope, kdf: 'none'}), JSON.stringify({...envelope, iterations: 1}), JSON.stringify({...envelope, cipher: 'AES-CBC'})]) await expect(decryptDriveConfig(invalid, password)).rejects.toThrow();
        for (const patch of [{salt: null}, {salt: '???'}, {salt: 'a'}, {salt: 'YQ=='}, {iv: 'YQ=='}, {ciphertext: 'YQ=='}, {ciphertext: 'YR=='}]) await expect(decryptDriveConfig(JSON.stringify({...envelope, ...patch}), password)).rejects.toThrow();
        await expect(decryptDriveConfig('x'.repeat(GOOGLE_DRIVE_MAX_BYTES + 1), password)).rejects.toThrow('过大');
        await expect(decryptDriveConfig(null as unknown as string, password)).rejects.toThrow('无效');
        await expect(encryptDriveConfig({x: 'x'.repeat(GOOGLE_DRIVE_MAX_BYTES)}, password)).rejects.toThrow('过大');
    });
    it('浏览器缺少 Web Crypto 时拒绝同步', async () => {
        vi.stubGlobal('crypto', undefined);
        await expect(encryptDriveConfig({a: 1}, password)).rejects.toThrow('安全加密');
        vi.stubGlobal('crypto', {});
        await expect(encryptDriveConfig({a: 1}, password)).rejects.toThrow('安全加密');
    });
    it('拒绝认证后仍不是有效 JSON 的负载', async () => {
        const content = await encryptDriveConfig(undefined, password);
        await expect(decryptDriveConfig(content, password)).rejects.toThrow('有效 JSON');
    });
    it('20 MiB 配置边界及预览独立预算，超过配置上限的暂存不能冒充云端配置', async () => {
        const value = {x: 'x'.repeat(GOOGLE_DRIVE_MAX_CONFIG_BYTES - 8)};
        const content = await encryptDriveConfig(value, password);
        expect(content.length).toBeLessThan(GOOGLE_DRIVE_MAX_BYTES);
        expect(await decryptDriveConfig(content, password)).toEqual(value);
        const transaction = await encryptDrivePreview({local: value, metadata: 'fixture'}, password);
        expect(await decryptDrivePreview(transaction, password)).toEqual({local: value, metadata: 'fixture'});
        await expect(decryptDriveConfig(transaction, password)).rejects.toThrow('过大');
        await expect(encryptDriveConfig({x: value.x + 'x'}, password)).rejects.toThrow('过大');
        await expect(encryptDrivePreview({x: 'x'.repeat(GOOGLE_DRIVE_MAX_PREVIEW_BYTES)}, password)).rejects.toThrow('过大');
    }, 30_000);
});
