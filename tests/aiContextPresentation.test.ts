import {describe, expect, it} from 'vitest';
import {
    resolveAIContextPresentation,
    type AIContextPresentationInput,
    type AIContextPresentationState,
} from '@/src/ui/view-model/aiContext';

const availableService: AIContextPresentationInput = {
    enabled: false,
    supported: true,
    pluginEnabled: true,
    siteDisabled: false,
    unavailable: false,
    missingCredentials: false,
    translating: false,
};

describe('AI 智能上下文展示状态', () => {
    it('同一可用服务可以保存开启和关闭偏好，展示状态不声称已处理现有译文', () => {
        const savedPreference = {...availableService};
        expect(resolveAIContextPresentation(savedPreference)).toEqual({
            state: 'off',
            descriptionKey: 'popup.aiContext.description.off',
            toggleDisabled: false,
        });

        savedPreference.enabled = true;
        expect(resolveAIContextPresentation(savedPreference)).toEqual({
            state: 'ready',
            descriptionKey: 'popup.aiContext.description.ready',
            toggleDisabled: false,
        });
        expect(savedPreference).toEqual({...availableService, enabled: true});
    });

    it.each([false, true])('机器翻译保留提前配置权限，偏好为 %s 时都说明服务不支持', enabled => {
        expect(resolveAIContextPresentation({...availableService, enabled, supported: false})).toEqual({
            state: 'unsupported',
            descriptionKey: 'popup.aiContext.description.unsupported',
            toggleDisabled: false,
        });
    });

    it.each([false, true])('缺少 API Key 时不隐藏配置提醒，也不阻止保存 %s 偏好', enabled => {
        expect(resolveAIContextPresentation({...availableService, enabled, missingCredentials: true})).toEqual({
            state: 'needs-setup',
            descriptionKey: 'popup.aiContext.description.needsSetup',
            toggleDisabled: false,
        });
    });

    it('浏览器不可用时优先说明平台限制，仍允许保存跨服务偏好', () => {
        expect(resolveAIContextPresentation({
            ...availableService,
            enabled: true,
            unavailable: true,
            supported: false,
            missingCredentials: true,
        })).toEqual({
            state: 'unavailable',
            descriptionKey: 'popup.aiContext.description.unavailable',
            toggleDisabled: false,
        });
    });

    it('翻译专用模型即使缺少凭据，也应先说明不支持上下文', () => {
        expect(resolveAIContextPresentation({
            ...availableService,
            enabled: true,
            supported: false,
            missingCredentials: true,
        })).toEqual({
            state: 'unsupported',
            descriptionKey: 'popup.aiContext.description.unsupported',
            toggleDisabled: false,
        });
    });

    it('全局暂停时优先解释插件暂停，并锁定当前页面的开关操作', () => {
        expect(resolveAIContextPresentation({
            ...availableService,
            enabled: true,
            pluginEnabled: false,
            siteDisabled: true,
            unavailable: true,
            supported: false,
            missingCredentials: true,
        })).toEqual({
            state: 'paused',
            descriptionKey: 'popup.aiContext.description.paused',
            toggleDisabled: true,
        });
    });

    it('仅当前网站禁用时说明网站限制，避免引导用户重复配置服务', () => {
        expect(resolveAIContextPresentation({
            ...availableService,
            enabled: true,
            siteDisabled: true,
            unavailable: true,
            supported: false,
            missingCredentials: true,
        })).toEqual({
            state: 'paused',
            descriptionKey: 'popup.aiContext.description.sitePaused',
            toggleDisabled: true,
        });
    });

    it.each<[string, Partial<AIContextPresentationInput>, AIContextPresentationState]>([
        ['关闭偏好', {}, 'off'],
        ['开启偏好', {enabled: true}, 'ready'],
        ['缺少凭据', {missingCredentials: true}, 'needs-setup'],
        ['服务不支持', {supported: false}, 'unsupported'],
        ['浏览器不可用', {unavailable: true}, 'unavailable'],
        ['插件暂停', {pluginEnabled: false}, 'paused'],
        ['网站禁用', {siteDisabled: true}, 'paused'],
    ])('切换网页翻译期间保留%s状态，只暂时替换说明和锁定操作', (_label, scenario, state) => {
        expect(resolveAIContextPresentation({...availableService, ...scenario, translating: true})).toEqual({
            state,
            descriptionKey: 'popup.aiContext.description.translating',
            toggleDisabled: true,
        });
    });
});
