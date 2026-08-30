import { beforeEach, describe, expect, it, vi } from 'vitest';
import { reactive } from 'vue';
import { normalizeConfig, type Config } from '@/src/core/config/model';
import { sanitizeConfigCredentials } from '@/src/core/config/credentials';

const storageMock = vi.hoisted(() => ({
    writeOwner: true,
    getItem: vi.fn(),
    setItem: vi.fn(),
    removeItem: vi.fn(),
    watch: vi.fn(),
}));
const atomicSetItemsMock = vi.hoisted(() => vi.fn());

vi.mock('@wxt-dev/storage', () => ({ storage: storageMock }));
vi.mock('@/src/platform/storage/configStorageRuntime', () => ({configStorage: storageMock}));

const storedConfig = {
    on: true,
    service: 'openai',
    from: 'auto',
    to: 'zh-Hans',
};

const storageState = new Map<string, unknown>();
const storageOperations: string[] = [];
const storageWatchers = new Map<string, (value: unknown) => void>();

interface LoadConfigOptions {
    trusted?: boolean;
    history?: unknown;
    sessionCredentials?: unknown;
    localCredentials?: unknown;
    configReadBarrier?: Promise<void>;
    localCredentialReadBarrier?: Promise<void>;
    failLocalCredentialRead?: boolean;
    failSessionRead?: boolean;
    failLocalCredentialWrite?: boolean;
    failLocalCredentialVerification?: boolean;
    atomicSetItems?: boolean;
    failAtomicCommit?: boolean;
    writeOwner?: boolean;
}

async function loadConfigModule(value: unknown = null, options: LoadConfigOptions = {}) {
    vi.resetModules();
    storageState.clear();
    storageOperations.length = 0;
    storageWatchers.clear();
    storageMock.writeOwner = options.writeOwner !== false;
    let localCredentialWritten = false;
    if (value !== null) storageState.set('local:config', value);
    if (options.history !== undefined) storageState.set('local:configHistory', options.history);
    if (options.sessionCredentials !== undefined) storageState.set('session:credentials', options.sessionCredentials);
    if (options.localCredentials !== undefined) storageState.set('local:credentials', options.localCredentials);
    Object.defineProperty(globalThis, 'location', {
        configurable: true,
        value: {protocol: options.trusted === false ? 'https:' : 'chrome-extension:'},
    });
    storageMock.getItem.mockReset().mockImplementation(async (key: string) => {
        storageOperations.push(`get:${key}`);
        if (key === 'local:config' && options.configReadBarrier) {
            await options.configReadBarrier;
        }
        if (key === 'local:credentials' && options.localCredentialReadBarrier) {
            await options.localCredentialReadBarrier;
        }
        if (options.failLocalCredentialRead && key === 'local:credentials') {
            throw new Error('storage.local credentials unavailable');
        }
        if (options.failLocalCredentialVerification && key === 'local:credentials' && localCredentialWritten) {
            return {token: {openai: 'stale-readback-secret'}};
        }
        if (options.failSessionRead && key === 'session:credentials') {
            throw new Error('storage.session unavailable');
        }
        return storageState.get(key) ?? null;
    });
    storageMock.setItem.mockReset().mockImplementation(async (key: string, nextValue: unknown) => {
        storageOperations.push(`set:${key}`);
        if (options.failLocalCredentialWrite && key === 'local:credentials') {
            throw new Error('persistent credentials unavailable');
        }
        if (key === 'local:credentials') localCredentialWritten = true;
        storageState.set(key, structuredClone(nextValue));
    });
    storageMock.removeItem.mockReset().mockImplementation(async (key: string) => {
        storageOperations.push(`remove:${key}`);
        storageState.delete(key);
    });
    atomicSetItemsMock.mockReset().mockImplementation(async (
        entries: ReadonlyMap<string, unknown>,
        removeKeys: readonly string[] = [],
    ) => {
        storageOperations.push(`setItems:${[...entries.keys()].join(',')}:${removeKeys.join(',')}`);
        if (options.failAtomicCommit) throw new Error('atomic commit unavailable');
        const nextState = new Map(storageState);
        for (const [key, nextValue] of entries) nextState.set(key, structuredClone(nextValue));
        for (const key of removeKeys) nextState.delete(key);
        storageState.clear();
        for (const [key, nextValue] of nextState) storageState.set(key, nextValue);
    });
    if (options.atomicSetItems) {
        (storageMock as typeof storageMock & {setItems?: typeof atomicSetItemsMock}).setItems = atomicSetItemsMock;
    } else {
        delete (storageMock as typeof storageMock & {setItems?: typeof atomicSetItemsMock}).setItems;
    }
    storageMock.watch.mockReset().mockImplementation((key: string, callback: (value: unknown) => void) => {
        storageWatchers.set(key, callback);
        return () => storageWatchers.delete(key);
    });
    return import('@/src/services/config/store');
}

describe('统一配置存储', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('兼容旧 JSON 字符串，并只迁移成一次对象存储', async () => {
        const configStore = await loadConfigModule(JSON.stringify(storedConfig));

        await configStore.configReady;

        expect(storageMock.setItem).toHaveBeenCalledTimes(1);
        expect(storageMock.setItem).toHaveBeenCalledWith(
            'local:config',
            expect.objectContaining(storedConfig),
        );
        expect(typeof storageMock.setItem.mock.calls[0][1]).toBe('object');
    });

    it('读取已经去凭据且带版本的规范化对象时不产生初始化回写', async () => {
        const canonicalConfig = {
            ...sanitizeConfigCredentials(normalizeConfig(storedConfig)),
            __fluentConfigRevision: 5,
        };
        const configStore = await loadConfigModule(canonicalConfig);

        await configStore.configReady;

        expect(storageMock.setItem).not.toHaveBeenCalled();
        expect(configStore.config).toMatchObject(storedConfig);
    });

    it('IndexedDB 已有相同持久凭据时直接水合，不在启动时重复写回', async () => {
        const secret = 'existing-persistent-secret';
        const canonicalConfig = {
            ...sanitizeConfigCredentials(normalizeConfig(storedConfig)),
            __fluentConfigRevision: 5,
        };
        const configStore = await loadConfigModule(canonicalConfig, {
            localCredentials: {token: {openai: secret}},
        });

        await configStore.configReady;

        expect(configStore.config.token.openai).toBe(secret);
        expect(storageMock.setItem).not.toHaveBeenCalled();
        expect(atomicSetItemsMock).not.toHaveBeenCalled();
        expect(storageMock.removeItem).not.toHaveBeenCalled();
    });

    it('可信扩展页面只从后台水合凭据，不重复执行迁移或直接写 IndexedDB', async () => {
        const secret = 'remote-extension-page-secret';
        const canonicalConfig = {
            ...sanitizeConfigCredentials(normalizeConfig(storedConfig)),
            __fluentConfigRevision: 5,
        };
        const configStore = await loadConfigModule(canonicalConfig, {
            writeOwner: false,
            localCredentials: {token: {openai: secret}},
        });

        await configStore.configReady;
        expect(configStore.config.token.openai).toBe(secret);
        expect(storageMock.setItem).not.toHaveBeenCalled();
        expect(storageMock.removeItem).not.toHaveBeenCalled();
        await expect(configStore.saveConfig({...configStore.config, to: 'en'}))
            .rejects.toThrow('必须通过后台配置协议保存');
    });

    it('可信页面水合凭据期间收到更高配置 revision 时整轮重读，不用旧快照回滚', async () => {
        let releaseCredentialRead!: () => void;
        const credentialReadBarrier = new Promise<void>(resolve => {
            releaseCredentialRead = resolve;
        });
        const oldConfig = {
            ...sanitizeConfigCredentials(normalizeConfig({...storedConfig, to: 'en'})),
            __fluentConfigRevision: 4,
        };
        const nextConfig = {
            ...sanitizeConfigCredentials(normalizeConfig({...storedConfig, to: 'ja'})),
            __fluentConfigRevision: 5,
        };
        const configStore = await loadConfigModule(oldConfig, {
            writeOwner: false,
            localCredentialReadBarrier: credentialReadBarrier,
        });
        await vi.waitFor(() => {
            expect(storageOperations).toContain('get:local:credentials');
            expect(storageWatchers.has('local:config')).toBe(true);
        });

        storageState.set('local:config', nextConfig);
        storageWatchers.get('local:config')!(nextConfig);
        expect(configStore.config.to).toBe('ja');
        releaseCredentialRead();
        await configStore.configReady;

        expect(configStore.config.to).toBe('ja');
        expect(configStore.getConfigRevision()).toBe(5);
        expect(storageOperations.filter(operation => operation === 'get:local:config').length).toBeGreaterThan(1);
        expect(storageMock.setItem).not.toHaveBeenCalled();
    });

    it('凭据水合失败前收到更高 revision 时 fallback 也采用最新公开配置', async () => {
        let releaseCredentialRead!: () => void;
        const credentialReadBarrier = new Promise<void>(resolve => {
            releaseCredentialRead = resolve;
        });
        const oldConfig = {
            ...sanitizeConfigCredentials(normalizeConfig({...storedConfig, to: 'en'})),
            __fluentConfigRevision: 4,
        };
        const nextConfig = {
            ...sanitizeConfigCredentials(normalizeConfig({...storedConfig, to: 'ja'})),
            __fluentConfigRevision: 5,
        };
        const configStore = await loadConfigModule(oldConfig, {
            writeOwner: false,
            localCredentialReadBarrier: credentialReadBarrier,
            failLocalCredentialRead: true,
        });
        await vi.waitFor(() => {
            expect(storageOperations).toContain('get:local:credentials');
            expect(storageWatchers.has('local:config')).toBe(true);
        });

        storageState.set('local:config', nextConfig);
        storageWatchers.get('local:config')!(nextConfig);
        expect(configStore.config.to).toBe('ja');
        releaseCredentialRead();
        await configStore.configReady;

        expect(configStore.config.to).toBe('ja');
        expect(configStore.getConfigRevision()).toBe(5);
        expect(storageOperations.filter(operation => operation === 'get:local:config').length).toBeGreaterThan(1);
        expect(storageMock.setItem).not.toHaveBeenCalled();
        const sendMessage = vi.fn();
        await expect(configStore.requestConfigSave({...configStore.config, to: 'zh-Hans'}, sendMessage))
            .rejects.toThrow('配置安全水合未完成');
        expect(sendMessage).not.toHaveBeenCalled();
    });

    it('可信远程页迁移旧策略时无法读取 session 凭据会拒绝发送可能清空 API Key 的保存请求', async () => {
        const canonicalConfig = {
            ...sanitizeConfigCredentials(normalizeConfig(storedConfig)),
            persistCredentials: false,
            __fluentConfigRevision: 5,
        };
        const configStore = await loadConfigModule(canonicalConfig, {
            writeOwner: false,
            failSessionRead: true,
        });
        await configStore.configReady;
        const sendMessage = vi.fn();

        await expect(configStore.requestConfigSave({...configStore.config, to: 'en'}, sendMessage))
            .rejects.toThrow('配置安全水合未完成');
        expect(sendMessage).not.toHaveBeenCalled();
    });

    it('为旧配置补齐空的始终翻译域名列表，并只迁移回写一次', async () => {
        const legacyConfig = normalizeConfig(storedConfig) as unknown as Record<string, unknown>;
        delete legacyConfig.alwaysTranslateDomains;
        delete legacyConfig.disabledExtensionDomains;
        const configStore = await loadConfigModule(legacyConfig);

        await configStore.configReady;

        expect(configStore.config.alwaysTranslateDomains).toEqual([]);
        expect(configStore.config.disabledExtensionDomains).toEqual([]);
        const localConfigWrites = storageMock.setItem.mock.calls.filter(([key]) => key === 'local:config');
        expect(localConfigWrites).toHaveLength(1);
        expect(localConfigWrites[0][1]).toEqual(expect.objectContaining({alwaysTranslateDomains: []}));
        expect(localConfigWrites[0][1]).toEqual(expect.objectContaining({disabledExtensionDomains: []}));
    });

    it('内部 storage revision 不进入运行时配置或历史快照', async () => {
        const configStore = await loadConfigModule({...storedConfig, __fluentConfigRevision: 5});
        await Promise.all([configStore.configReady, configStore.configHistoryReady]);

        expect((configStore.config as unknown as Record<string, unknown>).__fluentConfigRevision).toBeUndefined();
        await configStore.saveConfig({ ...configStore.config, to: 'en' }, {recordHistory: true, immediateHistory: true});

        const history = configStore.getConfigHistorySnapshot();
        expect(history.entries).toHaveLength(2);
        expect((history.entries[0].config as unknown as Record<string, unknown>).__fluentConfigRevision).toBeUndefined();
        expect((history.entries[1].config as unknown as Record<string, unknown>).__fluentConfigRevision).toBeUndefined();
    });

    it('为旧配置补齐默认关闭的视频字幕 Beta、独立微软翻译服务和默认字号', async () => {
        const configStore = await loadConfigModule(storedConfig);

        await configStore.configReady;

        expect(configStore.config.videoTranslationEnabled).toBe(false);
        expect(configStore.config.videoService).toBe('microsoft');
        expect(configStore.config.videoSubtitleVisible).toBe(true);
        expect(configStore.config.videoSubtitleDisplayMode).toBe('bilingual');
        expect(configStore.config.videoSubtitleFontSize).toBe(100);
        expect(configStore.config.fullPageTranslationMode).toBe('viewport');
    });

    it('为文档翻译补齐独立服务和模型，并保留网页模型选择', async () => {
        const configStore = await loadConfigModule({
            ...storedConfig,
            service: 'openai',
            model: {openai: 'web-model'},
            documentService: 'openai',
            documentModel: {openai: 'document-model'},
        });

        await configStore.configReady;

        expect(configStore.config.documentService).toBe('openai');
        expect(configStore.config.documentModel.openai).toBe('document-model');
        expect(configStore.config.model.openai).toBe('web-model');
    });

    it('文档翻译遇到未知服务时回退到免费翻译服务', async () => {
        const configStore = await loadConfigModule({...storedConfig, documentService: 'unknown-service'});

        await configStore.configReady;

        expect(configStore.config.documentService).toBe('freeTranslation');
    });

    it('保留用户选择的视频 AI 服务，并将未知服务回退到微软翻译', async () => {
        const aiConfigStore = await loadConfigModule({ ...storedConfig, videoService: 'openai' });

        await aiConfigStore.configReady;

        expect(aiConfigStore.config.videoService).toBe('openai');

        const invalidConfigStore = await loadConfigModule({ ...storedConfig, videoService: 'not-a-service' });

        await invalidConfigStore.configReady;

        expect(invalidConfigStore.config.videoService).toBe('microsoft');
    });

    it('把早期 Beta 写入的 DeepLX 默认值一次迁移为微软翻译', async () => {
        const configStore = await loadConfigModule({ ...storedConfig, videoService: 'deeplx' });

        await configStore.configReady;

        expect(configStore.config.videoService).toBe('microsoft');
        expect(configStore.config.videoServiceDefaultMigrated).toBe(true);
        expect(storageMock.setItem).toHaveBeenCalledWith(
            'local:config',
            expect.objectContaining({ videoService: 'microsoft', videoServiceDefaultMigrated: true }),
        );
    });

    it('非法的视频字幕显示配置回退到双语和显示状态', async () => {
        const configStore = await loadConfigModule({
            ...storedConfig,
            videoSubtitleVisible: 'yes',
            videoSubtitleDisplayMode: 'side-by-side',
            videoSubtitleFontSize: 'huge',
        });

        await configStore.configReady;

        expect(configStore.config.videoSubtitleVisible).toBe(true);
        expect(configStore.config.videoSubtitleDisplayMode).toBe('bilingual');
        expect(configStore.config.videoSubtitleFontSize).toBe(100);
    });

    it('存储内容损坏时回退到默认配置，并保持初始化 Promise 可用', async () => {
        const configStore = await loadConfigModule('{not-json');

        await expect(configStore.configReady).resolves.toBeUndefined();

        expect(configStore.config.on).toBe(true);
        expect(storageMock.setItem).toHaveBeenCalledWith(
            'local:config',
            expect.objectContaining({ on: true }),
        );
    });

    it('保存相同快照时去重，并让连续保存只保留最新快照', async () => {
        const configStore = await loadConfigModule(storedConfig);
        await configStore.configReady;
        storageMock.setItem.mockClear();

        const firstSave = configStore.saveConfig({ ...configStore.config, on: false });
        const latestSave = configStore.saveConfig({ ...configStore.config, on: true, to: 'en' });
        await Promise.all([firstSave, latestSave]);

        expect(storageMock.setItem.mock.calls.filter(([key]) => key === 'local:config')).toHaveLength(1);
        expect(storageMock.setItem).toHaveBeenCalledWith(
            'local:config',
            expect.objectContaining({ on: true, to: 'en' }),
        );
        expect(storageMock.setItem).toHaveBeenCalledWith(
            'local:credentials',
            expect.objectContaining({token: {}}),
        );

        storageMock.setItem.mockClear();
        await configStore.saveConfig({ ...configStore.config, on: true, to: 'en' });
        expect(storageMock.setItem).not.toHaveBeenCalled();
    });

    it('收到外部对象更新时立即同步运行时状态，并通知订阅者', async () => {
        const configStore = await loadConfigModule(storedConfig);
        await configStore.configReady;
        const listener = vi.fn();
        const unsubscribe = configStore.subscribeConfig(listener);
        const watchCallback = storageMock.watch.mock.calls[0][1];

        watchCallback({ ...storedConfig, on: false }, storedConfig);

        expect(configStore.config.on).toBe(false);
        expect(listener).toHaveBeenCalledWith(expect.objectContaining({ on: false }));
        unsubscribe();
    });

    it('外部更新不会被本地 watcher 再次写回，取消订阅后也不再通知', async () => {
        const configStore = await loadConfigModule(storedConfig);
        await configStore.configReady;
        const listener = vi.fn();
        const unsubscribe = configStore.subscribeConfig(listener);
        const watchCallback = storageMock.watch.mock.calls[0][1];
        listener.mockClear();
        storageMock.setItem.mockClear();

        watchCallback({ ...storedConfig, on: false }, storedConfig);
        unsubscribe();
        watchCallback({ ...storedConfig, on: true }, { ...storedConfig, on: false });

        expect(storageMock.setItem).not.toHaveBeenCalled();
        expect(listener).toHaveBeenCalledTimes(1);
    });

    it('短生命周期页面通过后台提交规范化快照，而不是自行承担落盘', async () => {
        const configStore = await loadConfigModule(storedConfig);
        await configStore.configReady;
        storageMock.setItem.mockClear();
        const sendMessage = vi.fn().mockResolvedValue({ success: true, revision: 2 });

        await configStore.requestConfigSave({ ...configStore.config, to: 'en' }, sendMessage);

        expect(sendMessage).toHaveBeenCalledWith(expect.objectContaining({
            type: configStore.CONFIG_PERSIST_MESSAGE,
            config: expect.objectContaining({ to: 'en' }),
            baseRevision: 1,
        }));
        expect(configStore.getConfigRevision()).toBe(2);
        expect(storageMock.setItem).not.toHaveBeenCalled();
    });

    it('翻译计数使用同 revision 的原子增量，不生成用户配置历史版本', async () => {
        const canonical = sanitizeConfigCredentials(normalizeConfig(storedConfig));
        const configStore = await loadConfigModule({...canonical, count: 10, __fluentConfigRevision: 4});
        await Promise.all([configStore.configReady, configStore.configHistoryReady]);
        const historyBefore = configStore.getConfigHistorySnapshot();

        await expect(configStore.incrementConfigCount(3, 'count-operation-1')).resolves.toBe(13);
        await expect(configStore.incrementConfigCount(3, 'count-operation-1')).resolves.toBe(13);

        expect(configStore.config.count).toBe(13);
        expect(storageState.get('local:config')).toMatchObject({
            count: 13,
            __fluentConfigRevision: 4,
            __fluentCountOperations: [{id: 'count-operation-1', delta: 3, count: 13}],
        });
        expect(configStore.getConfigRevision()).toBe(4);
        expect(configStore.getConfigHistorySnapshot()).toEqual(historyBefore);
        await expect(configStore.incrementConfigCount(0)).rejects.toThrow('无效的翻译计数增量');
        await expect(configStore.incrementConfigCount(1, 'count-operation-1'))
            .rejects.toThrow('操作标识与增量不一致');

        await configStore.saveConfig({...configStore.config, count: 1, to: 'en'}, {
            recordHistory: true,
            immediateHistory: true,
        });
        expect(configStore.config.count).toBe(13);
        expect(storageState.get('local:config')).toMatchObject({count: 13, to: 'en'});

        const persistedAfterSave = structuredClone(storageState.get('local:config'));
        const restartedStore = await loadConfigModule(persistedAfterSave);
        await restartedStore.configReady;
        storageMock.setItem.mockClear();
        await expect(restartedStore.incrementConfigCount(3, 'count-operation-1')).resolves.toBe(13);
        expect(restartedStore.config.count).toBe(13);
        expect(storageMock.setItem).not.toHaveBeenCalled();
    });

    it.each([
        ['旧 session 读取', {failSessionRead: true}],
        ['local 检查点写入', {failLocalCredentialWrite: true}],
    ] as const)('后台重启后%s失败仍先水合计数操作日志', async (_failure, failureOptions) => {
        let releaseConfigRead!: () => void;
        const configReadBarrier = new Promise<void>((resolve) => { releaseConfigRead = resolve; });
        const secret = 'count-restart-session-secret';
        const persisted = {
            ...sanitizeConfigCredentials(normalizeConfig(storedConfig)),
            token: {openai: secret},
            persistCredentials: false,
            count: 13,
            __fluentConfigRevision: 4,
            __fluentCountOperations: [{id: 'count-restart-operation', delta: 3, count: 13}],
        };
        const restartedStore = await loadConfigModule(persisted, {...failureOptions, configReadBarrier});
        const retry = restartedStore.incrementConfigCount(3, 'count-restart-operation');

        releaseConfigRead();
        await expect(retry).resolves.toBe(13);
        await expect(restartedStore.configReady).resolves.toBeUndefined();

        expect(restartedStore.config.count).toBe(13);
        expect(storageMock.setItem.mock.calls.filter(([key]) => key === 'local:config')).toHaveLength(0);
        expect(storageState.get('local:config')).toEqual(persisted);
        expect(restartedStore.config.token.openai).toBe(secret);
        await expect(restartedStore.incrementConfigCount(1, 'count-new-operation'))
            .rejects.toThrow('配置安全迁移未完成');
        expect(storageState.get('local:config')).toEqual(persisted);
    });

    it('凭据载体读取失败时保留已读取的公开配置并禁止覆盖旧存储', async () => {
        const secret = 'unread-local-credential-secret';
        const persisted = {
            ...sanitizeConfigCredentials(normalizeConfig({...storedConfig, to: 'ja'})),
            token: {openai: secret},
            count: 21,
            __fluentConfigRevision: 7,
            __fluentCountOperations: [{id: 'count-before-credential-read-failure', delta: 1, count: 21}],
        };
        const configStore = await loadConfigModule(persisted, {failLocalCredentialRead: true});

        await expect(configStore.configReady).resolves.toBeUndefined();
        expect(configStore.config).toMatchObject({to: 'ja', count: 21});
        expect(configStore.config.token).toEqual({});
        await expect(configStore.incrementConfigCount(1, 'count-after-credential-read-failure'))
            .rejects.toThrow('配置安全迁移未完成');
        await expect(configStore.saveConfig({...configStore.config, to: 'ko'}))
            .rejects.toThrow('配置安全迁移未完成');
        expect(storageState.get('local:config')).toEqual(persisted);
        expect(storageMock.removeItem).not.toHaveBeenCalled();
    });

    it('计数增量请求只发送 delta，并校验后台响应', async () => {
        const configStore = await loadConfigModule(storedConfig);
        await configStore.configReady;
        const sendMessage = vi.fn().mockResolvedValue({success: true, count: 7});

        await expect(configStore.requestConfigCountIncrement(2, sendMessage, 'count-request-1')).resolves.toBe(7);
        expect(sendMessage).toHaveBeenCalledWith({
            type: 'incrementConfigCount',
            delta: 2,
            operationId: 'count-request-1',
        });
        await expect(configStore.requestConfigCountIncrement(0, sendMessage, 'count-request-2'))
            .rejects.toThrow('无效的翻译计数增量');
        await expect(configStore.requestConfigCountIncrement(1, vi.fn().mockResolvedValue({success: false, error: 'failed'}), 'count-request-3'))
            .rejects.toThrow('failed');
        await expect(configStore.requestConfigCountIncrement(1, vi.fn().mockResolvedValue({success: true}), 'count-request-4'))
            .rejects.toThrow('没有返回结果');
    });

    it('计数累加拒绝运行时畸形值和安全整数溢出，失败时不写存储', async () => {
        const configStore = await loadConfigModule({...storedConfig, count: Number.MAX_SAFE_INTEGER});
        await configStore.configReady;
        storageMock.setItem.mockClear();

        await expect(configStore.incrementConfigCount(1, 'count-overflow-operation'))
            .rejects.toThrow('超过安全整数范围');
        expect(configStore.config.count).toBe(Number.MAX_SAFE_INTEGER);
        expect(storageMock.setItem).not.toHaveBeenCalled();

        configStore.config.count = -1;
        await expect(configStore.incrementConfigCount(1, 'count-invalid-current-operation'))
            .rejects.toThrow('不是非负安全整数');
        expect(storageMock.setItem).not.toHaveBeenCalled();
    });

    it('后台拒绝旧 revision 时重新读取最新配置，而不是保留会再次覆盖的旧快照', async () => {
        const canonical = sanitizeConfigCredentials(normalizeConfig(storedConfig));
        const configStore = await loadConfigModule({...canonical, __fluentConfigRevision: 4});
        await configStore.configReady;
        const sendMessage = vi.fn().mockImplementation(async () => {
            storageState.set('local:config', {...canonical, to: 'ja', __fluentConfigRevision: 5});
            return {success: false, error: '配置已更新（当前 revision 5）'};
        });

        await expect(configStore.requestConfigSave({...configStore.config, to: 'en'}, sendMessage))
            .rejects.toThrow('当前 revision 5');

        expect(sendMessage).toHaveBeenCalledWith(expect.objectContaining({baseRevision: 4}));
        expect(configStore.config.to).toBe('ja');
        expect(configStore.getConfigRevision()).toBe(5);
    });

    it('local config 写入失败不提前发布 revision，随后可以从原版本重试', async () => {
        const canonical = sanitizeConfigCredentials(normalizeConfig(storedConfig));
        const configStore = await loadConfigModule({...canonical, __fluentConfigRevision: 4});
        await configStore.configReady;
        let failNextConfigWrite = true;
        storageMock.setItem.mockImplementation(async (key: string, nextValue: unknown) => {
            storageOperations.push(`set:${key}`);
            if (key === 'local:config' && failNextConfigWrite) {
                failNextConfigWrite = false;
                throw new Error('temporary local storage failure');
            }
            storageState.set(key, structuredClone(nextValue));
        });

        await expect(configStore.saveConfig({...configStore.config, to: 'en'}))
            .rejects.toThrow('temporary local storage failure');
        expect(configStore.getConfigRevision()).toBe(4);
        expect(storageState.get('local:config')).toMatchObject({to: 'zh-Hans', __fluentConfigRevision: 4});

        await expect(configStore.saveConfig({...configStore.config, to: 'ja'})).resolves.toBeUndefined();
        expect(configStore.getConfigRevision()).toBe(5);
        expect(storageState.get('local:config')).toMatchObject({to: 'ja', __fluentConfigRevision: 5});
    });

    it('发送响应式配置时先转换为 Firefox 可结构化克隆的纯对象', async () => {
        const configStore = await loadConfigModule(storedConfig);
        await configStore.configReady;
        const sendMessage = vi.fn(async ({baseRevision}: {baseRevision: number; config: Config}) => ({
            success: true,
            revision: baseRevision + 1,
        }));
        const reactiveConfig = reactive({
            ...configStore.config,
            to: 'ja',
            model: reactive({ openai: 'gpt-4o-mini' }),
        });

        await configStore.requestConfigSave(reactiveConfig, sendMessage);

        const sentConfig = sendMessage.mock.calls[0][0].config;
        expect(() => structuredClone(sentConfig)).not.toThrow();
        expect(sentConfig).toMatchObject({ to: 'ja', model: { openai: 'gpt-4o-mini' } });
    });

    it('后台不可用时失败关闭，不在短生命周期上下文降级落盘', async () => {
        const configStore = await loadConfigModule(storedConfig);
        await configStore.configReady;
        storageMock.setItem.mockClear();
        const sendMessage = vi.fn().mockRejectedValue(new Error('Receiving end does not exist'));

        await expect(configStore.requestConfigSave({ ...configStore.config, to: 'ja' }, sendMessage))
            .rejects.toThrow('Receiving end does not exist');
        expect(storageMock.setItem).not.toHaveBeenCalled();
    });

    it('content 保存公开字段时保留后台运行时凭据并忽略旧持久化策略字段', async () => {
        const configStore = await loadConfigModule(storedConfig);
        await configStore.configReady;
        const current = normalizeConfig({
            ...configStore.config,
            token: {openai: 'background-session-secret'},
            extra: {zhipu: {jwt: 'derived-secret'}},
            persistCredentials: true,
            count: 42,
            videoServiceDefaultMigrated: true,
        });
        const contentSnapshot = normalizeConfig({
            ...current,
            to: 'ja',
            token: {},
            extra: {},
            persistCredentials: false,
            count: 1,
            videoServiceDefaultMigrated: false,
        });

        const prepared = configStore.prepareConfigSaveRequest(contentSnapshot, current, false);
        const extensionPrepared = configStore.prepareConfigSaveRequest(contentSnapshot, current, true);

        expect(prepared).toMatchObject({
            to: 'ja',
            token: {openai: 'background-session-secret'},
            extra: {zhipu: {jwt: 'derived-secret'}},
            count: 42,
            videoServiceDefaultMigrated: true,
        });
        expect(prepared).not.toHaveProperty('persistCredentials');
        expect(extensionPrepared.token).toEqual({});
        expect(extensionPrepared.extra).toEqual({});
        expect(extensionPrepared).not.toHaveProperty('persistCredentials');
        expect(extensionPrepared.count).toBe(42);
        expect(extensionPrepared.videoServiceDefaultMigrated).toBe(true);
    });

    it('字段补丁只接受已知目标字段，并保留最新配置、统计、迁移状态与 content 凭据边界', async () => {
        const configStore = await loadConfigModule(storedConfig);
        await configStore.configReady;
        const current = normalizeConfig({
            ...configStore.config,
            to: 'ja',
            theme: 'dark',
            videoTranslationEnabled: true,
            videoSubtitleVisible: true,
            count: 42,
            token: {openai: 'background-secret'},
            futureNonSensitiveSetting: {enabled: true},
        });

        const contentPrepared = configStore.prepareConfigPatchRequest({
            videoSubtitleVisible: false,
            count: 0,
            videoServiceDefaultMigrated: false,
            token: {openai: 'content-stale-secret'},
            unknownFutureToggle: true,
        }, {
            videoSubtitleVisible: true,
        }, current, false);
        const extensionPrepared = configStore.prepareConfigPatchRequest({
            token: {openai: 'new-extension-secret'},
        }, {
            token: {openai: 'background-secret'},
        }, current, true);

        expect(contentPrepared).toMatchObject({
            to: 'ja',
            theme: 'dark',
            videoTranslationEnabled: true,
            videoSubtitleVisible: false,
            count: 42,
            videoServiceDefaultMigrated: true,
            token: {openai: 'background-secret'},
        });
        expect(contentPrepared).not.toHaveProperty('unknownFutureToggle');
        expect(contentPrepared).toHaveProperty('futureNonSensitiveSetting', {enabled: true});
        expect(extensionPrepared.token).toEqual({openai: 'new-extension-secret'});
        expect(extensionPrepared.count).toBe(42);
        expect(() => configStore.prepareConfigPatchRequest({
            videoSubtitleVisible: false,
        }, {
            videoSubtitleVisible: false,
        }, current, false)).toThrow('videoSubtitleVisible');
        expect(() => configStore.prepareConfigPatchRequest({
            videoSubtitleVisible: true,
        }, {
            videoSubtitleVisible: false,
        }, current, false)).toThrow('videoSubtitleVisible');
    });

    it('字段补丁先乐观更新，后台失败后回读权威快照并自动回滚', async () => {
        const canonical = sanitizeConfigCredentials(normalizeConfig({
            ...storedConfig,
            videoTranslationEnabled: false,
        }));
        const configStore = await loadConfigModule({...canonical, __fluentConfigRevision: 4});
        await configStore.configReady;
        const sendMessage = vi.fn(async (message: {
            mode?: string;
            config: Config;
            expected?: Config;
            baseRevision: number;
        }) => {
            expect(configStore.config.videoTranslationEnabled).toBe(true);
            expect(message).toMatchObject({
                mode: 'patch',
                config: {videoTranslationEnabled: true},
                expected: {videoTranslationEnabled: false},
                baseRevision: 4,
            });
            return {success: false, error: 'patch failed'};
        });

        await expect(configStore.requestConfigPatch({
            videoTranslationEnabled: true,
            unknownFutureToggle: true,
        }, sendMessage)).rejects.toThrow('patch failed');

        expect(configStore.config.videoTranslationEnabled).toBe(false);
        expect(configStore.getConfigRevision()).toBe(4);
        expect(configStore.config).not.toHaveProperty('unknownFutureToggle');
    });

    it('字段补丁确认回声不重复 apply 或通知订阅者', async () => {
        const canonical = sanitizeConfigCredentials(normalizeConfig({
            ...storedConfig,
            videoTranslationEnabled: false,
        }));
        const configStore = await loadConfigModule({...canonical, __fluentConfigRevision: 4});
        await configStore.configReady;
        const listener = vi.fn();
        const unsubscribe = configStore.subscribeConfig(listener);
        listener.mockClear();
        const sendMessage = vi.fn(async () => {
            expect(configStore.config.videoTranslationEnabled).toBe(true);
            expect(listener).toHaveBeenCalledOnce();
            const committed = {
                ...canonical,
                videoTranslationEnabled: true,
                __fluentConfigRevision: 5,
            };
            storageState.set('local:config', committed);
            storageWatchers.get('local:config')!(committed);
            return {success: true, revision: 5};
        });

        await configStore.requestConfigPatch({videoTranslationEnabled: true}, sendMessage);

        expect(configStore.config.videoTranslationEnabled).toBe(true);
        expect(configStore.getConfigRevision()).toBe(5);
        expect(listener).toHaveBeenCalledOnce();
        unsubscribe();
    });

    it('字段补丁冲突后回读同字段的权威新值', async () => {
        const canonical = sanitizeConfigCredentials(normalizeConfig(storedConfig));
        const configStore = await loadConfigModule({...canonical, __fluentConfigRevision: 4});
        await configStore.configReady;
        const sendMessage = vi.fn(async (message: {
            mode?: string;
            config: Config;
            expected?: Config;
            baseRevision: number;
        }) => {
            expect(configStore.config.to).toBe('ja');
            expect(message).toMatchObject({
                mode: 'patch',
                config: {to: 'ja'},
                expected: {to: 'zh-Hans'},
                baseRevision: 4,
            });
            storageState.set('local:config', {
                ...canonical,
                to: 'ko',
                __fluentConfigRevision: 5,
            });
            return {success: false, error: '配置字段已更新，请同步后重试：to'};
        });

        await expect(configStore.requestConfigPatch({to: 'ja'}, sendMessage))
            .rejects.toThrow('to');

        expect(configStore.config.to).toBe('ko');
        expect(configStore.getConfigRevision()).toBe(5);
    });

    it('先写入并读回 local 凭据，再清理旧 config/history 明文', async () => {
        const secret = 'legacy-secret-sentinel';
        const legacyConfig = {
            ...storedConfig,
            token: {openai: secret},
            ak: `${secret}-ak`,
            extra: {jwt: `${secret}-jwt`},
        };
        const legacyHistory = {
            schemaVersion: 1,
            entries: [{version: 1, savedAt: new Date(0).toISOString(), config: legacyConfig}],
            cursor: 0,
            nextVersion: 2,
        };
        const configStore = await loadConfigModule(legacyConfig, {history: legacyHistory});

        await configStore.configReady;

        const setLocal = storageOperations.indexOf('set:local:credentials');
        const verifyLocal = storageOperations.indexOf('get:local:credentials', setLocal + 1);
        const setConfig = storageOperations.indexOf('set:local:config');
        const setHistory = storageOperations.indexOf('set:local:configHistory');
        expect(setLocal).toBeGreaterThan(-1);
        expect(verifyLocal).toBeGreaterThan(setLocal);
        expect(setHistory).toBeGreaterThan(verifyLocal);
        expect(setConfig).toBeGreaterThan(setHistory);
        expect(storageState.get('local:credentials')).toMatchObject({token: {openai: secret}});
        expect(storageState.has('session:credentials')).toBe(false);
        expect(JSON.stringify(storageState.get('local:config'))).not.toContain(secret);
        expect(JSON.stringify(storageState.get('local:configHistory'))).not.toContain(secret);
    });

    it('损坏的旧历史字符串可能包含凭据时直接丢弃，不能把敏感片段原样写回', async () => {
        const secret = 'malformed-history-secret-sentinel';
        const legacyConfig = {...storedConfig, token: {openai: secret}};
        const malformedHistory = `{"entries":[{"config":{"token":{"openai":"${secret}"}}}`;
        const configStore = await loadConfigModule(legacyConfig, {history: malformedHistory});

        await configStore.configReady;

        expect(storageState.has('local:configHistory')).toBe(false);
        expect(JSON.stringify([...storageState.values()])).not.toContain(malformedHistory);
        expect(storageState.get('local:credentials')).toMatchObject({token: {openai: secret}});
    });

    it('默认把新凭据加密持久保存到 local，公开配置与历史不含敏感 sentinel', async () => {
        const configStore = await loadConfigModule(storedConfig);
        await Promise.all([configStore.configReady, configStore.configHistoryReady]);
        const secret = 'persistent-secret-sentinel';

        await configStore.saveConfig({
            ...configStore.config,
            token: {openai: secret},
            to: 'en',
        }, {recordHistory: true, immediateHistory: true});

        expect(storageState.get('local:credentials')).toMatchObject({token: {openai: secret}});
        expect(storageState.has('session:credentials')).toBe(false);
        expect(JSON.stringify(storageState.get('local:config'))).not.toContain(secret);
        expect(JSON.stringify(storageState.get('local:configHistory'))).not.toContain(secret);
        const persistedConfig = storageState.get('local:config') as Record<string, unknown>;
        expect(persistedConfig.token).toBeUndefined();
        expect(persistedConfig.extra).toBeUndefined();

        await configStore.saveConfig({...configStore.config, token: {}, to: 'ja'});
        expect(storageState.get('local:credentials')).toMatchObject({token: {}});
    });

    it('扩展后台用一次原子提交写入持久凭据与公开配置，并清理旧 session', async () => {
        const oldSecret = 'atomic-old-secret';
        const newSecret = 'atomic-new-secret';
        const canonicalConfig = {
            ...sanitizeConfigCredentials(normalizeConfig(storedConfig)),
            __fluentConfigRevision: 5,
        };
        const configStore = await loadConfigModule(canonicalConfig, {
            atomicSetItems: true,
            localCredentials: {token: {openai: oldSecret}},
        });
        await configStore.configReady;
        storageState.set('session:credentials', {token: {openai: 'stale-session-secret'}});

        await configStore.saveConfig({...configStore.config, token: {openai: newSecret}, to: 'en'});

        expect(atomicSetItemsMock).toHaveBeenCalledTimes(1);
        const [entries, removeKeys] = atomicSetItemsMock.mock.calls[0] as [Map<string, unknown>, string[]];
        expect([...entries.keys()].sort()).toEqual(['local:config', 'local:credentials']);
        expect(entries.get('local:credentials')).toMatchObject({token: {openai: newSecret}});
        expect(JSON.stringify(entries.get('local:config'))).not.toContain(newSecret);
        expect(removeKeys).toEqual(['session:credentials']);
        expect(storageState.get('local:credentials')).toMatchObject({token: {openai: newSecret}});
        expect(storageState.has('session:credentials')).toBe(false);
        expect(configStore.getConfigRevision()).toBe(6);
    });

    it('原子提交失败时不改变 IndexedDB 快照或推进持久 revision', async () => {
        const oldSecret = 'atomic-preserved-secret';
        const canonicalConfig = {
            ...sanitizeConfigCredentials(normalizeConfig(storedConfig)),
            __fluentConfigRevision: 5,
        };
        const configStore = await loadConfigModule(canonicalConfig, {
            atomicSetItems: true,
            failAtomicCommit: true,
            localCredentials: {token: {openai: oldSecret}},
        });
        await configStore.configReady;

        await expect(configStore.saveConfig({
            ...configStore.config,
            token: {openai: 'atomic-rejected-secret'},
            to: 'en',
        })).rejects.toThrow('atomic commit unavailable');

        expect(storageState.get('local:credentials')).toMatchObject({token: {openai: oldSecret}});
        expect(storageState.get('local:config')).toEqual(canonicalConfig);
        expect(configStore.getConfigRevision()).toBe(5);
    });

    it('旧策略双副本不一致时采用最新 session，验证 local 后删除 session 与旧字段', async () => {
        const configStore = await loadConfigModule({...storedConfig, persistCredentials: false}, {
            localCredentials: {token: {openai: 'old-local-secret'}},
            sessionCredentials: {token: {openai: 'new-session-secret'}},
        });

        await configStore.configReady;

        expect(configStore.config.token.openai).toBe('new-session-secret');
        expect(storageState.get('local:credentials')).toMatchObject({token: {openai: 'new-session-secret'}});
        expect(storageState.has('session:credentials')).toBe(false);
        expect(storageState.get('local:config')).not.toHaveProperty('persistCredentials');
        const setLocal = storageOperations.indexOf('set:local:credentials');
        const verifyLocal = storageOperations.indexOf('get:local:credentials', setLocal + 1);
        const removeSession = storageOperations.indexOf('remove:session:credentials');
        const setConfig = storageOperations.indexOf('set:local:config');
        expect(verifyLocal).toBeGreaterThan(setLocal);
        expect(removeSession).toBeGreaterThan(verifyLocal);
        expect(setConfig).toBeGreaterThan(removeSession);
    });

    it('新配置以 local 凭据为权威，不被残留旧 session 回滚', async () => {
        const canonical = {
            ...sanitizeConfigCredentials(normalizeConfig(storedConfig)),
            __fluentConfigRevision: 5,
        };
        const configStore = await loadConfigModule(canonical, {
            localCredentials: {token: {openai: 'new-local-secret'}},
            sessionCredentials: {token: {openai: 'stale-session-secret'}},
        });

        await configStore.configReady;

        expect(configStore.config.token.openai).toBe('new-local-secret');
        expect(storageState.get('local:credentials')).toMatchObject({token: {openai: 'new-local-secret'}});
        expect(storageState.has('session:credentials')).toBe(false);
    });

    it('恢复历史只恢复可恢复字段，并保留当前凭据、统计和迁移标记', async () => {
        const configStore = await loadConfigModule(storedConfig);
        await Promise.all([configStore.configReady, configStore.configHistoryReady]);
        await configStore.saveConfig({...configStore.config, to: 'en'}, {recordHistory: true, immediateHistory: true});
        const baselineVersion = configStore.getConfigHistorySnapshot().entries[0].version;
        const secret = 'restore-secret-sentinel';
        await configStore.incrementConfigCount(42, 'history-restore-count-operation');
        await configStore.saveConfig({
            ...configStore.config,
            token: {openai: secret},
            count: 1,
            videoServiceDefaultMigrated: true,
            to: 'ja',
        }, {recordHistory: true, immediateHistory: true});

        await configStore.applyConfigHistoryAction('restore', baselineVersion);

        expect(configStore.config.to).toBe('zh-Hans');
        expect(configStore.config.token.openai).toBe(secret);
        expect(configStore.config).not.toHaveProperty('persistCredentials');
        expect(configStore.config.count).toBe(42);
        expect(configStore.config.videoServiceDefaultMigrated).toBe(true);
        expect(JSON.stringify(configStore.getConfigHistorySnapshot())).not.toContain(secret);
        expect(configStore.getConfigHistorySnapshot().entries.every((entry) => (
            !('count' in entry.config)
            && !('persistCredentials' in entry.config)
            && !('videoServiceDefaultMigrated' in entry.config)
        ))).toBe(true);
    });

    it.each([
        ['写入', {failLocalCredentialWrite: true}],
        ['读回校验', {failLocalCredentialVerification: true}],
    ] as const)('local 凭据%s失败时不删除或改写旧载体', async (_failure, failureOptions) => {
        const secret = 'must-not-delete-secret';
        const legacyConfig = {...storedConfig, token: {openai: secret}, persistCredentials: false};
        const configStore = await loadConfigModule(legacyConfig, {
            ...failureOptions,
            sessionCredentials: {token: {openai: secret}},
        });

        await expect(configStore.configReady).resolves.toBeUndefined();

        expect(configStore.config.token.openai).toBe(secret);
        expect(storageMock.removeItem).not.toHaveBeenCalled();
        expect(storageMock.setItem).not.toHaveBeenCalledWith('local:config', expect.anything());
        expect(storageState.get('local:config')).toEqual(legacyConfig);
        expect(storageState.get('session:credentials')).toMatchObject({token: {openai: secret}});
    });

    it('网页/content 上下文不访问 session，也不执行危险迁移', async () => {
        const secret = 'content-context-secret';
        const legacyConfig = {...storedConfig, token: {openai: secret}};
        const configStore = await loadConfigModule(legacyConfig, {trusted: false});

        await configStore.configReady;

        expect(configStore.config.token).toEqual({});
        expect(storageOperations.some((operation) => operation.includes(':credentials'))).toBe(false);
        expect(storageMock.setItem).not.toHaveBeenCalled();
        expect(storageMock.removeItem).not.toHaveBeenCalled();
        expect(storageState.get('local:config')).toEqual(legacyConfig);
    });

    it('连续请求按页面顺序串行发送，并让后一次使用前一次提交后的 revision', async () => {
        const configStore = await loadConfigModule(storedConfig);
        await configStore.configReady;
        const sent: string[] = [];
        let releaseFirst!: () => void;
        const firstFinished = new Promise<void>((resolve) => { releaseFirst = resolve; });
        const baseRevisions: number[] = [];
        const sendMessage = vi.fn(async ({config, baseRevision}: {config: {to: string}; baseRevision: number}) => {
            sent.push(config.to);
            baseRevisions.push(baseRevision);
            if (sent.length === 1) await firstFinished;
            return {success: true, revision: baseRevision + 1};
        });

        const first = configStore.requestConfigSave({ ...configStore.config, to: 'en' }, sendMessage);
        const latest = configStore.requestConfigSave({ ...configStore.config, to: 'ja' }, sendMessage);
        await vi.waitFor(() => expect(sent).toEqual(['en']));
        releaseFirst();
        await Promise.all([first, latest]);

        expect(sent).toEqual(['en', 'ja']);
        expect(baseRevisions).toEqual([1, 2]);
    });

    it('配置持久化 barrier 等待已排队及等待期间追加的请求', async () => {
        const canonical = sanitizeConfigCredentials(normalizeConfig(storedConfig));
        const configStore = await loadConfigModule({...canonical, __fluentConfigRevision: 4});
        await configStore.configReady;
        const configWatch = storageMock.watch.mock.calls[0][1];
        let releaseFirstPatch!: () => void;
        let releaseSecondPatch!: () => void;
        const firstPatchGate = new Promise<void>((resolve) => { releaseFirstPatch = resolve; });
        const secondPatchGate = new Promise<void>((resolve) => { releaseSecondPatch = resolve; });
        const sent: Array<{mode: string; baseRevision: number}> = [];
        const sendMessage = vi.fn(async (message: {
            mode?: 'replace' | 'patch';
            config: Config;
            expected?: Config;
            baseRevision: number;
        }) => {
            sent.push({mode: message.mode || 'replace', baseRevision: message.baseRevision});
            if (message.mode === 'patch' && 'videoTranslationEnabled' in message.config) {
                await firstPatchGate;
                const committed = {
                    ...canonical,
                    videoTranslationEnabled: true,
                    __fluentConfigRevision: 5,
                };
                storageState.set('local:config', committed);
                configWatch(committed);
                return {success: true, revision: 5};
            }
            if (message.mode === 'patch') {
                await secondPatchGate;
                const committed = {
                    ...canonical,
                    videoTranslationEnabled: true,
                    theme: 'dark',
                    __fluentConfigRevision: 6,
                };
                storageState.set('local:config', committed);
                configWatch(committed);
                return {success: true, revision: 6};
            }

            expect(message.baseRevision).toBe(6);
            const committed = {
                ...canonical,
                videoTranslationEnabled: true,
                theme: 'dark',
                to: 'ja',
                __fluentConfigRevision: 7,
            };
            storageState.set('local:config', committed);
            configWatch(committed);
            return {success: true, revision: 7};
        });

        const firstPatch = configStore.requestConfigPatch({videoTranslationEnabled: true}, sendMessage);
        await vi.waitFor(() => expect(sendMessage).toHaveBeenCalledOnce());
        let barrierResolved = false;
        const barrier = configStore.waitForConfigPersistenceQueue().then(() => { barrierResolved = true; });
        const secondPatch = configStore.requestConfigPatch({theme: 'dark'}, sendMessage);

        await Promise.resolve();
        expect(barrierResolved).toBe(false);
        releaseFirstPatch();
        await firstPatch;
        await vi.waitFor(() => expect(sendMessage).toHaveBeenCalledTimes(2));
        expect(barrierResolved).toBe(false);
        releaseSecondPatch();
        await Promise.all([secondPatch, barrier]);

        expect(barrierResolved).toBe(true);
        expect(configStore.getConfigRevision()).toBe(6);
        await configStore.requestConfigSave({...configStore.config, to: 'ja'}, sendMessage);
        expect(sent).toEqual([
            {mode: 'patch', baseRevision: 4},
            {mode: 'patch', baseRevision: 4},
            {mode: 'replace', baseRevision: 6},
        ]);
        expect(configStore.config).toMatchObject({
            to: 'ja',
            theme: 'dark',
            videoTranslationEnabled: true,
        });
        expect(configStore.getConfigRevision()).toBe(7);
    });

    it('字段补丁与整份替换共用请求队列，replace 不继承 patch revision', async () => {
        const configStore = await loadConfigModule(storedConfig);
        await configStore.configReady;
        const sent: Array<{mode: string; to: string; sequence: number; baseRevision: number}> = [];
        let releasePatch!: () => void;
        const patchGate = new Promise<void>((resolve) => { releasePatch = resolve; });
        const sendMessage = vi.fn(async (message: {
            mode?: 'replace' | 'patch';
            config: Config;
            sequence: number;
            baseRevision: number;
        }) => {
            sent.push({
                mode: message.mode || 'replace',
                to: String(message.config.to),
                sequence: message.sequence,
                baseRevision: message.baseRevision,
            });
            if (message.mode === 'patch') await patchGate;
            return {success: true, revision: message.baseRevision + 1};
        });

        const patch = configStore.requestConfigPatch({to: 'en'}, sendMessage);
        const replace = configStore.requestConfigSave({...configStore.config, to: 'ja'}, sendMessage);
        await vi.waitFor(() => expect(sent).toHaveLength(1));
        releasePatch();
        await Promise.all([patch, replace]);

        expect(sent).toEqual([
            {mode: 'patch', to: 'en', sequence: 1, baseRevision: 1},
            {mode: 'replace', to: 'ja', sequence: 2, baseRevision: 1},
        ]);
    });

    it('排队 replace 不借用已吸收外部字段的 patch revision 覆盖新值', async () => {
        const canonical = sanitizeConfigCredentials(normalizeConfig(storedConfig));
        const configStore = await loadConfigModule({...canonical, __fluentConfigRevision: 4});
        await configStore.configReady;
        const configWatch = storageMock.watch.mock.calls[0][1];
        const sent: Array<{mode: string; baseRevision: number}> = [];
        const sendMessage = vi.fn(async (message: {
            mode?: 'replace' | 'patch';
            config: Config;
            expected?: Config;
            baseRevision: number;
        }) => {
            sent.push({mode: message.mode || 'replace', baseRevision: message.baseRevision});
            if (message.mode === 'patch') {
                expect(message).toMatchObject({
                    config: {to: 'ja'},
                    expected: {to: canonical.to},
                    baseRevision: 4,
                });
                const external = {
                    ...canonical,
                    theme: 'dark',
                    __fluentConfigRevision: 5,
                };
                storageState.set('local:config', external);
                configWatch(external);
                const committed = {
                    ...external,
                    to: 'ja',
                    __fluentConfigRevision: 6,
                };
                storageState.set('local:config', committed);
                configWatch(committed);
                return {success: true, revision: 6};
            }

            expect(message.config).toMatchObject({
                to: 'ja',
                theme: canonical.theme,
            });
            expect(message.baseRevision).toBe(4);
            return {success: false, error: '配置已更新（当前 revision 6）'};
        });

        const patch = configStore.requestConfigPatch({to: 'ja'}, sendMessage);
        // patch 的乐观值 X1 已进入 runtime，但外部 Y1 尚未到达当前上下文。
        const staleReplace = configStore.requestConfigSave(normalizeConfig(configStore.config), sendMessage);
        const [patchResult, replaceResult] = await Promise.allSettled([patch, staleReplace]);

        expect(patchResult.status).toBe('fulfilled');
        expect(replaceResult).toMatchObject({
            status: 'rejected',
            reason: expect.objectContaining({message: expect.stringContaining('revision 6')}),
        });
        expect(sent).toEqual([
            {mode: 'patch', baseRevision: 4},
            {mode: 'replace', baseRevision: 4},
        ]);
        expect(configStore.config).toMatchObject({to: 'ja', theme: 'dark'});
        expect(configStore.getConfigRevision()).toBe(6);
    });

    it('外部 revision 会取消混合队列中的旧 replace，但保留可做字段 CAS 的 patch', async () => {
        const canonical = sanitizeConfigCredentials(normalizeConfig(storedConfig));
        const configStore = await loadConfigModule({...canonical, __fluentConfigRevision: 4});
        await configStore.configReady;
        const configWatch = storageMock.watch.mock.calls[0][1];
        const sendMessage = vi.fn(async (message: {
            mode?: 'replace' | 'patch';
            config: Config;
            expected?: Config;
            baseRevision: number;
        }) => {
            expect(message).toMatchObject({
                mode: 'patch',
                config: {videoTranslationEnabled: true},
                expected: {videoTranslationEnabled: false},
                // patch 的 baseRevision 只是协议兼容字段，后台依赖 expected 做 CAS。
                baseRevision: 4,
            });
            const committed = {
                ...canonical,
                to: 'ko',
                videoTranslationEnabled: true,
                __fluentConfigRevision: 6,
            };
            storageState.set('local:config', committed);
            configWatch(committed);
            return {success: true, revision: 6};
        });

        const staleReplace = configStore.requestConfigSave({...configStore.config, to: 'en'}, sendMessage);
        const patch = configStore.requestConfigPatch({videoTranslationEnabled: true}, sendMessage);
        const external = {
            ...canonical,
            to: 'ko',
            __fluentConfigRevision: 5,
        };
        storageState.set('local:config', external);
        configWatch(external);

        await expect(staleReplace).rejects.toThrow('根据最新配置重新修改');
        await expect(patch).resolves.toBeUndefined();

        expect(sendMessage).toHaveBeenCalledOnce();
        expect(configStore.config).toMatchObject({
            to: 'ko',
            videoTranslationEnabled: true,
        });
        expect(configStore.getConfigRevision()).toBe(6);
    });

    it('active replace 期间 deferred 的外部更新会取消所有旧 replace，但后续 patch 仍可 CAS', async () => {
        const canonical = sanitizeConfigCredentials(normalizeConfig(storedConfig));
        const configStore = await loadConfigModule({...canonical, __fluentConfigRevision: 4});
        await configStore.configReady;
        const configWatch = storageMock.watch.mock.calls[0][1];
        let releaseActiveReplace!: () => void;
        const activeReplaceGate = new Promise<void>((resolve) => { releaseActiveReplace = resolve; });
        const sent: Array<{mode: string; to: string; baseRevision: number}> = [];
        const sendMessage = vi.fn(async (message: {
            mode?: 'replace' | 'patch';
            config: Config;
            expected?: Config;
            baseRevision: number;
        }) => {
            sent.push({
                mode: message.mode || 'replace',
                to: String(message.config.to ?? ''),
                baseRevision: message.baseRevision,
            });
            if (message.mode !== 'patch') {
                await activeReplaceGate;
                return {success: true, revision: 5};
            }

            expect(message).toMatchObject({
                mode: 'patch',
                config: {videoTranslationEnabled: true},
                expected: {videoTranslationEnabled: false},
                baseRevision: 4,
            });
            const committed = {
                ...canonical,
                to: 'ko',
                videoTranslationEnabled: true,
                __fluentConfigRevision: 7,
            };
            storageState.set('local:config', committed);
            configWatch(committed);
            return {success: true, revision: 7};
        });

        const activeReplace = configStore.requestConfigSave({...configStore.config, to: 'en'}, sendMessage);
        await vi.waitFor(() => expect(sent).toEqual([
            {mode: 'replace', to: 'en', baseRevision: 4},
        ]));
        const staleReplace = configStore.requestConfigSave({...configStore.config, to: 'ja'}, sendMessage);
        const patch = configStore.requestConfigPatch({videoTranslationEnabled: true}, sendMessage);
        const external = {
            ...canonical,
            to: 'ko',
            __fluentConfigRevision: 6,
        };
        storageState.set('local:config', external);
        // activeRequestSerialized 存在时先 deferred，待 R0 响应后再判定为更高外部版本。
        configWatch(external);
        releaseActiveReplace();

        await expect(activeReplace).rejects.toThrow('其他页面更新');
        await expect(staleReplace).rejects.toThrow('根据最新配置重新修改');
        await expect(patch).resolves.toBeUndefined();

        expect(sent).toEqual([
            {mode: 'replace', to: 'en', baseRevision: 4},
            {mode: 'patch', to: '', baseRevision: 4},
        ]);
        expect(configStore.config).toMatchObject({
            to: 'ko',
            videoTranslationEnabled: true,
        });
        expect(configStore.getConfigRevision()).toBe(7);
    });

    it('一次 revision 冲突会刷新当前配置并取消已经排队的旧快照', async () => {
        const canonical = sanitizeConfigCredentials(normalizeConfig(storedConfig));
        const configStore = await loadConfigModule({...canonical, __fluentConfigRevision: 4});
        await configStore.configReady;
        const sendMessage = vi.fn(async () => {
            storageState.set('local:config', {...canonical, to: 'ko', __fluentConfigRevision: 5});
            return {success: false, error: '配置已更新（当前 revision 5）'};
        });

        const first = configStore.requestConfigSave({...configStore.config, to: 'en'}, sendMessage);
        const queued = configStore.requestConfigSave({...configStore.config, to: 'ja'}, sendMessage);

        await expect(first).rejects.toThrow('当前 revision 5');
        await expect(queued).rejects.toThrow('根据最新配置重新修改');
        expect(sendMessage).toHaveBeenCalledOnce();
        expect(configStore.config.to).toBe('ko');
        expect(configStore.getConfigRevision()).toBe(5);
    });

    it('把后台保留 count 后的 canonical storage 回声识别为本次保存并同步 UI', async () => {
        const canonical = sanitizeConfigCredentials(normalizeConfig(storedConfig));
        const configStore = await loadConfigModule({...canonical, __fluentConfigRevision: 4});
        await configStore.configReady;
        const watchCallback = storageMock.watch.mock.calls[0][1];
        const sendMessage = vi.fn(async () => {
            watchCallback({...canonical, to: 'ja', count: 7, __fluentConfigRevision: 5});
            return {success: true, revision: 5};
        });

        await expect(configStore.requestConfigSave({...configStore.config, to: 'ja'}, sendMessage))
            .resolves.toBeUndefined();

        expect(configStore.config).toMatchObject({to: 'ja', count: 7});
        expect(configStore.getConfigRevision()).toBe(5);
    });

    it('响应前收到更高 revision 的外部恢复时采用恢复结果并取消排队快照', async () => {
        const canonical = sanitizeConfigCredentials(normalizeConfig(storedConfig));
        const configStore = await loadConfigModule({...canonical, __fluentConfigRevision: 4});
        await configStore.configReady;
        const watchCallback = storageMock.watch.mock.calls[0][1];
        let releaseFirst!: () => void;
        const firstGate = new Promise<void>((resolve) => { releaseFirst = resolve; });
        const sendMessage = vi.fn(async () => {
            await firstGate;
            return {success: true, revision: 5};
        });

        const first = configStore.requestConfigSave({...configStore.config, to: 'en'}, sendMessage);
        await vi.waitFor(() => expect(sendMessage).toHaveBeenCalledOnce());
        const queued = configStore.requestConfigSave({...configStore.config, to: 'ja'}, sendMessage);
        watchCallback({...canonical, to: 'en', __fluentConfigRevision: 5});
        watchCallback({...canonical, to: 'ko', __fluentConfigRevision: 6});
        releaseFirst();

        await expect(first).rejects.toThrow('其他页面更新');
        await expect(queued).rejects.toThrow('根据最新配置重新修改');
        expect(sendMessage).toHaveBeenCalledOnce();
        expect(configStore.config.to).toBe('ko');
        expect(configStore.getConfigRevision()).toBe(6);
    });

    it('外部仅更新 local 凭据并推进 revision 时也会取消携带旧凭据的排队快照', async () => {
        const canonical = sanitizeConfigCredentials(normalizeConfig(storedConfig));
        const configStore = await loadConfigModule({...canonical, __fluentConfigRevision: 4}, {
            localCredentials: {token: {openai: 'old-secret'}},
        });
        await configStore.configReady;
        const configWatch = storageMock.watch.mock.calls[0][1];
        const credentialWatch = storageMock.watch.mock.calls.find(([key]) => key === 'local:credentials')?.[1];
        let releaseFirst!: () => void;
        const firstGate = new Promise<void>((resolve) => { releaseFirst = resolve; });
        const sendMessage = vi.fn(async () => {
            await firstGate;
            return {success: true, revision: 5};
        });

        const first = configStore.requestConfigSave({...configStore.config, to: 'en'}, sendMessage);
        await vi.waitFor(() => expect(sendMessage).toHaveBeenCalledOnce());
        const queued = configStore.requestConfigSave({...configStore.config, to: 'ja'}, sendMessage);
        configWatch({...canonical, to: 'en', __fluentConfigRevision: 5});
        credentialWatch?.({token: {openai: 'new-secret'}});
        configWatch({...canonical, to: 'en', __fluentConfigRevision: 6});
        releaseFirst();

        await expect(first).rejects.toThrow('其他页面更新');
        await expect(queued).rejects.toThrow('根据最新配置重新修改');
        expect(sendMessage).toHaveBeenCalledOnce();
        expect(configStore.config.token.openai).toBe('new-secret');
        expect(configStore.getConfigRevision()).toBe(6);
    });

    it('本地存在更新请求时忽略旧 storage 回声', async () => {
        const configStore = await loadConfigModule(storedConfig);
        await configStore.configReady;
        let release!: () => void;
        const pending = new Promise<void>((resolve) => { release = resolve; });
        const sendMessage = vi.fn(async () => {
            await pending;
            return {success: true, revision: 2};
        });
        const latest = { ...configStore.config, to: 'ja' };
        const request = configStore.requestConfigSave(latest, sendMessage);
        const listener = vi.fn();
        const unsubscribe = configStore.subscribeConfig(listener);
        listener.mockClear();
        const watchCallback = storageMock.watch.mock.calls[0][1];

        watchCallback({ ...storedConfig, to: 'en' }, storedConfig);

        expect(configStore.config.to).toBe('zh-Hans');
        expect(listener).not.toHaveBeenCalled();
        release();
        await request;
        unsubscribe();
    });

    it('迟到的旧版本 storage 快照不会回滚已同步的新版本', async () => {
        const configStore = await loadConfigModule({ ...storedConfig, __fluentConfigRevision: 5 });
        await configStore.configReady;
        const watchCallback = storageMock.watch.mock.calls[0][1];

        watchCallback({ ...storedConfig, to: 'ja', __fluentConfigRevision: 7 }, storedConfig);
        watchCallback({ ...storedConfig, to: 'en', __fluentConfigRevision: 6 }, storedConfig);

        expect(configStore.config.to).toBe('ja');
    });

    it('记录配置版本、时间，并限制为最近十条快照', async () => {
        const configStore = await loadConfigModule(storedConfig);
        await Promise.all([configStore.configReady, configStore.configHistoryReady]);

        for (const to of ['en', 'ja', 'ko', 'fr', 'ru', 'de', 'es', 'it', 'pt', 'ar', 'th']) {
            await configStore.saveConfig({ ...configStore.config, to }, {recordHistory: true, immediateHistory: true});
        }

        const history = configStore.getConfigHistorySnapshot();
        expect(history.entries).toHaveLength(10);
        expect(history.cursor).toBe(9);
        expect(history.entries.at(-1)).toMatchObject({
            version: expect.any(Number),
            savedAt: expect.any(String),
            config: expect.objectContaining({to: 'th'}),
        });
        expect(history.entries.map((entry) => entry.version)).toEqual(
            [...history.entries].sort((left, right) => left.version - right.version).map((entry) => entry.version),
        );
    });

    it('支持撤销、重做和按版本恢复，并保持配置与历史游标一致', async () => {
        const configStore = await loadConfigModule(storedConfig);
        await Promise.all([configStore.configReady, configStore.configHistoryReady]);
        await configStore.saveConfig({ ...configStore.config, to: 'en' }, {recordHistory: true, immediateHistory: true});
        await configStore.saveConfig({ ...configStore.config, to: 'ja' }, {recordHistory: true, immediateHistory: true});

        const beforeUndo = configStore.getConfigHistorySnapshot();
        const undo = await configStore.applyConfigHistoryAction('undo');
        expect(configStore.config.to).toBe('en');
        expect(undo.cursor).toBe(beforeUndo.cursor - 1);

        const redo = await configStore.applyConfigHistoryAction('redo');
        expect(configStore.config.to).toBe('ja');
        expect(redo.cursor).toBe(beforeUndo.cursor);

        await configStore.applyConfigHistoryAction('undo');
        expect(configStore.config.to).toBe('en');

        const baselineVersion = beforeUndo.entries[0].version;
        const restored = await configStore.applyConfigHistoryAction('restore', baselineVersion);
        expect(configStore.config.to).toBe('zh-Hans');
        expect(restored.cursor).toBe(restored.entries.length - 1);
        expect(restored.entries.at(-1)).toMatchObject({
            version: beforeUndo.nextVersion,
            config: expect.objectContaining({to: 'zh-Hans'}),
        });
        expect(restored.entries.some((entry) => entry.config.to === 'ja')).toBe(true);
    });

    it('在配置历史中保存规范化域名，并能恢复旧配置的空名单', async () => {
        const configStore = await loadConfigModule(storedConfig);
        await Promise.all([configStore.configReady, configStore.configHistoryReady]);

        await configStore.saveConfig({
            ...configStore.config,
            alwaysTranslateDomains: [
                'https://news.bbc.co.uk/world',
                'BBC.CO.UK',
                'https://docs.team.github.io/guide',
            ],
        }, {recordHistory: true, immediateHistory: true});

        expect(configStore.config.alwaysTranslateDomains).toEqual(['bbc.co.uk', 'team.github.io']);
        expect(configStore.getConfigHistorySnapshot().entries.at(-1)?.config.alwaysTranslateDomains)
            .toEqual(['bbc.co.uk', 'team.github.io']);

        await configStore.applyConfigHistoryAction('undo');
        expect(configStore.config.alwaysTranslateDomains).toEqual([]);
    });

    it('配置历史操作优先通过后台消息传递，后台不可用时安全回退', async () => {
        const configStore = await loadConfigModule(storedConfig);
        await Promise.all([configStore.configReady, configStore.configHistoryReady]);
        const sendMessage = vi.fn().mockResolvedValue({success: true, history: configStore.getConfigHistorySnapshot()});

        await configStore.requestConfigHistoryAction('undo', undefined, sendMessage);

        expect(sendMessage).toHaveBeenCalledWith({
            type: configStore.CONFIG_HISTORY_MESSAGE,
            action: 'undo',
            version: undefined,
        });
    });

    it('快速连续编辑只保留最后一个防抖历史快照', async () => {
        const configStore = await loadConfigModule(storedConfig);
        await Promise.all([configStore.configReady, configStore.configHistoryReady]);

        await configStore.saveConfig({ ...configStore.config, to: 'en' }, {recordHistory: true});
        await configStore.saveConfig({ ...configStore.config, to: 'ja' }, {recordHistory: true});
        await configStore.flushConfigHistory();

        const history = configStore.getConfigHistorySnapshot();
        expect(history.entries).toHaveLength(2);
        expect(history.entries.at(-1)?.config.to).toBe('ja');
    });

    it('仅翻译计数、旧策略字段或迁移标记变化时不新增最近修改快照', async () => {
        const configStore = await loadConfigModule(storedConfig);
        await Promise.all([configStore.configReady, configStore.configHistoryReady]);

        await configStore.incrementConfigCount(12, 'history-excluded-count-operation');
        await configStore.saveConfig({
            ...configStore.config,
            count: 1,
            persistCredentials: true,
            videoServiceDefaultMigrated: false,
        }, {recordHistory: true, immediateHistory: true});

        const history = configStore.getConfigHistorySnapshot();
        expect(history.entries).toHaveLength(1);
        expect(history.entries[0]?.config).not.toHaveProperty('count');
        expect(history.entries[0]?.config).not.toHaveProperty('persistCredentials');
        expect(history.entries[0]?.config).not.toHaveProperty('videoServiceDefaultMigrated');
        expect(configStore.config).toMatchObject({
            count: 12,
            videoServiceDefaultMigrated: true,
        });
        expect(configStore.config).not.toHaveProperty('persistCredentials');
    });

    it('两个立即历史写入重叠时串行提交，不能丢失较新的快照或复用版本号', async () => {
        const configStore = await loadConfigModule(storedConfig);
        await Promise.all([configStore.configReady, configStore.configHistoryReady]);
        let releaseFirstHistoryWrite!: () => void;
        const firstHistoryWriteBlocked = new Promise<void>((resolve) => {
            releaseFirstHistoryWrite = resolve;
        });
        let historyWriteCount = 0;
        storageMock.setItem.mockImplementation(async (key: string, nextValue: unknown) => {
            storageOperations.push(`set:${key}`);
            if (key === 'local:configHistory' && historyWriteCount++ === 0) {
                await firstHistoryWriteBlocked;
            }
            storageState.set(key, structuredClone(nextValue));
        });

        const first = configStore.saveConfig(
            {...configStore.config, to: 'en'},
            {recordHistory: true, immediateHistory: true},
        );
        await vi.waitFor(() => expect(historyWriteCount).toBe(1));
        const second = configStore.saveConfig(
            {...configStore.config, to: 'ja'},
            {recordHistory: true, immediateHistory: true},
        );
        releaseFirstHistoryWrite();
        await Promise.all([first, second]);

        const history = configStore.getConfigHistorySnapshot();
        expect(history.entries.map((entry) => entry.config.to)).toEqual(['zh-Hans', 'en', 'ja']);
        expect(new Set(history.entries.map((entry) => entry.version)).size).toBe(history.entries.length);
        expect(storageState.get('local:configHistory')).toEqual(history);
    });

    it('配置历史 storage 外部更新会通知订阅者并保留版本结构', async () => {
        const configStore = await loadConfigModule(storedConfig);
        await Promise.all([configStore.configReady, configStore.configHistoryReady]);
        const listener = vi.fn();
        const unsubscribe = configStore.subscribeConfigHistory(listener);
        listener.mockClear();

        const current = configStore.getConfigHistorySnapshot();
        const external = {
            ...current,
            entries: [
                ...current.entries,
                {
                    version: current.nextVersion,
                    savedAt: new Date().toISOString(),
                    config: {...storedConfig, to: 'en'},
                },
            ],
            cursor: current.entries.length,
            nextVersion: current.nextVersion + 1,
        };
        const historyWatchCallback = storageMock.watch.mock.calls[1][1];
        historyWatchCallback(external);

        expect(listener).toHaveBeenCalledWith(expect.objectContaining({
            entries: expect.arrayContaining([expect.objectContaining({config: expect.objectContaining({to: 'en'})})]),
        }));
        expect(configStore.getConfigHistorySnapshot().entries.at(-1)?.config.to).toBe('en');
        unsubscribe();
    });

    it('配置历史后台操作失败时回退到本地，并实际保存目标配置', async () => {
        const configStore = await loadConfigModule(storedConfig);
        await Promise.all([configStore.configReady, configStore.configHistoryReady]);
        await configStore.saveConfig({ ...configStore.config, to: 'en' }, {recordHistory: true, immediateHistory: true});
        await configStore.saveConfig({ ...configStore.config, to: 'ja' }, {recordHistory: true, immediateHistory: true});
        storageMock.setItem.mockClear();

        const sendMessage = vi.fn().mockRejectedValue(new Error('Receiving end does not exist'));
        await configStore.requestConfigHistoryAction('undo', undefined, sendMessage);

        expect(configStore.config.to).toBe('en');
        expect(storageMock.setItem).toHaveBeenCalledWith(
            'local:config',
            expect.objectContaining({to: 'en'}),
        );
        expect(storageMock.setItem).toHaveBeenCalledWith(
            'local:configHistory',
            expect.objectContaining({cursor: 1}),
        );
    });

    it('后台明确返回历史操作失败时不绕过后台队列再次本地恢复', async () => {
        const configStore = await loadConfigModule(storedConfig);
        await Promise.all([configStore.configReady, configStore.configHistoryReady]);
        await configStore.saveConfig({...configStore.config, to: 'en'}, {recordHistory: true, immediateHistory: true});
        storageMock.setItem.mockClear();

        await expect(configStore.requestConfigHistoryAction(
            'undo',
            undefined,
            vi.fn().mockResolvedValue({success: false, error: 'background restore failed'}),
        )).rejects.toThrow('background restore failed');
        await expect(configStore.requestConfigHistoryAction(
            'undo',
            undefined,
            vi.fn().mockResolvedValue({success: true}),
        )).rejects.toThrow('没有返回结果');
        expect(storageMock.setItem).not.toHaveBeenCalled();
    });
});
