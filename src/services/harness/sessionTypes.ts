/**
 * @file src/services/harness/sessionTypes.ts
 * 文件职责：定义 Harness 本机会话、turn、摘要和写入代次 token 的稳定数据合同。
 * 主要内容：声明会话正文、上下文、动作、状态和服务模型字段，供 UI 与 IndexedDB repository 共用。
 * 模块边界：本文件只描述可序列化类型，不读写数据库、不访问浏览器 API、不包含模型或页面逻辑。
 */
import type {HarnessActionId} from '@/src/core/config/harness';

export type HarnessStoredTurnStatus = 'streaming' | 'completed' | 'stopped' | 'error';

export interface HarnessStoredTurn {
    id: string;
    question: string;
    answer: string;
    intent: HarnessActionId;
    status: HarnessStoredTurnStatus;
    createdAt: number;
    service: string;
    model: string;
}

export interface HarnessSession {
    id: string;
    text: string;
    context: string;
    createdAt: number;
    updatedAt: number;
    intent: HarnessActionId;
    turns: HarnessStoredTurn[];
}

export interface HarnessSessionSummary {
    id: string;
    text: string;
    intent: HarnessActionId;
    updatedAt: number;
    turnCount: number;
}

export interface HarnessSessionGenerationToken {
    readonly epoch: number;
    readonly sessionId: string;
    readonly generation: number;
}

export interface HarnessSessionStore {
    captureGeneration(sessionId: string): HarnessSessionGenerationToken;
    upsertTurn(session: Omit<HarnessSession, 'turns'>, turn: HarnessStoredTurn, token: HarnessSessionGenerationToken): Promise<boolean>;
    get(id: string): Promise<HarnessSession | null>;
    list(offset?: number, limit?: number): Promise<{sessions: HarnessSessionSummary[]; hasMore: boolean}>;
    delete(id: string): Promise<void>;
    clear(): Promise<void>;
    prune(): Promise<number>;
    recoverInterrupted?(): Promise<void>;
}
