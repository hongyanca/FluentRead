import {afterEach, describe, expect, it, vi} from 'vitest';
import {parseHTML} from 'linkedom';
import {isImagePresentationOccluded, presentationMatchesSource, resolveImagePresentation, surfaceStyleToBitmap} from '@/src/features/image-translation/content/presentation';

type Style = Partial<CSSStyleDeclaration> & {backgroundImage?: string};

function fixture(options: {opacity?: string; visibility?: string; background?: string; candidateOpacity?: string; candidateDisplay?: string; candidateVisibility?: string; duplicate?: boolean; overlap?: boolean; geometryMismatch?: boolean; noParent?: boolean; noSource?: boolean} = {}) {
    const {document} = parseHTML('<html><body><div id="surface"><img src="https://pbs.twimg.com/media/source.png"><div id="paint"></div></div></body></html>');
    const image = document.querySelector('img') as HTMLImageElement;
    const paint = document.querySelector('#paint') as HTMLDivElement;
    const duplicate = options.duplicate ? document.createElement('div') : null;
    const overlap = options.overlap ? document.createElement('div') : null;
    if (duplicate) document.querySelector('#surface')!.append(duplicate);
    if (overlap) document.querySelector('#surface')!.append(overlap);
    const styles = new Map<Element, Style>();
    styles.set(image, {display: 'block', visibility: options.visibility ?? 'visible', opacity: options.opacity ?? '1', backgroundImage: 'none'});
    styles.set(paint, {display: options.candidateDisplay ?? 'block', visibility: options.candidateVisibility ?? 'visible', opacity: options.candidateOpacity ?? '1', backgroundImage: options.background ?? 'none', backgroundSize: 'cover', backgroundPosition: 'right bottom'});
    if (duplicate) styles.set(duplicate, {display: 'block', visibility: 'visible', opacity: '1', backgroundImage: options.background ?? 'none'});
    if (overlap) styles.set(overlap, {display: 'block', visibility: 'visible', opacity: '1', backgroundImage: 'url("https://example.test/other.png")'});
    const rect = {left: 20, top: 40, right: 420, bottom: 240, width: 400, height: 200} as DOMRect;
    image.getBoundingClientRect = () => rect;
    paint.getBoundingClientRect = () => options.geometryMismatch ? {...rect, width: 399} as DOMRect : rect;
    if (duplicate) duplicate.getBoundingClientRect = () => rect;
    if (overlap) overlap.getBoundingClientRect = () => rect;
    if (options.noSource) image.removeAttribute('src');
    if (options.noParent) image.remove();
    vi.stubGlobal('getComputedStyle', (element: Element) => styles.get(element) || {display: 'block', visibility: 'visible', opacity: '1', backgroundImage: 'none'});
    return {image, paint, duplicate, overlap, styles, document};
}

afterEach(() => vi.unstubAllGlobals());

describe('image presentation foreground ownership', () => {
    const visible = {left: 20, top: 40, right: 420, bottom: 240};

    it('keeps surfaces visible without a hit-test API or with an empty hit stack', () => {
        const {image, document} = fixture();
        expect(isImagePresentationOccluded(image, visible, null)).toBe(false);
        Object.assign(document, {elementsFromPoint: () => []});
        expect(isImagePresentationOccluded(image, visible, null)).toBe(false);
    });

    it('accepts the surface, its painted descendants, and pointer-transparent ancestors', () => {
        const {image, paint, document} = fixture();
        const child = document.createElement('span'); paint.append(child);
        for (const foreground of [image, image.parentElement!, paint, child]) {
            Object.assign(document, {elementsFromPoint: () => [foreground]});
            expect(isImagePresentationOccluded(foreground === child ? paint : foreground, visible, null)).toBe(false);
        }
        Object.assign(document, {elementsFromPoint: () => [image.parentElement!]});
        expect(isImagePresentationOccluded(image, visible, null)).toBe(false);
    });

    it('ignores its own Shadow DOM host and controls, then checks the host page foreground', () => {
        const {image, document} = fixture();
        const host = document.createElement('div'); const control = document.createElement('button'); host.append(control);
        Object.assign(document, {elementsFromPoint: () => [control, host, image]});
        expect(isImagePresentationOccluded(image, visible, host)).toBe(false);
        const modal = document.createElement('div'); modal.setAttribute('role', 'dialog');
        Object.assign(document, {elementsFromPoint: () => [host, modal, image]});
        expect(isImagePresentationOccluded(image, visible, host)).toBe(true);
    });

    it('samples the clipped region and hides even a corner covered by a floating panel', () => {
        const {image, document} = fixture(); const panel = document.createElement('div');
        const hitTest = vi.fn((x: number, y: number) => x > 300 && y > 200 ? [panel, image] : [image]);
        Object.assign(document, {elementsFromPoint: hitTest});
        expect(isImagePresentationOccluded(image, visible, null)).toBe(true);
        expect(hitTest.mock.calls).toEqual([[220, 140], [60, 60], [380, 60], [60, 220], [380, 220]]);
    });

    it('allows an image inside the foreground viewer rather than hiding every dialog image', () => {
        const {image, document} = fixture(); const dialog = document.createElement('div');
        dialog.setAttribute('role', 'dialog'); document.body.append(dialog); dialog.append(image);
        Object.assign(document, {elementsFromPoint: () => [image, dialog, document.body]});
        expect(isImagePresentationOccluded(image, visible, null)).toBe(false);
    });

    it('keeps a background surface visible under its own transparent source img, including during translation', () => {
        const env = fixture({opacity: '0', background: 'url("https://pbs.twimg.com/media/source.png")'});
        Object.assign(env.document, {elementsFromPoint: () => [env.image, env.paint]});
        expect(isImagePresentationOccluded(env.paint, visible, null, env.image)).toBe(false);
        env.styles.get(env.paint)!.opacity = '0';
        expect(isImagePresentationOccluded(env.paint, visible, null, env.image)).toBe(false);
        const dialog = env.document.createElement('div');
        Object.assign(env.document, {elementsFromPoint: () => [dialog, env.image, env.paint]});
        expect(isImagePresentationOccluded(env.paint, visible, null, env.image)).toBe(true);
    });

    it.each(['foreign-image', 'visible-source', 'unset-opacity', 'moved-source', 'changed-source', 'detached-source'])
    ('does not exempt a %s from foreground ownership checks', mode => {
        const env = fixture({opacity: '0', background: 'url("https://pbs.twimg.com/media/source.png")'});
        let foreground: Element = env.image;
        if (mode === 'foreign-image') foreground = env.document.createElement('img');
        if (mode === 'visible-source') env.styles.get(env.image)!.opacity = '1';
        if (mode === 'unset-opacity') env.styles.get(env.image)!.opacity = '';
        if (mode === 'moved-source') env.image.getBoundingClientRect = () => ({...env.paint.getBoundingClientRect(), left: 30}) as DOMRect;
        if (mode === 'changed-source') env.image.setAttribute('src', 'https://pbs.twimg.com/media/other.png');
        if (mode === 'detached-source') env.image.remove();
        Object.assign(env.document, {elementsFromPoint: () => [foreground, env.paint]});
        expect(isImagePresentationOccluded(env.paint, visible, null, env.image)).toBe(true);
    });

    function mediaLinkFixture() {
        const env = fixture();
        Object.defineProperty(env.document, 'baseURI', {value: 'https://x.com/a16z/status/2107176509928878490'});
        const container = env.image.parentElement!;
        const inert = env.document.createElement('div'); inert.setAttribute('inert', '');
        const link = env.document.createElement('a');
        link.setAttribute('href', '/a16z/status/2107176509928878490/photo/1');
        container.append(inert); inert.append(link); link.append(env.image);
        const overlay = env.document.createElement('a');
        overlay.setAttribute('href', 'https://x.com/a16z/status/2107176509928878490/photo/1');
        overlay.setAttribute('aria-label', '查看媒体');
        overlay.getBoundingClientRect = env.image.getBoundingClientRect;
        container.append(overlay);
        env.styles.set(overlay, {position: 'absolute', backgroundImage: 'none', backgroundColor: 'rgba(0, 0, 0, 0)'});
        Object.assign(env.document, {elementsFromPoint: () => [overlay, container, env.document.body]});
        return {...env, container, inert, link, overlay};
    }

    it('accepts the matching empty media link above X inert photos and rechecks changed overlays', () => {
        const {image, overlay} = mediaLinkFixture();
        expect(isImagePresentationOccluded(image, visible, null)).toBe(false);
        overlay.setAttribute('href', '/a16z/status/2107176509928878490/photo/2');
        expect(isImagePresentationOccluded(image, visible, null)).toBe(true);
    });

    it.each(['different-link', 'no-source-link', 'invalid-link', 'far-parent', 'detached', 'geometry', 'text', 'child', 'background', 'color', 'static'])
    ('does not treat a %s overlay as the image media link', mode => {
        const env = mediaLinkFixture();
        if (mode === 'different-link') env.overlay.setAttribute('href', '/a16z/status/other/photo/1');
        if (mode === 'no-source-link') env.link.removeAttribute('href');
        if (mode === 'invalid-link') env.overlay.setAttribute('href', 'http://[invalid');
        if (mode === 'far-parent') {env.overlay.remove(); env.document.body.append(env.overlay);}
        if (mode === 'detached') env.overlay.remove();
        if (mode === 'geometry') env.overlay.getBoundingClientRect = () => ({...env.image.getBoundingClientRect(), width: 500}) as DOMRect;
        if (mode === 'text') env.overlay.textContent = 'Open a different panel';
        if (mode === 'child') env.overlay.append(env.document.createElement('span'));
        if (mode === 'background') env.styles.get(env.overlay)!.backgroundImage = 'url(other.png)';
        if (mode === 'color') env.styles.get(env.overlay)!.backgroundColor = 'rgb(255, 255, 255)';
        if (mode === 'static') env.styles.get(env.overlay)!.position = 'static';
        expect(isImagePresentationOccluded(env.image, visible, null)).toBe(true);
    });
});

describe('image presentation surface resolution', () => {
    it('uses a visible img by default', () => {
        const env = fixture();
        expect(resolveImagePresentation(env.image)).toEqual({element: env.image, kind: 'image'});
    });

    it('uses the unique matching background sibling for a hidden img', () => {
        const env = fixture({opacity: '0', background: 'url("https://pbs.twimg.com/media/source.png")'});
        expect(resolveImagePresentation(env.image)).toEqual({element: env.paint, kind: 'background'});
    });

    it('falls back when the image is hidden without a matching surface', () => {
        const env = fixture({opacity: '0'});
        expect(resolveImagePresentation(env.image)).toEqual({element: env.image, kind: 'image'});
        expect(resolveImagePresentation(fixture({opacity: ''}).image).kind).toBe('image');
    });

    it('falls back without a parent, source, or matching geometry', () => {
        expect(resolveImagePresentation(fixture({opacity: '0', noParent: true}).image).kind).toBe('image');
        expect(resolveImagePresentation(fixture({opacity: '0', noSource: true}).image).kind).toBe('image');
        expect(resolveImagePresentation(fixture({opacity: '0', geometryMismatch: true, background: 'url(https://pbs.twimg.com/media/source.png)'}).image).kind).toBe('image');
    });

    it('falls back when opacity zero is paired with display or visibility hiding', () => {
        expect(resolveImagePresentation(fixture({opacity: '0', visibility: 'hidden', background: 'url(https://pbs.twimg.com/media/source.png)'}).image).kind).toBe('image');
    });

    it('falls back for duplicate, hidden, multi-background, and overlapping surfaces', () => {
        expect(resolveImagePresentation(fixture({opacity: '0', background: 'url(https://pbs.twimg.com/media/source.png), url(other.png)'}).image).kind).toBe('image');
        expect(resolveImagePresentation(fixture({opacity: '0', background: 'url(https://pbs.twimg.com/media/source.png)', duplicate: true}).image).kind).toBe('image');
        expect(resolveImagePresentation(fixture({opacity: '0', background: 'url(https://pbs.twimg.com/media/source.png)', candidateOpacity: '0'}).image).kind).toBe('image');
        expect(resolveImagePresentation(fixture({opacity: '0', background: 'url(https://pbs.twimg.com/media/source.png)', candidateOpacity: 'invalid'}).image).kind).toBe('image');
        expect(resolveImagePresentation(fixture({opacity: '0', background: 'url(https://pbs.twimg.com/media/source.png)', candidateOpacity: ''}).image).kind).toBe('background');
        expect(resolveImagePresentation(fixture({opacity: '0', background: 'url(https://pbs.twimg.com/media/source.png)', overlap: true}).image).kind).toBe('image');
        expect(resolveImagePresentation(fixture({opacity: '0', background: 'url(https://pbs.twimg.com/media/source.png)', candidateDisplay: 'none'}).image).kind).toBe('image');
        expect(resolveImagePresentation(fixture({opacity: '0', background: 'url(https://pbs.twimg.com/media/source.png)', candidateVisibility: 'collapse'}).image).kind).toBe('image');
    });

    it('accepts quoted and unquoted single URLs but rejects empty or unsupported background values', () => {
        expect(resolveImagePresentation(fixture({opacity: '0', background: 'url(https://pbs.twimg.com/media/source.png)'}).image).kind).toBe('background');
        expect(resolveImagePresentation(fixture({opacity: '0', background: "url('https://pbs.twimg.com/media/source.png')"}).image).kind).toBe('background');
        expect(resolveImagePresentation(fixture({opacity: '0', background: 'url()'}).image).kind).toBe('image');
        expect(resolveImagePresentation(fixture({opacity: '0', background: 'linear-gradient(red, blue)'}).image).kind).toBe('image');
    });

    it('maps background sizing and position to bitmap properties', () => {
        expect(surfaceStyleToBitmap({backgroundSize: 'cover', backgroundPosition: 'right bottom'})).toEqual({objectFit: 'cover', objectPosition: 'right bottom'});
        expect(surfaceStyleToBitmap({backgroundSize: 'contain', backgroundPosition: 'center'})).toEqual({objectFit: 'contain', objectPosition: 'center'});
        expect(surfaceStyleToBitmap({backgroundSize: 'auto', backgroundPosition: ''})).toEqual({objectFit: 'none', objectPosition: '50% 50%'});
    });

    it('validates source ownership while ignoring the leased opacity', () => {
        const env = fixture({opacity: '0', background: 'url(https://pbs.twimg.com/media/source.png)'});
        const presentation = resolveImagePresentation(env.image);
        expect(presentationMatchesSource(env.image, presentation)).toBe(true);
        expect(presentationMatchesSource(env.image, {element: env.image, kind: 'image'})).toBe(true);
        env.styles.set(env.paint, {display: 'block', visibility: 'visible', opacity: '0', backgroundImage: 'url(https://example.test/changed.png)'});
        expect(presentationMatchesSource(env.image, presentation)).toBe(false);
        env.styles.set(env.paint, {display: 'block', visibility: 'visible', opacity: '0', backgroundImage: undefined});
        expect(presentationMatchesSource(env.image, presentation)).toBe(false);
        expect(presentationMatchesSource(env.image, {element: env.document.createElement('div'), kind: 'background'})).toBe(false);
        expect(presentationMatchesSource(env.image, {element: env.image, kind: 'background'})).toBe(false);
        expect(presentationMatchesSource(env.image, {element: env.paint, kind: 'background'})).toBe(false);
        const detached = fixture({opacity: '0', background: 'url(https://pbs.twimg.com/media/source.png)'});
        const detachedPresentation = resolveImagePresentation(detached.image);
        detached.image.remove();
        expect(presentationMatchesSource(detached.image, detachedPresentation)).toBe(false);

        const overlap = fixture({opacity: '0', background: 'url(https://pbs.twimg.com/media/source.png)', overlap: true});
        overlap.styles.set(overlap.overlap!, {display: 'block', visibility: 'visible', opacity: '1', backgroundImage: undefined});
        expect(resolveImagePresentation(overlap.image).kind).toBe('background');
    });

    it('uses defaults for missing surface style fields', () => {
        expect(surfaceStyleToBitmap({backgroundSize: undefined as never, backgroundPosition: undefined as never})).toEqual({objectFit: 'fill', objectPosition: '50% 50%'});
        expect(surfaceStyleToBitmap({backgroundSize: 'cover', backgroundPosition: '   '})).toEqual({objectFit: 'cover', objectPosition: '50% 50%'});
    });
});
