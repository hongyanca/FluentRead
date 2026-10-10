import {afterEach, describe, expect, it, vi} from 'vitest';
import {canCopyCardImage, copyCardImage} from '@/src/features/share-card/export';
afterEach(() => vi.unstubAllGlobals());
const blob = new Blob(['png'], {type:'image/png'});
describe('卡片图片导出能力回退', () => {
    it('缺失图片剪贴板不尝试写入，存在时直接写入 PNG', async () => {
        vi.stubGlobal('navigator', {}); vi.stubGlobal('ClipboardItem', undefined);
        expect(canCopyCardImage()).toBe(false); await expect(copyCardImage(blob)).rejects.toThrow('clipboard-unavailable');
        const write = vi.fn().mockResolvedValue(undefined);
        vi.stubGlobal('navigator', {clipboard: {write}}); vi.stubGlobal('ClipboardItem', class {constructor(public items: unknown) {}});
        const pending = copyCardImage(blob); expect(write).toHaveBeenCalledOnce(); await pending;
        expect(write.mock.calls[0][0][0].items['image/png']).toBe(blob);
    });
});
