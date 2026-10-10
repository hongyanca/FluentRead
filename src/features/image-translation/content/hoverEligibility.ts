/**
 * @file src/features/image-translation/content/hoverEligibility.ts
 * 文件职责：判断网页图片是否适合自动显示图片翻译入口，减少头像、图标、视频封面和小图干扰。
 * 主要内容：结合尺寸、局部语义、视频区域重叠及明确资源路径过滤非正文图片，保护同帖普通配图。
 * 模块边界：仅同步读取目标及近邻 DOM，不读取像素、不发请求、不修改宿主；右键主动翻译不使用此启发式规则。
 */

const UI_IMAGE_TOKEN = /(?:^|[^a-z0-9])(?:avatars?|userpic|user-picture|user-photo|profile-picture|profile-photo|profile-image|icons?|favicons?|logos?|emoji|emoticons?|badges?)(?:$|[^a-z0-9])/i;
const UI_IMAGE_LABEL = /^(?:(?:user |company |site )?(?:avatar|icon|logo|emoji|emoticon|badge|profile (?:picture|photo|image))|(?:头像|用户头像|图标|徽标|标志|表情|表情包))$/i;
const VIDEO_IMAGE_TOKEN = /(?:^|[^a-z0-9])(?:video-(?:player|component|poster|thumbnail|preview|cover)|movie-player|ytp-cued-thumbnail)(?:$|[^a-z0-9])/i;

function hasMarker(element: Element, pattern: RegExp): boolean {
    return ['class', 'id', 'data-testid', 'itemprop'].some(attribute => {
        // 支持 UserAvatar、profileImage 等组件命名，但不将 iconography 等普通单词误认为 icon。
        const value = (element.getAttribute(attribute) || '').replace(/([a-z0-9])([A-Z])/g, '$1-$2').replace(/_/g, '-');
        return pattern.test(value);
    });
}

function largeEnough(width: number, height: number): boolean {
    return Math.min(width, height) >= 80 && Math.max(width, height) >= 120 && width * height >= 14_400;
}

function isVideoPreview(image: HTMLImageElement, rect: DOMRect): boolean {
    // 明确的播放器语义在 video 尚未挂载时也生效；不把整篇帖子当作播放器。
    if (image.closest('ytd-thumbnail, yt-thumbnail-view-model, .html5-video-player, .video-js, .jwplayer, .plyr--video')) return true;
    for (let element: Element | null = image, depth = 0; element && depth < 6; element = element.parentElement, depth++) {
        if (element.matches('body, html, article, main, section')) break;
        if (hasMarker(element, VIDEO_IMAGE_TOKEN)) return true;
        // 通用播放器只在近邻检查实际覆盖图片的视频，不因旁边存在视频误伤正文图片。
        if (depth > 0 && depth < 3) {
            const video = element.querySelector('video');
            if (video) {
                const bounds = video.getBoundingClientRect();
                const overlap = Math.max(0, Math.min(rect.right, bounds.right) - Math.max(rect.left, bounds.left))
                    * Math.max(0, Math.min(rect.bottom, bounds.bottom) - Math.max(rect.top, bounds.top));
                if (overlap >= rect.width * rect.height * 0.5) return true;
            }
        }
    }
    const href = image.closest('a[href]')?.getAttribute('href');
    if (href) {
        try {
            const url = new URL(href, document.baseURI || undefined);
            if (/(^|\.)(?:x\.com|twitter\.com)$/.test(url.hostname) && /\/status\/\d+\/video\/\d+\/?$/.test(url.pathname)) return true;
            if (/(^|\.)youtube\.com$/.test(url.hostname) && (url.pathname === '/watch' || url.pathname.startsWith('/shorts/'))) return true;
            if (url.hostname === 'youtu.be' && url.pathname.length > 1) return true;
        } catch { /* 无法解析的链接不作为视频证据。 */ }
    }
    return false;
}

export function isImageHoverEligible(image: HTMLImageElement): boolean {
    const rect = image.getBoundingClientRect();
    if (!largeEnough(rect.width, rect.height)) return false;
    // 高分辨率头像缩小显示、低分辨率图标被 CSS 放大，两种情况都需要过滤。
    if (image.naturalWidth > 0 && image.naturalHeight > 0 && !largeEnough(image.naturalWidth, image.naturalHeight)) return false;
    if (image.closest('[data-fluent-read-ui], video, button, [role="button"]')) return false;
    if (isVideoPreview(image, rect)) return false;
    for (let element: Element | null = image, depth = 0; element && depth < 3; element = element.parentElement, depth++) {
        if (element === document.body || element === document.documentElement) break;
        if (hasMarker(element, UI_IMAGE_TOKEN)) return false;
    }
    if (['alt', 'aria-label'].some(attribute => UI_IMAGE_LABEL.test((image.getAttribute(attribute) || '').trim()))) return false;
    const role = image.getAttribute('role');
    if (role === 'presentation' || role === 'none' || image.getAttribute('aria-hidden') === 'true') return false;
    // 只匹配明确的资源目录、文件名和头像服务；不搜索 URL 查询参数或普通描述中的关键词。
    try {
        const url = new URL(image.currentSrc || image.src, document.baseURI || undefined);
        if (url.hostname === 'avatars.githubusercontent.com' || /(^|\.)gravatar\.com$/.test(url.hostname)) return false;
        if (/\/(?:avatars?|userpics?|profile_images|icons?|favicons?|logos?|emoji|emoticons?|badges?)(?:\/|\.[a-z0-9]+$)/i.test(url.pathname)) return false;
        if (url.hostname === 'pbs.twimg.com' && /\/(?:ext_tw_video_thumb|amplify_video_thumb|tweet_video_thumb)\//.test(url.pathname)) return false;
        if (/(^|\.)(?:ytimg\.com|youtube\.com)$/.test(url.hostname) && /^\/(?:vi|vi_webp)\//.test(url.pathname)) return false;
    } catch { /* 尚未赋值或无法解析的资源交由现有图片加载流程处理。 */ }
    return true;
}
