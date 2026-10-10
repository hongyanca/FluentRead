/**
 * @file tests/userscriptDexieIsolation.test.ts
 * 覆盖 issue #524：dexie 官方 ESM 入口把自身注册到 globalThis[Symbol.for('Dexie')]，
 * 并在版本不一致时于模块求值阶段抛错。油猴脚本与宿主页面共享同一个 world，
 * 该注册一旦进入产物，任何自带其他 Dexie 版本的页面都会让整个脚本在入口处中断。
 */
import {describe, expect, it} from 'vitest';

const DEXIE_GLOBAL_KEY = Symbol.for('Dexie');

describe('userscript dexie entry isolation', () => {
    it('不注册全局 Dexie 单例，宿主页面的其他 Dexie 版本无法中断脚本', async () => {
        expect(Reflect.get(globalThis, DEXIE_GLOBAL_KEY)).toBeUndefined();

        // 模拟宿主页面已经注册了另一个版本的 Dexie：官方入口在这种情况下会直接抛错。
        Reflect.set(globalThis, DEXIE_GLOBAL_KEY, {semVer: '0.0.0-host-page'});
        try {
            const {default: Dexie} = await import('@/userscript/dexie');

            expect(typeof Dexie).toBe('function');
            // 仍然拿到的是真实实现，而不是被宿主页面的副本顶替。
            expect(Reflect.get(globalThis, DEXIE_GLOBAL_KEY)).toEqual({semVer: '0.0.0-host-page'});
            expect(typeof (Dexie as unknown as {semVer: string}).semVer).toBe('string');
            expect((Dexie as unknown as {semVer: string}).semVer).not.toBe('0.0.0-host-page');
        } finally {
            Reflect.deleteProperty(globalThis, DEXIE_GLOBAL_KEY);
        }
    });

    it('导出的构造函数可以正常建库并声明 schema', async () => {
        const {default: Dexie} = await import('@/userscript/dexie');

        const database = new Dexie('FluentReadUserscriptDexieProbe');
        database.version(1).stores({entries: 'key'});

        expect(database.name).toBe('FluentReadUserscriptDexieProbe');
        expect(database.tables.map((table) => table.name)).toContain('entries');
    });
});
