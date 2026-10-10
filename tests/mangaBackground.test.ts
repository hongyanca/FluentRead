import {afterEach, describe, expect, it, vi} from 'vitest';
import {parseHTML} from 'linkedom';
import {createMangaBackground} from '@/src/features/image-translation/content/mangaBackground';
import {composeMangaPage} from '@/src/features/image-translation/content/mangaCompositor';
import {encodeImageCanvas} from '@/src/features/image-translation/services/imageEncoding';
vi.mock('@/src/features/image-translation/content/mangaCompositor', () => ({composeMangaPage: vi.fn()}));
vi.mock('@/src/features/image-translation/services/imageEncoding', () => ({encodeImageCanvas: vi.fn()}));
const flush = async () => {for (let n=0;n<20;n++) await Promise.resolve();};

function fixture() {
    vi.mocked(encodeImageCanvas).mockResolvedValue('data:image/png;base64,AQ==');
    const {document}=parseHTML('<html><body><div id="page-1" style="background-image:url(blob:https://palcy.jp/page-1)"></div></body></html>');
    const element=document.getElementById('page-1')! as HTMLElement;
    const rect={left:0,top:0,right:640,bottom:900,width:640,height:900};element.getBoundingClientRect=()=>rect as DOMRect;
    const style={display:'block',visibility:'visible',opacity:'1',overflowX:'visible',overflowY:'visible',
        backgroundSize:'contain',backgroundRepeat:'no-repeat',backgroundOrigin:'padding-box',backgroundImage:'url("blob:https://palcy.jp/page-1")',backgroundPosition:'100% 50%',
        paddingTop:'0px',paddingRight:'0px',paddingBottom:'0px',paddingLeft:'0px',borderTopWidth:'0px',borderRightWidth:'0px',borderBottomWidth:'0px',borderLeftWidth:'0px'};
    class Rect {right:number;bottom:number;constructor(public left:number, public top:number, public width:number, public height:number) {this.right=left+width;this.bottom=top+height;}}
    const images: FakeImage[]=[];
    class FakeImage {
        src='';naturalWidth=713;naturalHeight=1024;
        onload:(()=>void)|null=null;onerror:(()=>void)|null=null;
        constructor(){images.push(this);}
    }
    const canvases:HTMLCanvasElement[]=[],outputs:HTMLCanvasElement[]=[];
    let tainted=false, missing=false;
    const create=document.createElement.bind(document);
    vi.spyOn(document,'createElement').mockImplementation(((tag:string)=>{
        const value=create(tag);
        if(tag==='canvas') {
            const canvas=value as HTMLCanvasElement;canvases.push(canvas);
            canvas.getContext=vi.fn(()=>missing?null:{drawImage:vi.fn(),getImageData:()=>{if(tainted)throw new DOMException('tainted','SecurityError');return {data:new Uint8ClampedArray(256).fill(1)};}}) as typeof canvas.getContext;
            canvas.toDataURL=vi.fn(()=>'data:image/png;base64,AQ==');
        }
        return value;
    }) as typeof document.createElement);
    vi.stubGlobal('document',document);vi.stubGlobal('window',{location:{origin:'https://palcy.jp'},innerWidth:1280,innerHeight:900});
    vi.stubGlobal('Image',FakeImage);vi.stubGlobal('DOMRect',Rect);vi.stubGlobal('getComputedStyle',()=>style);
    document.elementFromPoint=()=>element;
    const ports={enabled:vi.fn(()=>true),configurationIdentity:vi.fn(()=>'config'),cacheEnabled:vi.fn(()=>true),ready:vi.fn(),
        translate:vi.fn().mockResolvedValue({mangaPatches:{width:713,height:1024,patches:[{x:0,y:0,width:1,height:1,image:'data:image/png;base64,AQ=='}]},lines:[{text:'译文',bbox:{x0:0,y0:0,x1:1,y1:1},backgroundColor:'#fff'}]})};
    vi.mocked(composeMangaPage).mockImplementation(async()=>{const output=document.createElement('canvas') as HTMLCanvasElement;output.width=713;output.height=1024;outputs.push(output);return output;});
    const runtime=createMangaBackground(ports);
    const ready=async()=>{expect(runtime.identity(element)).toBeNull();images.at(-1)!.onload!();await flush();expect(runtime.identity(element)).not.toBeNull();};
    const translate=async()=>{const task=runtime.translate(element);images.at(-1)!.onload!();await task;};
    return {document,element,rect,style,images,canvases,outputs,ports,runtime,ready,translate,
        taint:()=>{tainted=true;},missing:()=>{missing=true;}};
}
afterEach(()=>{vi.restoreAllMocks();vi.resetAllMocks();vi.unstubAllGlobals();vi.useRealTimers();});

describe('公开背景漫画正文接入既有连续翻译',()=>{
    it('只保留尺寸和来源，串行探测附近页，快照翻译后不改变宿主背景',async()=>{
        const f=fixture(),original=f.element.outerHTML;
        const other=f.element.cloneNode() as HTMLElement;other.id='page-2';other.getBoundingClientRect=()=>f.rect as DOMRect;f.document.body.append(other);
        expect(f.runtime.identity(f.element)).toBeNull();expect(f.runtime.identity(other)).toBeNull();expect(f.images).toHaveLength(1);
        f.images[0].onload!();await flush();expect(f.images[0].src).toBe('');expect(f.ports.ready).toHaveBeenCalledOnce();
        expect(f.runtime.identity(f.element)).not.toBeNull();expect(f.runtime.identity(other)).toBeNull();expect(f.images).toHaveLength(2);
        f.runtime.prepare([f.element]);expect(f.images[1].src).toBe('');await flush();expect(f.ports.ready).toHaveBeenCalledOnce();
        await f.translate();expect(f.ports.translate).toHaveBeenCalledOnce();expect(f.runtime.pixels(f.element)).toBe(713*1024);
        const output=f.outputs[0];expect(output.style.display).toBe('block');expect(output.style.pointerEvents).toBe('none');
        expect(f.element.outerHTML).toBe(original);expect(f.document.getElementById('fluent-read-manga-background-container')).not.toBeNull();
        f.runtime.restore(f.element);expect(output.isConnected).toBe(false);expect(f.runtime.reuse(f.element)).toBe(true);expect(f.ports.translate).toHaveBeenCalledOnce();
        f.runtime.release(f.element);await f.translate();expect(f.ports.translate).toHaveBeenCalledOnce();
        f.runtime.dispose();expect(f.canvases.every(c=>c.width===0&&c.height===0)).toBe(true);expect(f.runtime.identity(f.element)).toBeNull();
    });
    it('contain 在左右和上下留白时按真实绘制范围定位，调整窗口不重复识别',async()=>{
        const f=fixture();await f.ready();const identity=f.runtime.identity(f.element),bounds=f.runtime.bounds(f.element);
        expect(bounds.width).toBeCloseTo(713*900/1024);expect(bounds.left).toBeCloseTo(640-bounds.width);expect(bounds.top).toBe(0);
        await f.translate();expect(f.outputs[0].style.width).toBe(`${bounds.width}px`);
        f.style.backgroundPosition='0px 50%';f.rect.width=f.rect.right=400;
        f.runtime.update();expect(f.runtime.identity(f.element)).toBe(identity);expect(f.outputs[0].style.left).toBe('0px');
        expect(f.runtime.bounds(f.element).top).toBeCloseTo((900-1024*400/713)/2);expect(f.ports.translate).toHaveBeenCalledOnce();f.runtime.dispose();
    });
    it.each([
        ['backgroundImage','none'],['backgroundImage','url(https://palcy.jp/chapter.png)'],['backgroundImage','url(blob:https://other.test/page)'],
        ['backgroundImage','url(blob:https://palcy.jp/page),url(blob:https://palcy.jp/other)'],['backgroundSize','cover'],['backgroundRepeat','repeat'],
        ['backgroundOrigin','content-box'],['paddingLeft','4px'],['borderTopWidth','1px'],['backgroundPosition','50%'],['backgroundPosition','120% 50%'],['backgroundPosition','4px 50%'],
    ])('无法精确定位或非同源 blob 的来源不宣告可处理 %s=%s',(key,value)=>{
        const f=fixture();Object.assign(f.style,{[key]:value});expect(f.runtime.identity(f.element)).toBeNull();expect(f.images).toHaveLength(0);f.runtime.dispose();
    });
    it.each(['small','huge','wide','tall','taint','context','load','timeout'])('探测失败保留原文，不循环请求和保留解码位图 %s',async mode=>{
        vi.useFakeTimers();const f=fixture();f.runtime.identity(f.element);const image=f.images[0];
        if(mode==='small')image.naturalWidth=1;if(mode==='huge'){image.naturalWidth=5000;image.naturalHeight=5000;}
        if(mode==='wide')image.naturalWidth=9000;if(mode==='tall')image.naturalHeight=9000;
        if(mode==='taint')f.taint();if(mode==='context')f.missing();
        if(mode==='load')image.onerror!();else if(mode==='timeout')await vi.advanceTimersByTimeAsync(15000);else image.onload!();
        await flush();expect(image.src).toBe('');expect(f.runtime.identity(f.element)).toBeNull();expect(f.images).toHaveLength(1);expect(f.ports.ready).toHaveBeenCalledOnce();
        await f.runtime.translate(f.element);expect(f.ports.translate).not.toHaveBeenCalled();f.runtime.dispose();expect(vi.getTimerCount()).toBe(0);
    });
    it('离屏或不足正文尺寸时不探测，断开节点也不能进入翻译',()=>{
        const f=fixture();f.rect.left=3000;expect(f.runtime.identity(f.element)).toBeNull();f.rect.left=0;f.rect.right=-1280;expect(f.runtime.identity(f.element)).toBeNull();
        f.rect.right=640;f.rect.top=2000;expect(f.runtime.identity(f.element)).toBeNull();f.rect.top=0;f.rect.bottom=-900;expect(f.runtime.identity(f.element)).toBeNull();
        f.rect.bottom=900;f.rect.width=1;expect(f.runtime.identity(f.element)).toBeNull();f.rect.width=640;f.rect.height=1;expect(f.runtime.identity(f.element)).toBeNull();
        f.element.remove();expect(f.runtime.identity(f.element)).toBeNull();expect(f.images).toHaveLength(0);f.runtime.dispose();
    });
    it.each(['source','style','remove','reset','dispose'])('在途探测被更换或移除时取消，旧回调不复活 %s',async mode=>{
        const f=fixture();f.runtime.identity(f.element);const load=f.images[0].onload!;
        if(mode==='source'){f.style.backgroundImage='url(blob:https://palcy.jp/new-page)';f.runtime.identity(f.element);}
        if(mode==='style'){f.style.backgroundSize='cover';f.runtime.identity(f.element);}
        if(mode==='remove')f.runtime.prepare([]);if(mode==='reset')f.runtime.resetCache();if(mode==='dispose')f.runtime.dispose();
        expect(f.images[0].src).toBe('');load();await flush();expect(f.ports.ready).not.toHaveBeenCalled();
        if(mode==='source') {
            const other=f.element.cloneNode() as HTMLElement;other.getBoundingClientRect=()=>f.rect as DOMRect;f.document.body.append(other);
            f.runtime.identity(other);expect(f.images).toHaveLength(2); // 旧探测收尾不得清掉同节点的新探测所有权。
            f.images[1].onload!();await flush();expect(f.runtime.identity(f.element)).toContain('new-page');
        }
        f.runtime.dispose();
    });
    it.each(['load','timeout','context','changed','pause','source','reset','dispose'])('完整快照失败或失去任务所有权时不发送旧 OCR %s',async mode=>{
        vi.useFakeTimers();const f=fixture();await f.ready();const task=f.runtime.translate(f.element),image=f.images.at(-1)!;
        const checked=['load','timeout','context','changed'].includes(mode)?expect(task).rejects.toThrow():task;
        if(mode==='load')image.onerror!();
        else if(mode==='timeout')await vi.advanceTimersByTimeAsync(15000);
        else if(mode==='context'){f.missing();image.onload!();}
        else if(mode==='changed'){image.naturalWidth=999;image.onload!();}
        else {
            if(mode==='pause')f.runtime.restore(f.element);
            if(mode==='source'){f.style.backgroundImage='url(blob:https://palcy.jp/replaced)';f.runtime.update();}
            if(mode==='reset')f.runtime.resetCache();if(mode==='dispose')f.runtime.dispose();
            image.onload?.();
        }
        await checked;
        expect(image.src).toBe('');expect(f.ports.translate).not.toHaveBeenCalled();expect(f.element.style.backgroundImage).toContain('page-1');
        f.runtime.dispose();expect(vi.getTimerCount()).toBe(0);
    });
});
