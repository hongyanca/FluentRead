/**
 * @file src/shared/function/sha256.ts
 * 文件职责：提供同步 UTF-8 文本 SHA-256 摘要，统一缓存、配置身份与供应商签名使用的十六进制格式。
 * 主要内容：复用项目已有的 noble-hashes 实现，避免内容脚本为摘要加载另一套 CryptoJS 核心与编码器。
 * 模块边界：只计算传入文本，不缓存原文或密钥，不依赖浏览器、配置与业务模块。
 */
import {sha256} from '@noble/hashes/sha2';
import {bytesToHex} from '@noble/hashes/utils';

export function sha256Hex(value: string): string {
    return bytesToHex(sha256(value));
}
