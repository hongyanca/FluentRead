/**
 * @file src/app/background/handlers/areaTranslation.ts
 * 文件职责：作为后台组合层的区域翻译导出入口，把 area-translation feature 的公开后台契约集中暴露给 message runtime。
 * 主要内容：完整转发区域截图翻译所需的 handler 工厂、消息类型与相关类型，使后台注册代码保持稳定的 app 层导入路径。
 * 模块边界：此处是无状态 barrel，不包含截图、OCR、翻译或 Offscreen 调用实现，也不扩展 feature 的内部 API；真实业务逻辑归 src/features/area-translation/background 所有。
 */
export * from '@/src/features/area-translation/background';
