import 'fake-indexeddb/auto';
import {afterEach, describe, expect, it, vi} from 'vitest';
import {prepareConfigForExport} from '@/src/core/config/transfer';
import {
    EncryptedConfigRepository,
    FluentReadConfigDatabase,
} from '@/src/platform/storage/configRepository';
import {
    createBackgroundConfigStorage,
    createSessionKeyMaterialProvider,
    type ConfigStoragePort,
    type LegacyConfigStoragePort,
} from '@/src/platform/storage/configStorage';

const harness = vi.hoisted(() => {
    const state = {storage: null as ConfigStoragePort | null};
    const proxy = {
        getItem: (key: string) => state.storage!.getItem(key),
        setItem: (key: string, value: unknown) => state.storage!.setItem(key, value),
        setItems: (entries: ReadonlyMap<string, unknown>, removeKeys?: readonly string[]) => (
            state.storage!.setItems!(entries, removeKeys)
        ),
        removeItem: (key: string) => state.storage!.removeItem(key),
        watch: (key: string, callback: (value: unknown, previous?: unknown) => void) => (
            state.storage!.watch(key, callback)
        ),
    };
    return {state, proxy};
});

vi.mock('@/src/platform/storage/configStorageRuntime', () => ({
    configStorage: harness.proxy,
}));

const databases: FluentReadConfigDatabase[] = [];

function createLegacy(initial: Record<string, unknown>): LegacyConfigStoragePort & {values: Map<string, unknown>} {
    const values = new Map(Object.entries(initial));
    return {
        values,
        async getItem<T>(key: string) { return (values.get(key) ?? null) as T | null; },
        async setItem<T>(key: string, value: T) { values.set(key, structuredClone(value)); },
        async removeItem(key: string) { values.delete(key); },
    };
}

async function loadConfigStore(storage: ConfigStoragePort) {
    harness.state.storage = storage;
    vi.resetModules();
    const store = await import('@/src/services/config/store');
    await Promise.all([store.configReady, store.configHistoryReady]);
    return store;
}

afterEach(async () => {
    harness.state.storage = null;
    vi.resetModules();
    await Promise.all(databases.splice(0).map(async database => {
        database.close();
        await database.delete();
    }));
});

describe('完整配置加密 IndexedDB 集成', () => {
    it('旧配置迁移、明文运行、导出、保存和重载形成完整闭环', async () => {
        Object.defineProperty(globalThis, 'location', {
            configurable: true,
            value: {protocol: 'chrome-extension:'},
        });
        const database = new FluentReadConfigDatabase(`FluentReadConfiguration-integration-${crypto.randomUUID()}`);
        databases.push(database);
        const legacySecret = 'integration-api-key-sensitive-sentinel';
        const userRole = 'integration-user-role-sensitive-sentinel {{text}}';
        const systemRole = 'integration-system-role-sensitive-sentinel';
        const legacy = createLegacy({
            'local:config': {
                on: true,
                service: 'openai',
                display: 1,
                from: 'auto',
                to: 'zh-Hans',
                token: {openai: legacySecret},
                appid: 'integration-app-id',
                key: 'integration-secret-key',
                user_role: {openai: userRole},
                system_role: {openai: systemRole},
                customBody: {openai: '{"temperature":0.2}'},
                alwaysTranslateDomains: ['example.com'],
            },
        });
        const firstRepository = new EncryptedConfigRepository({
            database,
            getSessionKeyMaterial: async () => 'browser-session-one',
        });
        const firstStorage = createBackgroundConfigStorage({repository: firstRepository, legacy});
        const first = await loadConfigStore(firstStorage);

        expect(first.config.token.openai).toBe(legacySecret);
        expect(first.config.user_role.openai).toBe(userRole);
        expect(first.config.system_role.openai).toBe(systemRole);
        expect(first.config.appid).toBe('integration-app-id');
        expect(first.config.key).toBe('integration-secret-key');
        expect(prepareConfigForExport(first.config)).toMatchObject({
            token: {openai: legacySecret},
            user_role: {openai: userRole},
            system_role: {openai: systemRole},
            appid: 'integration-app-id',
            key: 'integration-secret-key',
        });
        expect(legacy.values.size).toBe(0);

        await first.saveConfig({...first.config, to: 'ja'}, {recordHistory: true, immediateHistory: true});
        const rawAfterSave = await database.records.toArray();
        const rawJson = JSON.stringify(rawAfterSave);
        for (const sentinel of [legacySecret, userRole, systemRole, 'integration-secret-key']) {
            expect(rawJson).not.toContain(sentinel);
        }
        expect(rawAfterSave.map(record => record.key)).toEqual(expect.arrayContaining([
            'local:config',
            'local:credentials',
            'local:configHistory',
        ]));
        expect(rawAfterSave.map(record => record.key)).not.toContain('session:credentials');

        const sameSessionRepository = new EncryptedConfigRepository({
            database,
            getSessionKeyMaterial: async () => 'browser-session-one',
        });
        const reloaded = await loadConfigStore(createBackgroundConfigStorage({
            repository: sameSessionRepository,
            legacy,
        }));
        expect(reloaded.config.to).toBe('ja');
        expect(reloaded.config.token.openai).toBe(legacySecret);
        expect(reloaded.config.user_role.openai).toBe(userRole);

        const nextSessionRepository = new EncryptedConfigRepository({
            database,
            getSessionKeyMaterial: async () => 'browser-session-two',
        });
        const nextSession = await loadConfigStore(createBackgroundConfigStorage({
            repository: nextSessionRepository,
            legacy,
        }));
        expect(nextSession.config.to).toBe('ja');
        expect(nextSession.config.token.openai).toBe(legacySecret);
        expect(nextSession.config.user_role.openai).toBe(userRole);
        expect(nextSession.config.system_role.openai).toBe(systemRole);
        expect(nextSession.config.appid).toBe('integration-app-id');
        expect(nextSession.config.key).toBe('integration-secret-key');
        await expect(nextSessionRepository.get<Record<string, unknown>>('local:credentials'))
            .resolves.toMatchObject({
                token: {openai: legacySecret},
                appid: 'integration-app-id',
                key: 'integration-secret-key',
            });
        await expect(nextSessionRepository.get<Record<string, unknown>>('local:config'))
            .resolves.toMatchObject({
                user_role: {openai: userRole},
                system_role: {openai: systemRole},
            });
        expect(await database.records.get('session:credentials')).toBeUndefined();
    });

    it('旧 Firefox 无 storage.session 时 API Key 仍持久加密，并在后台重载后恢复', async () => {
        Object.defineProperty(globalThis, 'location', {
            configurable: true,
            value: {protocol: 'moz-extension:'},
        });
        const database = new FluentReadConfigDatabase(`FluentReadConfiguration-integration-${crypto.randomUUID()}`);
        databases.push(database);
        const legacyValues = new Map<string, unknown>([['local:config', {
            on: true,
            service: 'freeTranslation',
            display: 1,
            from: 'auto',
            to: 'zh-Hans',
        }]]);
        const legacy: LegacyConfigStoragePort = {
            async getItem<T>(key: string) {
                if (key.startsWith('session:')) throw new Error('browser.storage.session is undefined');
                return (legacyValues.get(key) ?? null) as T | null;
            },
            async setItem<T>(key: string, value: T) {
                if (key.startsWith('session:')) throw new Error('browser.storage.session is undefined');
                legacyValues.set(key, structuredClone(value));
            },
            async removeItem(key: string) { legacyValues.delete(key); },
        };
        const warn = vi.fn();
        const firstRepository = new EncryptedConfigRepository({
            database,
            getSessionKeyMaterial: createSessionKeyMaterialProvider(legacy, {
                allowMemoryFallback: true,
                logger: {warn},
            }),
        });
        const first = await loadConfigStore(createBackgroundConfigStorage({
            repository: firstRepository,
            legacy,
            logger: {warn},
        }));

        await first.saveConfig({...first.config, to: 'en'});
        expect(first.config.to).toBe('en');
        await expect(firstRepository.get<Record<string, unknown>>('local:config'))
            .resolves.toMatchObject({to: 'en'});

        const secret = 'firefox-persistent-credential-secret';
        await first.saveConfig({...first.config, token: {openai: secret}});
        expect(first.config.token.openai).toBe(secret);
        await expect(firstRepository.get<Record<string, unknown>>('local:credentials'))
            .resolves.toMatchObject({token: {openai: secret}});
        expect(await database.records.get('session:credentials')).toBeUndefined();
        expect(JSON.stringify(await database.records.toArray())).not.toContain(secret);

        const restartedRepository = new EncryptedConfigRepository({
            database,
            getSessionKeyMaterial: createSessionKeyMaterialProvider(legacy, {
                allowMemoryFallback: true,
                logger: {warn},
            }),
        });
        const restarted = await loadConfigStore(createBackgroundConfigStorage({
            repository: restartedRepository,
            legacy,
            logger: {warn},
        }));
        expect(restarted.config.to).toBe('en');
        expect(restarted.config.token.openai).toBe(secret);
        await expect(restartedRepository.get<Record<string, unknown>>('local:credentials'))
            .resolves.toMatchObject({token: {openai: secret}});
        expect(await database.records.get('session:credentials')).toBeUndefined();
        expect(warn).toHaveBeenCalledWith(
            expect.stringContaining('旧会话配置暂不可读'),
            expect.any(Error),
        );
    });
});
