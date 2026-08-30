import {describe, expect, it, vi} from 'vitest';

import {
    CONFIG_PERSIST_MESSAGE_TYPE,
    createConfigMutationCoordinator,
    createConfigPersistenceHandler,
    type ConfigPersistenceDependencies,
} from '@/src/app/background/handlers/configPersistence';
import {createBackgroundMessageRouter} from '@/src/app/background/messageRouter';

interface TestConfig {
    marker: string;
    allowCredentialUpdates?: boolean;
    videoTranslationEnabled?: boolean;
    theme?: string;
}

function createDependencies(overrides: Partial<ConfigPersistenceDependencies<TestConfig>> = {}) {
    const current = {marker: 'current'};
    const dependencies: ConfigPersistenceDependencies<TestConfig> = {
        ready: Promise.resolve(),
        getCurrentConfig: vi.fn(() => current),
        prepareConfigSaveRequest: vi.fn((incomingConfig, _currentConfig, allowCredentialUpdates) => ({
            marker: String(incomingConfig.marker),
            allowCredentialUpdates,
        })),
        prepareConfigPatchRequest: vi.fn((incomingPatch, _expectedPatch, currentConfig, allowCredentialUpdates) => ({
            ...currentConfig,
            ...incomingPatch,
            allowCredentialUpdates,
        })) as ConfigPersistenceDependencies<TestConfig>['prepareConfigPatchRequest'],
        saveConfig: vi.fn(async () => undefined),
        isExtensionUrl: vi.fn((url) => url.startsWith('chrome-extension://extension-id/')),
        getCurrentRevision: vi.fn(() => 4),
        ...overrides,
    };
    return dependencies;
}

describe('background config persistence handler', () => {
    it('按扩展 sender 权限保存配置，并记录历史', async () => {
        const dependencies = createDependencies();
        const router = createBackgroundMessageRouter([
            createConfigPersistenceHandler(dependencies),
        ]);

        await expect(router.dispatch({
            type: CONFIG_PERSIST_MESSAGE_TYPE,
            config: {marker: 'extension-save'},
            clientId: 'options-page',
            sequence: 1,
            baseRevision: 4,
        }, {sender: {url: 'chrome-extension://extension-id/options.html'}})).resolves.toEqual({
            handled: true,
            response: {success: true, revision: 4},
        });

        expect(dependencies.prepareConfigSaveRequest).toHaveBeenCalledWith(
            {marker: 'extension-save'},
            {marker: 'current'},
            true,
        );
        expect(dependencies.saveConfig).toHaveBeenCalledWith(
            {marker: 'extension-save', allowCredentialUpdates: true},
            {recordHistory: true},
        );
        expect(dependencies.prepareConfigPatchRequest).not.toHaveBeenCalled();
    });

    it('patch 忽略旧 baseRevision，并在临界区基于最新配置只合并目标字段', async () => {
        const latestConfig: TestConfig = {
            marker: 'latest-external-value',
            videoTranslationEnabled: true,
            theme: 'dark',
        };
        const prepareConfigPatchRequest = vi.fn((
            incomingPatch: Record<string, unknown>,
            _expectedPatch: Record<string, unknown>,
            current: TestConfig,
        ) => ({
            ...current,
            marker: String(incomingPatch.marker),
        }));
        const dependencies = createDependencies({
            getCurrentConfig: () => latestConfig,
            getCurrentRevision: () => 9,
            prepareConfigPatchRequest,
        });
        const handler = createConfigPersistenceHandler(dependencies);

        await expect(handler.handle({
            type: CONFIG_PERSIST_MESSAGE_TYPE,
            mode: 'patch',
            config: {marker: 'patched-field'},
            expected: {marker: 'latest-external-value'},
            clientId: 'content-video',
            sequence: 1,
            baseRevision: 4,
        }, {sender: {url: 'https://www.youtube.com/watch?v=test'}}))
            .resolves.toEqual({success: true, revision: 9});

        expect(prepareConfigPatchRequest).toHaveBeenCalledWith(
            {marker: 'patched-field'},
            {marker: 'latest-external-value'},
            latestConfig,
            false,
        );
        expect(dependencies.prepareConfigSaveRequest).not.toHaveBeenCalled();
        expect(dependencies.saveConfig).toHaveBeenCalledWith({
            marker: 'patched-field',
            videoTranslationEnabled: true,
            theme: 'dark',
        }, {recordHistory: true});
    });

    it('patch 的目标字段在 base 后变化时拒绝迟到写入', async () => {
        const latestConfig: TestConfig = {
            marker: 'external-new-value',
            videoTranslationEnabled: true,
        };
        const prepareConfigPatchRequest = vi.fn((
            incomingPatch: Record<string, unknown>,
            expectedPatch: Record<string, unknown>,
            current: TestConfig,
        ) => {
            if (current.marker !== expectedPatch.marker) {
                throw new Error('配置字段已更新，请同步后重试：marker');
            }
            return {...current, marker: String(incomingPatch.marker)};
        });
        const dependencies = createDependencies({
            getCurrentConfig: () => latestConfig,
            getCurrentRevision: () => 9,
            prepareConfigPatchRequest,
        });
        const handler = createConfigPersistenceHandler(dependencies);

        await expect(handler.handle({
            type: CONFIG_PERSIST_MESSAGE_TYPE,
            mode: 'patch',
            config: {marker: 'late-local-value'},
            expected: {marker: 'old-base-value'},
            clientId: 'late-content',
            sequence: 1,
            baseRevision: 4,
        }, {})).rejects.toThrow('marker');

        expect(dependencies.saveConfig).not.toHaveBeenCalled();
        expect(latestConfig).toEqual({marker: 'external-new-value', videoTranslationEnabled: true});
    });

    it('content sender 使用 legacy clientId fallback，且不能更新凭据', async () => {
        const dependencies = createDependencies();
        const handler = createConfigPersistenceHandler(dependencies);

        await expect(handler.handle({
            type: CONFIG_PERSIST_MESSAGE_TYPE,
            config: {marker: 'content-save'},
        }, {
            sender: {
                id: 'content-script',
                url: 'https://example.com/article',
                frameId: 3,
                tab: {id: 7},
            },
        })).resolves.toEqual({success: true, revision: 4});

        expect(dependencies.prepareConfigSaveRequest).toHaveBeenCalledWith(
            {marker: 'content-save'},
            {marker: 'current'},
            false,
        );
    });

    it('同一 client 并发保存只让最新 sequence 落盘', async () => {
        const dependencies = createDependencies();
        const handler = createConfigPersistenceHandler(dependencies);

        const first = handler.handle({
            type: CONFIG_PERSIST_MESSAGE_TYPE,
            config: {marker: 'old'},
            clientId: 'popup',
            sequence: 1,
        }, {});
        const second = handler.handle({
            type: CONFIG_PERSIST_MESSAGE_TYPE,
            config: {marker: 'new'},
            clientId: 'popup',
            sequence: 2,
        }, {});

        await expect(Promise.all([first, second])).resolves.toEqual([
            {success: true, revision: 4},
            {success: true, revision: 4},
        ]);
        expect(dependencies.saveConfig).toHaveBeenCalledOnce();
        expect(dependencies.saveConfig).toHaveBeenCalledWith(
            {marker: 'new', allowCredentialUpdates: false},
            {recordHistory: true},
        );
    });

    it('未注入 revision 读取器时所有 sequence 分支稳定回退为 revision 0', async () => {
        const dependencies = createDependencies({getCurrentRevision: undefined});
        const handler = createConfigPersistenceHandler(dependencies);
        const first = handler.handle({
            type: CONFIG_PERSIST_MESSAGE_TYPE,
            config: {marker: 'superseded'},
            clientId: 'legacy-client',
            sequence: 1,
        }, {});
        const latest = handler.handle({
            type: CONFIG_PERSIST_MESSAGE_TYPE,
            config: {marker: 'latest'},
            clientId: 'legacy-client',
            sequence: 2,
        }, {});
        await expect(handler.handle({
            type: CONFIG_PERSIST_MESSAGE_TYPE,
            config: {marker: 'stale-while-latest-pending'},
            clientId: 'legacy-client',
            sequence: 1,
        }, {})).resolves.toEqual({success: true, revision: 0});

        await expect(Promise.all([first, latest])).resolves.toEqual([
            {success: true, revision: 0},
            {success: true, revision: 0},
        ]);
        await expect(handler.handle({
            type: CONFIG_PERSIST_MESSAGE_TYPE,
            config: {marker: 'stale'},
            clientId: 'legacy-client',
            sequence: 1,
        }, {})).resolves.toEqual({success: true, revision: 0});
        expect(dependencies.saveConfig).toHaveBeenCalledOnce();
    });

    it('tabId 为 0 时仍保留独立 fallback client 身份', async () => {
        const dependencies = createDependencies();
        const handler = createConfigPersistenceHandler(dependencies);

        const first = handler.handle({
            type: CONFIG_PERSIST_MESSAGE_TYPE,
            config: {marker: 'tab-zero'},
            sequence: 1,
        }, {sender: {tab: {id: 0}, frameId: 0}});
        const second = handler.handle({
            type: CONFIG_PERSIST_MESSAGE_TYPE,
            config: {marker: 'extension-page'},
            sequence: 2,
        }, {sender: {frameId: 0}});

        await expect(Promise.all([first, second])).resolves.toEqual([
            {success: true, revision: 4},
            {success: true, revision: 4},
        ]);
        expect(dependencies.saveConfig).toHaveBeenCalledTimes(2);
        expect(dependencies.saveConfig).toHaveBeenNthCalledWith(
            1,
            {marker: 'tab-zero', allowCredentialUpdates: false},
            {recordHistory: true},
        );
        expect(dependencies.saveConfig).toHaveBeenNthCalledWith(
            2,
            {marker: 'extension-page', allowCredentialUpdates: false},
            {recordHistory: true},
        );
    });

    it('过期 sequence 直接成功返回，不重复覆盖最新配置', async () => {
        const dependencies = createDependencies();
        const handler = createConfigPersistenceHandler(dependencies);

        await handler.handle({type: CONFIG_PERSIST_MESSAGE_TYPE, config: {marker: 'new'}, clientId: 'options', sequence: 8}, {});
        await expect(handler.handle({
            type: CONFIG_PERSIST_MESSAGE_TYPE,
            config: {marker: 'old'},
            clientId: 'options',
            sequence: 7,
        }, {})).resolves.toEqual({success: true, revision: 4});

        expect(dependencies.saveConfig).toHaveBeenCalledOnce();
        expect(dependencies.saveConfig).toHaveBeenCalledWith(
            {marker: 'new', allowCredentialUpdates: false},
            {recordHistory: true},
        );
    });

    it('无 sequence 保存保持队列顺序，前一个失败后后续请求仍可继续', async () => {
        let releaseFirst!: () => void;
        const firstStarted = new Promise<void>((resolve) => { releaseFirst = resolve; });
        const saveOrder: string[] = [];
        const dependencies = createDependencies({
            saveConfig: vi.fn(async (config) => {
                saveOrder.push(config.marker);
                if (config.marker === 'first') {
                    await firstStarted;
                    throw new Error('first failed');
                }
            }),
        });
        const handler = createConfigPersistenceHandler(dependencies);

        const first = handler.handle({type: CONFIG_PERSIST_MESSAGE_TYPE, config: {marker: 'first'}}, {});
        const second = handler.handle({type: CONFIG_PERSIST_MESSAGE_TYPE, config: {marker: 'second'}}, {});
        await vi.waitFor(() => expect(saveOrder).toEqual(['first']));
        releaseFirst();

        await expect(first).rejects.toThrow('first failed');
        await expect(second).resolves.toEqual({success: true, revision: 4});
        expect(saveOrder).toEqual(['first', 'second']);
    });

    it('带 sequence 的保存失败后允许同序号重试真正落盘', async () => {
        const saveConfig = vi.fn()
            .mockRejectedValueOnce(new Error('storage temporarily unavailable'))
            .mockResolvedValueOnce(undefined);
        const handler = createConfigPersistenceHandler(createDependencies({saveConfig}));
        const message = {
            type: CONFIG_PERSIST_MESSAGE_TYPE,
            config: {marker: 'retryable'},
            clientId: 'options-retry',
            sequence: 1,
        } as const;

        await expect(handler.handle(message, {})).rejects.toThrow('storage temporarily unavailable');
        await expect(handler.handle(message, {})).resolves.toEqual({success: true, revision: 4});
        expect(saveConfig).toHaveBeenCalledTimes(2);
    });

    it('同序号在途重试共享原请求结果，不在落盘前误报成功', async () => {
        let releaseSave!: () => void;
        const saveGate = new Promise<void>((resolve) => { releaseSave = resolve; });
        const saveConfig = vi.fn(async () => {
            await saveGate;
            throw new Error('shared failure');
        });
        const handler = createConfigPersistenceHandler(createDependencies({saveConfig}));
        const message = {
            type: CONFIG_PERSIST_MESSAGE_TYPE,
            config: {marker: 'deduplicated'},
            clientId: 'popup-retry',
            sequence: 1,
        } as const;

        const first = handler.handle(message, {});
        await vi.waitFor(() => expect(saveConfig).toHaveBeenCalledOnce());
        const duplicate = handler.handle(message, {});
        releaseSave();

        await expect(first).rejects.toThrow('shared failure');
        await expect(duplicate).rejects.toThrow('shared failure');
        expect(saveConfig).toHaveBeenCalledOnce();
    });

    it('未提交的最新序号屏蔽更旧请求，同序号重复共享成功 revision', async () => {
        let releaseSave!: () => void;
        const saveGate = new Promise<void>((resolve) => { releaseSave = resolve; });
        const saveConfig = vi.fn(async () => saveGate);
        const handler = createConfigPersistenceHandler(createDependencies({saveConfig}));
        const latestMessage = {
            type: CONFIG_PERSIST_MESSAGE_TYPE,
            config: {marker: 'latest-pending'},
            clientId: 'pending-client',
            sequence: 2,
        } as const;

        const latest = handler.handle(latestMessage, {});
        await vi.waitFor(() => expect(saveConfig).toHaveBeenCalledOnce());
        await expect(handler.handle({
            ...latestMessage,
            config: {marker: 'stale-pending'},
            sequence: 1,
        }, {})).resolves.toEqual({success: true, revision: 4});
        const duplicate = handler.handle(latestMessage, {});
        releaseSave();

        await expect(latest).resolves.toEqual({success: true, revision: 4});
        await expect(duplicate).resolves.toEqual({success: true, revision: 4});
        expect(saveConfig).toHaveBeenCalledOnce();
    });

    it.each([
        [{type: CONFIG_PERSIST_MESSAGE_TYPE}, 'config'],
        [{type: CONFIG_PERSIST_MESSAGE_TYPE, config: []}, 'config'],
        [{type: CONFIG_PERSIST_MESSAGE_TYPE, config: {}, clientId: ''}, 'clientId'],
        [{type: CONFIG_PERSIST_MESSAGE_TYPE, config: {}, clientId: 42}, 'clientId'],
        [{type: CONFIG_PERSIST_MESSAGE_TYPE, config: {}, sequence: -1}, 'sequence'],
        [{type: CONFIG_PERSIST_MESSAGE_TYPE, config: {}, sequence: 1.5}, 'sequence'],
        [{type: CONFIG_PERSIST_MESSAGE_TYPE, config: {}, baseRevision: -1}, 'baseRevision'],
        [{type: CONFIG_PERSIST_MESSAGE_TYPE, config: {}, baseRevision: 1.5}, 'baseRevision'],
        [{type: CONFIG_PERSIST_MESSAGE_TYPE, mode: 'merge', config: {}}, 'mode'],
        [{type: CONFIG_PERSIST_MESSAGE_TYPE, mode: 'patch', config: {}}, 'expected'],
    ])('拒绝非法配置保存消息 %#', async (message, field) => {
        const handler = createConfigPersistenceHandler(createDependencies());

        await expect(handler.handle(message, {})).rejects.toThrow(field);
    });

    it('拒绝基于旧 revision 的整份快照，避免覆盖刚恢复或导入的配置', async () => {
        const dependencies = createDependencies({getCurrentRevision: vi.fn(() => 5)});
        const handler = createConfigPersistenceHandler(dependencies);

        await expect(handler.handle({
            type: CONFIG_PERSIST_MESSAGE_TYPE,
            config: {marker: 'stale-content-snapshot'},
            clientId: 'content',
            sequence: 1,
            baseRevision: 4,
        }, {})).rejects.toThrow('当前 revision 5');
        expect(dependencies.saveConfig).not.toHaveBeenCalled();
    });

    it('外部恢复与普通保存共用 mutation coordinator 串行执行', async () => {
        const coordinator = createConfigMutationCoordinator();
        let revision = 4;
        let releaseRestore!: () => void;
        const restoreGate = new Promise<void>((resolve) => { releaseRestore = resolve; });
        const order: string[] = [];
        const dependencies = createDependencies({
            getCurrentRevision: () => revision,
            runMutation: coordinator.run,
            saveConfig: vi.fn(async () => { order.push('save'); revision += 1; }),
        });
        const handler = createConfigPersistenceHandler(dependencies);
        const restore = coordinator.run(async () => {
            order.push('restore-start');
            await restoreGate;
            revision += 1;
            order.push('restore-end');
        });
        const staleSave = handler.handle({
            type: CONFIG_PERSIST_MESSAGE_TYPE,
            config: {marker: 'stale-after-restore'},
            baseRevision: 4,
        }, {});

        await vi.waitFor(() => expect(order).toEqual(['restore-start']));
        releaseRestore();
        await restore;
        await expect(staleSave).rejects.toThrow('当前 revision 5');
        expect(order).toEqual(['restore-start', 'restore-end']);
    });

    it('在 mutation 临界区内捕获本次提交 revision，不误报紧随其后的恢复版本', async () => {
        const coordinator = createConfigMutationCoordinator();
        let revision = 4;
        let releaseSave!: () => void;
        const saveGate = new Promise<void>((resolve) => { releaseSave = resolve; });
        const saveStarted = vi.fn();
        const dependencies = createDependencies({
            getCurrentRevision: () => revision,
            runMutation: coordinator.run,
            saveConfig: vi.fn(async () => {
                saveStarted();
                await saveGate;
                revision = 5;
            }),
        });
        const handler = createConfigPersistenceHandler(dependencies);
        const request = handler.handle({
            type: CONFIG_PERSIST_MESSAGE_TYPE,
            config: {marker: 'save-before-restore'},
            baseRevision: 4,
        }, {});
        await vi.waitFor(() => expect(saveStarted).toHaveBeenCalledOnce());
        const followingRestore = coordinator.run(async () => { revision = 6; });

        releaseSave();
        await expect(request).resolves.toEqual({success: true, revision: 5});
        await followingRestore;
        expect(revision).toBe(6);
    });
});
