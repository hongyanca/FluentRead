import {afterEach,describe,expect,it,vi} from 'vitest';
const probe=vi.hoisted(()=>vi.fn());
vi.mock('@/src/shared/onnx/webgpu',()=>({probeWebGpu:probe}));
import {probeMangaGpu} from '@/src/features/image-translation/services/mangaGpu';
afterEach(()=>{vi.unstubAllGlobals();vi.clearAllMocks();});
describe('漫画 GPU 运行接口兼容性',()=>{
    it('新版运行时允许缺少旧 adapterInfo 属性的可用硬件',async()=>{
        vi.stubGlobal('GPUDevice',class{});probe.mockResolvedValue({available:true,info:'hardware'});
        expect(await probeMangaGpu()).toEqual({available:true,info:'hardware'});expect(probe).toHaveBeenCalledOnce();
    });
    it.each([true,false])('兼容接口继续采用有界硬件探测结果，available=%s',async available=>{
        vi.stubGlobal('GPUDevice',class{get adapterInfo(){return {};}});probe.mockResolvedValue({available,info:available?'hardware':''});
        expect(await probeMangaGpu()).toEqual({available,info:available?'hardware':''});expect(probe).toHaveBeenCalledOnce();
    });
});
