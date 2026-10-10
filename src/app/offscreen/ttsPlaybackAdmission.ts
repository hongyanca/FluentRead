/**
 * @file src/app/offscreen/ttsPlaybackAdmission.ts
 * 文件职责：在实际 Audio 入口之前授予并消费一次性 TTS 播放许可，阻止 STOP 之前已投递的旧 PLAY 打断新音频。
 * 主要内容：以 CSPRNG 版本执行 READ/RESERVE 比较交换，仅保存实例身份、当前版本和一个待消费许可；STOP 按 route 撤销许可，PLAY 必须同步消费匹配许可，存活调用方仅在实例重建后重领。
 * 模块边界：不维护 UUID 墓碑、Map、timer 或存储，不处理 Audio；版本与许可属于当前接收端实例，不能代替浏览器 documentId 的 sender 身份保证。
 */
import {createSelectionTtsClientRequestId, parseSelectionTtsClientRequestId, parseSelectionTtsRoute,
    sameSelectionTtsRoute, type SelectionTtsRoute} from '@/src/features/selection-translation/protocol';

export function createSelectionTtsPlaybackAdmission() {
    let receiverId: string | undefined;
    let revision: string | undefined;
    let pending: {route: SelectionTtsRoute; token: string} | null = null;
    const advance = () => {
        receiverId ??= createSelectionTtsClientRequestId();
        revision = createSelectionTtsClientRequestId();
    };
    return {
        read(): {revision: string; receiverId: string} {
            if (revision === undefined) advance();
            return {revision: revision!, receiverId: receiverId!};
        },
        reserve(value: Record<string, unknown>): string | undefined {
            const route = parseSelectionTtsRoute(value);
            const expected = parseSelectionTtsClientRequestId(value.expectedRevision);
            if (revision === undefined || expected !== revision) return undefined;
            advance();
            const token = createSelectionTtsClientRequestId();
            pending = {route, token};
            return token;
        },
        stop(value: unknown): void {
            const route = parseSelectionTtsRoute(value);
            // 即使旧 PLAY 尚未领取许可，STOP 也使其已读取的版本失效。
            // 不同 route 的迟到 STOP 不撤销 B 已领取的许可或正在播放的 Audio。
            advance();
            if (pending && sameSelectionTtsRoute(pending.route, route)) pending = null;
        },
        consume(value: Record<string, unknown>): boolean {
            const route = parseSelectionTtsRoute(value);
            const token = parseSelectionTtsClientRequestId(value.playbackToken);
            if (!pending || token !== pending.token || !sameSelectionTtsRoute(pending.route, route)) {
                return false;
            }
            pending = null;
            advance();
            return true;
        },
    };
}
