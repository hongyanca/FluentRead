/**
 * Userscript 页面上下文出口：共享长度预算，使用有界正文采集以免把
 * 仅供扩展复杂网页提取使用的 Defuddle 完整解析器打入每个页面。
 */
export {getPageTranslationContext, resetPageTranslationContextCache} from './pageContext';
export * from '@/src/services/translation/context/policy';
