/**
 * @file tests/modalProgressHint.test.ts
 * 文件职责：验证全文翻译原生 modal 提示的创建、阶段文案、禁用清理和宿主删除后的有限修复边界。
 * 主要内容：使用轻量 DOM 伪造 dialog:modal，确认提示节点属于 FluentRead、使用 closed shadow，并在关闭后允许重新创建。
 * 模块边界：测试只覆盖 modalProgressHint 的 DOM 状态，不触发全文翻译 runtime、provider 或浏览器焦点行为。
 */
import {parseHTML} from 'linkedom';
import {describe, expect, it} from 'vitest';
import {syncModalTranslationHint} from '@/src/features/full-page-translation/ui/modalProgressHint';

function installDom() {
  const window = parseHTML('<html><body><dialog id="modal"></dialog></body></html>');
  Object.assign(globalThis, {document: window.document, Node: window.Node});
  const modal = window.document.querySelector('#modal') as HTMLDialogElement;
  modal.open = true;
  Object.defineProperty(modal, 'matches', {configurable: true, value: (selector: string) => selector === ':modal'});
  return {window, modal};
}

describe('modal translation progress hint', () => {
  it('accepts a missing modal during cleanup', () => {
    expect(() => syncModalTranslationHint(null, 'none', true)).not.toThrow();
  });

  it('creates a closed shadow hint only for an active native modal', () => {
    const {window, modal} = installDom();
    const capturedShadow = {value: null as ShadowRoot | null};
    const attachShadow = window.HTMLElement.prototype.attachShadow;
    Object.defineProperty(window.HTMLElement.prototype, 'attachShadow', {
      configurable: true,
      value(this: HTMLElement, options: ShadowRootInit) {
        capturedShadow.value = attachShadow.call(this, options);
        return capturedShadow.value;
      },
    });
    syncModalTranslationHint(modal, 'translating', true);
    const hint = modal.querySelector('[data-fr-translation-modal-hint]') as HTMLElement;
    expect(hint).not.toBeNull();
    expect(hint.getAttribute('data-fr-translation-owned')).toBe('true');
    expect(hint.getAttribute('aria-label')).toBe('正在翻译弹窗');
    expect(hint.shadowRoot).toBeNull();
    expect(capturedShadow.value?.querySelector('span')?.textContent).toBe('正在翻译弹窗');
    expect(modal.querySelectorAll('[data-fr-translation-modal-hint]')).toHaveLength(1);
    syncModalTranslationHint(modal, 'waiting', true);
    expect(modal.querySelectorAll('[data-fr-translation-modal-hint]')).toHaveLength(1);
    expect(hint.getAttribute('aria-label')).toBe('关闭弹窗后自动继续翻译');
    expect(capturedShadow.value?.querySelector('span')?.textContent).toBe('关闭弹窗后自动继续翻译');
    syncModalTranslationHint(modal, 'translating', true);
    expect(hint.getAttribute('aria-label')).toBe('正在翻译弹窗');
    expect(capturedShadow.value?.querySelector('span')?.textContent).toBe('正在翻译弹窗');
  });

  it('cleans disabled, non-modal, and none states without touching host dialog behavior', () => {
    const {modal} = installDom();
    syncModalTranslationHint(modal, 'waiting', true);
    expect(modal.querySelector('[data-fr-translation-modal-hint]')).not.toBeNull();
    syncModalTranslationHint(modal, 'waiting', false);
    expect(modal.querySelector('[data-fr-translation-modal-hint]')).toBeNull();
    syncModalTranslationHint(modal, 'translating', true);
    expect(modal.querySelector('[data-fr-translation-modal-hint]')).not.toBeNull();
    syncModalTranslationHint(modal, 'none', true);
    expect(modal.querySelector('[data-fr-translation-modal-hint]')).toBeNull();
    Object.defineProperty(modal, 'matches', {configurable: true, value: () => false});
    syncModalTranslationHint(modal, 'waiting', true);
    expect(modal.querySelector('[data-fr-translation-modal-hint]')).toBeNull();
  });

  it('ignores modal pseudo-class checks that the host browser cannot evaluate', () => {
    const {modal} = installDom();
    Object.defineProperty(modal, 'matches', {configurable: true, value: () => { throw new Error('unsupported'); }});
    syncModalTranslationHint(modal, 'waiting', true);
    expect(modal.querySelector('[data-fr-translation-modal-hint]')).toBeNull();
  });

  it('does not continuously reinsert a deleted hint until the modal closes', () => {
    const {modal} = installDom();
    syncModalTranslationHint(modal, 'waiting', true);
    const hint = modal.querySelector('[data-fr-translation-modal-hint]') as HTMLElement;
    hint.remove();
    syncModalTranslationHint(modal, 'waiting', true);
    expect(modal.querySelector('[data-fr-translation-modal-hint]')).toBeNull();
    modal.open = false;
    syncModalTranslationHint(modal, 'none', true);
    modal.open = true;
    syncModalTranslationHint(modal, 'waiting', true);
    expect(modal.querySelector('[data-fr-translation-modal-hint]')).not.toBeNull();
  });

  it('cleans the previous modal when another modal becomes active', () => {
    const {window, modal} = installDom();
    const next = window.document.createElement('dialog') as HTMLDialogElement;
    next.open = true;
    Object.defineProperty(next, 'matches', {configurable: true, value: (selector: string) => selector === ':modal'});
    window.document.body.appendChild(next);
    syncModalTranslationHint(modal, 'waiting', true);
    syncModalTranslationHint(next, 'translating', true);
    expect(modal.querySelector('[data-fr-translation-modal-hint]')).toBeNull();
    expect(next.querySelector('[data-fr-translation-modal-hint]')).not.toBeNull();
    syncModalTranslationHint(null, 'none', true);
    expect(next.querySelector('[data-fr-translation-modal-hint]')).toBeNull();
  });
});
