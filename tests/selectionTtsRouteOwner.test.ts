/**
 * @file tests/selectionTtsRouteOwner.test.ts
 * 文件职责：从公开路由解析与相等 API 验证可选 frame/page 所有权的兼容和严格边界。
 * 主要内容：旧路由、frame 0、hash、路径/查询差异、损坏附加字段以及跨 frame/有无归属的精确匹配。
 * 模块边界：纯协议测试，不访问内部状态、不运行浏览器或网络。
 */
import {describe, expect, it} from 'vitest';
import {parseSelectionTtsRoute, sameSelectionTtsRoute} from '@/src/features/selection-translation/protocol';

describe('selection speech route page/frame ownership', () => {
    const legacy = {tabId: 0, clientRequestId: 'request'};
    const current = {...legacy, frameId: 0, ownerUrl: 'https://controlled.example/path?q=1'};
    it('preserves the old route shape and normalizes hash while retaining path/query', () => {
        expect(parseSelectionTtsRoute(legacy)).toEqual(legacy);
        expect(parseSelectionTtsRoute({...current, ownerUrl: current.ownerUrl + '#old'})).toEqual(current);
        expect(sameSelectionTtsRoute(parseSelectionTtsRoute({...current, ownerUrl: current.ownerUrl + '#new'}), current)).toBe(true);
    });
    it.each([-1, 0.5, '0', null, Number.MAX_SAFE_INTEGER + 1])('rejects malformed optional frame %j', frameId => {
        expect(() => parseSelectionTtsRoute({...legacy, frameId})).toThrow();
    });
    it.each([null, 7, '', ' ', '/relative', 'https://['])('rejects malformed owner URL %j', ownerUrl => {
        expect(() => parseSelectionTtsRoute({...legacy, ownerUrl})).toThrow();
    });
    it.each([
        {...current, frameId: 1}, {...current, ownerUrl: 'https://controlled.example/path?q=2'},
        {...current, ownerUrl: 'https://controlled.example/another?q=1'}, legacy,
        {tabId: 0, clientRequestId: 'request', frameId: 0},
    ])('requires both sides of a routed ownership match to agree: %j', other => {
        expect(sameSelectionTtsRoute(current, other)).toBe(false);
        expect(sameSelectionTtsRoute(other, current)).toBe(false);
    });
});
