/**
 * @file src/platform/storage/harnessSessionRepository.ts
 * 文件职责：在扩展私有 IndexedDB 中保存 Harness 的短期阅读会话与问答 turn。
 * 主要内容：提供单例 repository、原子 upsert、全局/会话 generation、30 天逐 turn 过期清理和分页摘要读取。
 * 模块边界：只存储显式白名单字段，不读取配置/API Key/URL，不执行模型请求；会话编排通过 HarnessSessionStore 接口依赖本模块。
 */
import Dexie, {type Table} from 'dexie';
import type {HarnessSession, HarnessSessionGenerationToken, HarnessSessionStore, HarnessSessionSummary, HarnessStoredTurn} from '@/src/services/harness/sessionTypes';
import {isHarnessTurnExpired, normalizeHarnessSession, normalizeHarnessStoredTurn} from '@/src/services/harness/sessions';

interface StoredHarnessSession extends HarnessSession { oldestTurnAt?: number }

export const HARNESS_SESSION_DATABASE_NAME = 'FluentReadHarnessSessions' as const;
export const HARNESS_SESSION_DATABASE_VERSION = 2 as const;
export const HARNESS_SESSION_DEFAULT_PAGE_SIZE = 20 as const;

export class FluentReadHarnessSessionDatabase extends Dexie {
    sessions!: Table<StoredHarnessSession, string>;

    constructor(name: string = HARNESS_SESSION_DATABASE_NAME) {
        super(name);
        this.version(1).stores({
            sessions: '&id, updatedAt, createdAt',
        });
        this.version(HARNESS_SESSION_DATABASE_VERSION).stores({
            sessions: '&id, updatedAt, createdAt, oldestTurnAt',
        }).upgrade(async transaction => {
            await transaction.table('sessions').toCollection().modify((session: StoredHarnessSession) => {
                session.oldestTurnAt = session.turns.reduce((oldest, turn) => Math.min(oldest, turn.createdAt), Number.MAX_SAFE_INTEGER);
            });
        });
    }
}

function validOffset(value: unknown): number {
    return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : 0;
}

function validLimit(value: unknown): number {
    return typeof value === 'number' && Number.isInteger(value) && value >= 1 ? Math.min(value, 100) : HARNESS_SESSION_DEFAULT_PAGE_SIZE;
}

function cloneSession(session: StoredHarnessSession): HarnessSession {
    const {oldestTurnAt: _oldestTurnAt, ...publicSession} = structuredClone(session);
    return publicSession;
}

function cleanSession(session: StoredHarnessSession, now: number): {session: StoredHarnessSession | null; removed: number} {
    const turns = session.turns.filter(turn => !isHarnessTurnExpired(turn, now));
    if (turns.length === 0) return {session: null, removed: session.turns.length};
    return {session: {...session, turns, oldestTurnAt: turns.reduce((oldest, turn) => Math.min(oldest, turn.createdAt), Number.MAX_SAFE_INTEGER)}, removed: session.turns.length - turns.length};
}

function summary(session: HarnessSession): HarnessSessionSummary {
    return {id: session.id, text: session.text, intent: session.intent, updatedAt: session.updatedAt, turnCount: session.turns.length};
}

export class HarnessSessionRepository implements HarnessSessionStore {
    private epoch = 0;
    private readonly sessionGenerations = new Map<string, number>();

    constructor(readonly database: FluentReadHarnessSessionDatabase = new FluentReadHarnessSessionDatabase()) {}

    captureGeneration(sessionId: string): HarnessSessionGenerationToken {
        return {epoch: this.epoch, sessionId, generation: this.sessionGenerations.get(sessionId) || 0};
    }

    private tokenCurrent(token: HarnessSessionGenerationToken, sessionId: string): boolean {
        return token.sessionId === sessionId && token.epoch === this.epoch && token.generation === (this.sessionGenerations.get(sessionId) || 0);
    }

    private bump(sessionId?: string): void {
        if (sessionId) {
            this.sessionGenerations.set(sessionId, (this.sessionGenerations.get(sessionId) || 0) + 1);
            return;
        }
        this.epoch += 1;
    }

    private async cleanExpired(now = Date.now()): Promise<number> {
        const cutoff = now - 30 * 24 * 60 * 60 * 1000;
        const all = await this.database.sessions.where('oldestTurnAt').belowOrEqual(cutoff).toArray();
        let removed = 0;
        for (const original of all) {
            const cleaned = cleanSession(original, now);
            if (!cleaned.session) {
                await this.database.sessions.delete(original.id);
                removed += cleaned.removed || 1;
            } else if (cleaned.removed > 0) {
                await this.database.sessions.put(cleaned.session);
                removed += cleaned.removed;
            }
        }
        return removed;
    }

    async upsertTurn(sessionInput: Omit<HarnessSession, 'turns'>, turnInput: HarnessStoredTurn, token: HarnessSessionGenerationToken): Promise<boolean> {
        const session = normalizeHarnessSession({...sessionInput, turns: []});
        const turn = normalizeHarnessStoredTurn(turnInput);
        if (!this.tokenCurrent(token, session.id)) return false;
        const now = Date.now();
        return this.database.transaction('rw', this.database.sessions, async () => {
            if (!this.tokenCurrent(token, session.id)) return false;
            await this.cleanExpired(now);
            if (isHarnessTurnExpired(turn, now)) return false;
            const existing = await this.database.sessions.get(session.id);
            if (!this.tokenCurrent(token, session.id)) return false;
            const turns = existing?.turns ? [...existing.turns] : [];
            const index = turns.findIndex(item => item.id === turn.id);
            if (index >= 0) turns[index] = turn;
            else turns.push(turn);
            const merged = normalizeHarnessSession({
                ...session, createdAt: existing?.createdAt ?? session.createdAt,
                updatedAt: Math.max(existing?.updatedAt ?? 0, session.updatedAt, turn.createdAt),
                intent: existing && existing.updatedAt > session.updatedAt ? existing.intent : session.intent,
                turns,
            });
            await this.database.sessions.put({...merged, oldestTurnAt: turns.reduce((oldest, item) => Math.min(oldest, item.createdAt), Number.MAX_SAFE_INTEGER)});
            return true;
        });
    }

    async get(id: string): Promise<HarnessSession | null> {
        return this.database.transaction('rw', this.database.sessions, async () => {
            await this.cleanExpired();
            const session = await this.database.sessions.get(id);
            return session ? cloneSession(session) : null;
        });
    }

    async list(offset: number = 0, limit: number = HARNESS_SESSION_DEFAULT_PAGE_SIZE): Promise<{sessions: HarnessSessionSummary[]; hasMore: boolean}> {
        return this.database.transaction('rw', this.database.sessions, async () => {
            await this.cleanExpired();
            const start = validOffset(offset);
            const size = validLimit(limit);
            const page = await this.database.sessions.orderBy('updatedAt').reverse().offset(start).limit(size + 1).toArray();
            return {sessions: page.slice(0, size).map(summary), hasMore: page.length > size};
        });
    }

    async delete(id: string): Promise<void> {
        this.bump(id);
        await this.database.sessions.delete(id);
    }

    async clear(): Promise<void> {
        this.bump();
        this.sessionGenerations.clear();
        await this.database.sessions.clear();
    }

    async prune(): Promise<number> {
        return this.database.transaction('rw', this.database.sessions, () => this.cleanExpired(Date.now()));
    }

    /** Service worker 重启后，所有仍处于 streaming 的 turn 都已失去执行者。 */
    async recoverInterrupted(): Promise<void> {
        await this.database.transaction('rw', this.database.sessions, async () => {
            const sessions = await this.database.sessions.toArray();
            const now = Date.now();
            for (const original of sessions) {
                const cleaned = cleanSession(original, now);
                if (!cleaned.session) {
                    await this.database.sessions.delete(original.id);
                    continue;
                }
                const turns = cleaned.session.turns.map(turn => turn.status === 'streaming' ? {...turn, status: 'stopped' as const} : turn);
                await this.database.sessions.put({...cleaned.session, turns, oldestTurnAt: turns.reduce((oldest, turn) => Math.min(oldest, turn.createdAt), Number.MAX_SAFE_INTEGER)});
            }
        });
    }
}

export const harnessSessionRepository = new HarnessSessionRepository();
