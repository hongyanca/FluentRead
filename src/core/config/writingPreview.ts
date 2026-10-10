/**
 * @file src/core/config/writingPreview.ts
 * 文件职责：为写作助手设置页提供“当前偏好会写出什么”的示例草稿数据，让抽象的长度、风格、语气和角色有可见结果。
 * 主要内容：固定一个尚待核实的反馈场景，按语气选择开场、按风格选择正文、按角色选择关注点，示例不虚构复现结果、归因或处理承诺，所有长度保留三项偏好，简短压缩正文、详细增加说明；自定义描述回落到默认表达并显式标记。
 * 模块边界：只返回纯文本片段，不请求模型、不读取配置存储、不渲染界面；真实草稿仍由后台写作运行时生成。
 */
import {WRITING_ROLES, WRITING_TONES, type WritingLength, type WritingStyle} from './writing';

/** 示例统一使用同一条反馈，改动偏好时只有表达方式变化，便于对比。 */
export const WRITING_PREVIEW_SCENARIO = '有人反馈：长页面滚动时偶尔整段没有翻译。';

export type WritingPreviewSlot = 'opening' | 'body' | 'focus' | 'detail';
export interface WritingPreviewParagraph {slot: WritingPreviewSlot; text: string}
export interface WritingPreviewInput {
    length: WritingLength; style: WritingStyle; tone: string; role: string;
}

const openings: Record<typeof WRITING_TONES[number]['value'], string> = {
    natural: '谢谢你说明这个情况。',
    professional: '感谢提供这条反馈。',
    friendly: '谢谢反馈！这个我们来看看。',
    warm: '谢谢你专门来说这件事，辛苦了。',
    sincere: '谢谢你认真指出这个问题。',
    empathetic: '读到一半发现整段没翻译，确实很影响阅读。',
    firm: '这个问题值得认真确认。',
};
const bodies: Record<WritingStyle, string> = {
    auto: '从你的描述看，长页面滚动时偶尔会漏掉整段翻译，目前还需要确认出现的条件。',
    formal: '根据您提供的信息，长页面滚动过程中可能存在段落漏译，具体触发条件尚待核实。',
    neutral: '反馈涉及长页面滚动时偶发的整段漏译，暂时还不能确定原因。',
    casual: '听起来是长页面滚着滚着就漏了一段，具体什么时候出现还得再看看。',
};
const shortBodies: Record<WritingStyle, string> = {
    auto: '目前还需要确认漏译的触发条件。',
    formal: '具体触发条件尚待核实。',
    neutral: '漏译原因暂时不明。',
    casual: '还得看看什么时候会漏。',
};
const focuses: Record<typeof WRITING_ROLES[number]['value'], string> = {
    auto: '能否补充页面链接和操作步骤，方便进一步确认？',
    maintainer: '请补充页面和复现步骤，便于确认影响范围，再安排后续排查。',
    developer: '请提供浏览器版本和最短复现步骤，帮助区分页面行为与插件问题。',
    user: '希望能确认有没有临时解决办法，方便继续阅读。',
    colleague: '要不我们先对一下复现环境，再决定谁来跟进？',
    support: '方便提供一下浏览器版本和页面链接吗？我同步给技术同事。',
    leader: '建议先确认影响范围和排查成本，再决定处理优先级。',
    subordinate: '建议先补齐复现信息，请确认是否按这个方向继续排查。',
};
const detail = '如果方便，也请说明漏译是在首次打开还是滚动后出现，以及重新翻译是否有效；这些信息有助于缩小排查范围。';
const slotsByLength: Record<WritingLength, readonly WritingPreviewSlot[]> = {
    short: ['opening', 'body', 'focus'],
    standard: ['opening', 'body', 'focus'],
    detailed: ['opening', 'body', 'focus', 'detail'],
};

/** 自定义语气或角色只在真实生成时生效，示例回落到默认表达而不是留空。 */
export function isWritingPreviewPreset(value: string, kind: 'tone' | 'role'): boolean {
    return kind === 'tone' ? Object.hasOwn(openings, value) : Object.hasOwn(focuses, value);
}
export function writingPreviewFallbacks(input: Pick<WritingPreviewInput, 'tone' | 'role'>): Array<'tone' | 'role'> {
    const result: Array<'tone' | 'role'> = [];
    if (!isWritingPreviewPreset(input.tone, 'tone')) result.push('tone');
    if (!isWritingPreviewPreset(input.role, 'role')) result.push('role');
    return result;
}
export function writingPreviewParagraphs(input: WritingPreviewInput): WritingPreviewParagraph[] {
    const tone = isWritingPreviewPreset(input.tone, 'tone') ? input.tone as keyof typeof openings : 'natural';
    const role = isWritingPreviewPreset(input.role, 'role') ? input.role as keyof typeof focuses : 'auto';
    const style = Object.hasOwn(bodies, input.style) ? input.style : 'auto';
    const length = Object.hasOwn(slotsByLength, input.length) ? input.length : 'short';
    const text: Record<WritingPreviewSlot, string> = {opening: openings[tone], body: length === 'short' ? shortBodies[style] : bodies[style], focus: focuses[role], detail};
    return slotsByLength[length].map(slot => ({slot, text: text[slot]}));
}
