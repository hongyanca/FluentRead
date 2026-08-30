import {describe, expect, it, vi} from 'vitest';
import {
    RETIRED_DYNAMIC_CONTENT_SCRIPT_IDS,
    unregisterRetiredContentScripts,
    type RetiredContentScriptRegistration,
} from '@/src/app/background/retiredContentScripts';

function scriptingFixture(initial: readonly RetiredContentScriptRegistration[]) {
    const getRegisteredContentScripts = vi.fn(async () => [...initial]);
    const unregisterContentScripts = vi.fn(async () => undefined);
    return {
        getRegisteredContentScripts,
        unregisterContentScripts,
        port: {getRegisteredContentScripts, unregisterContentScripts},
    };
}

describe('退役动态内容脚本清理', () => {
    it('浏览器没有历史注册时只检查一次并保持幂等', async () => {
        const fixture = scriptingFixture([]);

        await unregisterRetiredContentScripts(fixture.port);

        expect(fixture.getRegisteredContentScripts).toHaveBeenCalledWith({
            ids: [...RETIRED_DYNAMIC_CONTENT_SCRIPT_IDS],
        });
        expect(fixture.unregisterContentScripts).not.toHaveBeenCalled();
    });

    it('只注销仍存在的精确退役 ID，并去重浏览器异常重复结果', async () => {
        const retiredId = RETIRED_DYNAMIC_CONTENT_SCRIPT_IDS[0];
        const fixture = scriptingFixture([
            {id: 'another-content-script'},
            {id: retiredId},
            {id: retiredId},
        ]);

        await unregisterRetiredContentScripts(fixture.port);

        expect(fixture.unregisterContentScripts).toHaveBeenCalledOnce();
        expect(fixture.unregisterContentScripts).toHaveBeenCalledWith({ids: [retiredId]});
    });

    it('保留 scripting 端口的读取和注销错误供组合层记录', async () => {
        const readFailure = scriptingFixture([]);
        readFailure.getRegisteredContentScripts.mockRejectedValueOnce(new Error('read failed'));
        await expect(unregisterRetiredContentScripts(readFailure.port)).rejects.toThrow('read failed');

        const removeFailure = scriptingFixture([{id: RETIRED_DYNAMIC_CONTENT_SCRIPT_IDS[0]}]);
        removeFailure.unregisterContentScripts.mockRejectedValueOnce(new Error('remove failed'));
        await expect(unregisterRetiredContentScripts(removeFailure.port)).rejects.toThrow('remove failed');
    });
});
