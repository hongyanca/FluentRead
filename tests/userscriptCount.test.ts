import {describe, expect, it} from 'vitest';

import {
    USERSCRIPT_COUNT_BASE_PREFIX,
    USERSCRIPT_COUNT_REPLICA_PREFIX,
    createUserscriptCountCoordinator,
    type UserscriptCountStoragePort,
} from '@/userscript/count';

function createStorage(
    values = new Map<string, unknown>(),
    setImplementation?: (key: string, value: unknown, commit: () => void) => Promise<void>,
): UserscriptCountStoragePort & {values: Map<string, unknown>} {
    return {
        values,
        async get(key) {
            return values.get(key) ?? null;
        },
        async set(key, value) {
            const commit = () => values.set(key, structuredClone(value));
            if (setImplementation) await setImplementation(key, value, commit);
            else commit();
        },
        async list() {
            return [...values.keys()];
        },
    };
}

function createSequentialId(prefix: string): () => string {
    let sequence = 0;
    return () => `${prefix}-${++sequence}`;
}

describe('userscript 跨标签翻译计数', () => {
    it('两个独立页面同时累加时写入各自副本，最终总数不会被旧值覆盖', async () => {
        const storage = createStorage();
        const first = createUserscriptCountCoordinator({storage, createId: createSequentialId('first-context')});
        const second = createUserscriptCountCoordinator({storage, createId: createSequentialId('second-context')});

        await Promise.all([first.initialize(10), second.initialize(10)]);
        await Promise.all([
            first.increment(2, 'first-operation-1'),
            second.increment(3, 'second-operation-1'),
        ]);

        await expect(first.getTotal()).resolves.toBe(15);
        const replicaRecords = [...storage.values.entries()]
            .filter(([key]) => key.startsWith(USERSCRIPT_COUNT_REPLICA_PREFIX))
            .map(([, value]) => value as {value: number});
        expect(replicaRecords).toHaveLength(2);
        expect(replicaRecords.map((record) => record.value).sort((a, b) => a - b)).toEqual([2, 3]);
    });

    it('同一页面的并发来源会串行写入单调绝对值', async () => {
        const writtenValues: number[] = [];
        let activeWrites = 0;
        let maximumActiveWrites = 0;
        const storage = createStorage(new Map(), async (key, value, commit) => {
            if (key.startsWith(USERSCRIPT_COUNT_REPLICA_PREFIX)) {
                activeWrites += 1;
                maximumActiveWrites = Math.max(maximumActiveWrites, activeWrites);
                await Promise.resolve();
                writtenValues.push((value as {value: number}).value);
                commit();
                activeWrites -= 1;
                return;
            }
            commit();
        });
        const list = storage.list.bind(storage);
        let listCalls = 0;
        storage.list = async () => {
            listCalls += 1;
            return list();
        };
        const coordinator = createUserscriptCountCoordinator({storage, createId: createSequentialId('single-context')});
        await coordinator.initialize(0);
        listCalls = 0;

        await Promise.all([
            coordinator.increment(2, 'normal-operation-1'),
            coordinator.increment(5, 'video-operation-1'),
        ]);

        expect(maximumActiveWrites).toBe(1);
        expect(writtenValues).toEqual([2, 7]);
        expect(listCalls).toBe(0);
        await expect(coordinator.getTotal()).resolves.toBe(7);
    });

    it('GM 写入成功后才报告失败时，同 operationId 重试不会重复计数', async () => {
        let shouldThrowAfterCommit = true;
        const storage = createStorage(new Map(), async (key, _value, commit) => {
            commit();
            if (key.startsWith(USERSCRIPT_COUNT_REPLICA_PREFIX) && shouldThrowAfterCommit) {
                shouldThrowAfterCommit = false;
                throw new Error('响应在提交后丢失');
            }
        });
        const coordinator = createUserscriptCountCoordinator({storage, createId: createSequentialId('response-loss')});
        await coordinator.initialize(4);

        await expect(coordinator.increment(3, 'response-loss-operation')).rejects.toThrow('响应在提交后丢失');
        await expect(coordinator.increment(3, 'response-loss-operation')).resolves.toBe(7);
        await expect(coordinator.getTotal()).resolves.toBe(7);
    });

    it('GM 写入前失败时保留重试能力，成功后只增加一次', async () => {
        let shouldFailBeforeCommit = true;
        const storage = createStorage(new Map(), async (key, _value, commit) => {
            if (key.startsWith(USERSCRIPT_COUNT_REPLICA_PREFIX) && shouldFailBeforeCommit) {
                shouldFailBeforeCommit = false;
                throw new Error('写入前失败');
            }
            commit();
        });
        const coordinator = createUserscriptCountCoordinator({storage, createId: createSequentialId('prewrite-failure')});
        await coordinator.initialize(1);

        await expect(coordinator.increment(2, 'prewrite-operation-1')).rejects.toThrow('写入前失败');
        await expect(coordinator.increment(2, 'prewrite-operation-1')).resolves.toBe(3);
    });

    it('新页面能从副本恢复总数，陈旧 local:config 投影不参与求和', async () => {
        const storage = createStorage();
        const writer = createUserscriptCountCoordinator({storage, createId: createSequentialId('writer-context')});
        await writer.initialize(8);
        await writer.increment(6, 'writer-operation-1');
        storage.values.set('local:config', {count: 2});

        const recovered = createUserscriptCountCoordinator({storage, createId: createSequentialId('recovered-context')});
        await expect(recovered.initialize(2)).resolves.toBe(14);
        await expect(recovered.getTotal()).resolves.toBe(14);
    });

    it('运行期间 GM 数据被清空后会重新建立基数，而不是信任失效的进程标记', async () => {
        const storage = createStorage();
        const coordinator = createUserscriptCountCoordinator({storage, createId: createSequentialId('reset-context')});
        await expect(coordinator.initialize(9)).resolves.toBe(9);
        for (const key of [...storage.values.keys()]) {
            if (key.startsWith('fluentread:count:v1:')) storage.values.delete(key);
        }

        await expect(coordinator.getTotal()).resolves.toBe(9);
        expect([...storage.values.keys()].some((key) => key.startsWith(USERSCRIPT_COUNT_BASE_PREFIX))).toBe(true);
    });

    it('忽略畸形专用键，并拒绝无效输入和安全整数溢出', async () => {
        const storage = createStorage(new Map([
            [`${USERSCRIPT_COUNT_BASE_PREFIX}valid`, {version: 1, value: Number.MAX_SAFE_INTEGER}],
            [`${USERSCRIPT_COUNT_BASE_PREFIX}invalid`, {version: 1, value: -1}],
            [`${USERSCRIPT_COUNT_REPLICA_PREFIX}invalid`, {version: 2, value: 99, recentOperations: []}],
        ]));
        const coordinator = createUserscriptCountCoordinator({storage, createId: createSequentialId('overflow-context')});

        await expect(coordinator.increment(0, 'overflow-operation-1')).rejects.toThrow('无效的翻译计数增量');
        await expect(coordinator.increment(1, 'bad id')).rejects.toThrow('无效的翻译计数操作标识');
        await expect(coordinator.increment(1, 'overflow-operation-2')).rejects.toThrow('超过安全整数范围');
    });
});
