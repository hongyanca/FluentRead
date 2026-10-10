import {describe, expect, it} from 'vitest';
import {WRITING_LENGTHS, WRITING_ROLES, WRITING_STYLES, WRITING_TONES} from '@/src/core/config/writing';
import {WRITING_PREVIEW_SCENARIO, isWritingPreviewPreset, writingPreviewFallbacks, writingPreviewParagraphs} from '@/src/core/config/writingPreview';

const base = {length: 'standard', style: 'auto', tone: 'natural', role: 'auto'} as const;

describe('写作助手设置页示例草稿', () => {
  it('示例在只有反馈时不虚构复现、根因或修复承诺', () => {
    for (const {value: length} of WRITING_LENGTHS) {
      for (const {value: role} of WRITING_ROLES) {
        const text = writingPreviewParagraphs({...base, length, role}).map(item => item.text).join('\n');
        expect(text).not.toMatch(/已复现|已确认|我复现了|复现后|排进|这周给|已经整理|关闭其他扩展后/);
        expect(text).toMatch(/确认|不明|核实/);
      }
    }
  });
  it('简短压缩正文但保留角色，详细增加说明', () => {
    const short = writingPreviewParagraphs({...base, length: 'short'});
    const standard = writingPreviewParagraphs({...base, length: 'standard'});
    const detailed = writingPreviewParagraphs({...base, length: 'detailed'});
    expect(short.map(item => item.slot)).toEqual(['opening', 'body', 'focus']);
    expect(standard.map(item => item.slot)).toEqual(['opening', 'body', 'focus']);
    expect(detailed.map(item => item.slot)).toEqual(['opening', 'body', 'focus', 'detail']);
    expect(short[1].text.length).toBeLessThan(standard[1].text.length);
    expect(short[2]).toEqual(standard[2]);
    expect(detailed.slice(0, 3)).toEqual(standard);
    for (const paragraph of detailed) expect(paragraph.text.trim()).not.toBe('');
    expect(WRITING_PREVIEW_SCENARIO).toMatch(/[㐀-鿿]/u);
  });

  it('每个预设语气、风格和角色都写出不同的示例句', () => {
    const openings = WRITING_TONES.map(item => writingPreviewParagraphs({...base, tone: item.value})[0].text);
    const bodies = WRITING_STYLES.map(item => writingPreviewParagraphs({...base, style: item.value})[1].text);
    const focuses = WRITING_ROLES.map(item => writingPreviewParagraphs({...base, role: item.value})[2].text);
    expect(new Set(openings).size).toBe(WRITING_TONES.length);
    expect(new Set(bodies).size).toBe(WRITING_STYLES.length);
    expect(new Set(focuses).size).toBe(WRITING_ROLES.length);
    for (const {value} of WRITING_TONES) expect(isWritingPreviewPreset(value, 'tone')).toBe(true);
    for (const {value} of WRITING_ROLES) expect(isWritingPreviewPreset(value, 'role')).toBe(true);
  });

  it.each(WRITING_LENGTHS)('$label下每个按钮都改变范例正文', ({value: length}) => {
    for (const [field, options] of [['style', WRITING_STYLES], ['tone', WRITING_TONES], ['role', WRITING_ROLES]] as const) {
      const texts = options.map(({value}) => writingPreviewParagraphs({...base, length, [field]: value}).map(p => p.text).join('\n'));
      expect(new Set(texts).size).toBe(options.length);
    }
  });

  it('自定义语气或角色回落到默认表达，并说明回落了哪一项', () => {
    const custom = {...base, length: 'detailed', tone: '耐心、鼓励', role: '正在排查问题的维护者'} as const;
    expect(writingPreviewFallbacks(custom)).toEqual(['tone', 'role']);
    expect(writingPreviewFallbacks({tone: '耐心', role: 'developer'})).toEqual(['tone']);
    expect(writingPreviewFallbacks({tone: 'firm', role: '主理人'})).toEqual(['role']);
    expect(writingPreviewFallbacks({tone: 'firm', role: 'developer'})).toEqual([]);
    expect(writingPreviewParagraphs(custom)).toEqual(writingPreviewParagraphs({...base, length: 'detailed'}));
    expect(isWritingPreviewPreset('detail', 'tone')).toBe(false);
  });

  it('未知长度和风格回落到最短示例，不抛出异常', () => {
    const unknown = writingPreviewParagraphs({length: 'huge' as never, style: 'fancy' as never, tone: 'natural', role: 'auto'});
    expect(unknown.map(item => item.slot)).toEqual(['opening', 'body', 'focus']);
    expect(unknown[1].text).toBe(writingPreviewParagraphs({...base, length: 'short', style: 'auto'})[1].text);
    for (const {value} of WRITING_LENGTHS) expect(writingPreviewParagraphs({...base, length: value}).length).toBeGreaterThan(1);
  });
});
