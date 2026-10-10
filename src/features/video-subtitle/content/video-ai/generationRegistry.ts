/**
 * @file src/features/video-subtitle/content/video-ai/generationRegistry.ts
 * 文件职责：记录已取消的标签页/音频流/generation 三元组，拦截迟到的后台识别结果。
 * 主要内容：提供有界集合、稳定身份键和旧请求查询，不承担请求取消本身。
 * 模块边界：只保存纯内存 generation 状态，不访问浏览器存储或页面播放器。
 */
export interface VideoAiGenerationIdentity {
  tabId: number;
  streamId: string;
  generation: number;
}

/** 有界记录已取消 generation，拒绝取消消息之后才到达 background 的旧请求。 */
export class VideoAiCanceledGenerationRegistry {
  private readonly keys = new Set<string>();

  constructor(private readonly limit = 128) {}

  private key(identity: VideoAiGenerationIdentity): string {
    return `${identity.tabId}:${identity.streamId}:${identity.generation}`;
  }

  mark(identity: VideoAiGenerationIdentity): void {
    this.keys.add(this.key(identity));
    while (this.keys.size > this.limit) {
      const oldest = this.keys.values().next().value;
      if (typeof oldest !== 'string') break;
      this.keys.delete(oldest);
    }
  }

  has(identity: VideoAiGenerationIdentity): boolean {
    return this.keys.has(this.key(identity));
  }
}
