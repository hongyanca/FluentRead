/**
 * @file src/services/config/autoBackupStore.ts
 * 文件职责：在配置 store 与后台加密 IndexedDB 之间持久化自动备份，并为设置页提供订阅、捕获和安全恢复入口。
 * 主要内容：初始化或修复备份基线，串行写入最多十份加密 IndexedDB 快照，响应配置仓库 watch，同步通知监听者，并优先通过后台消息恢复后返回最新历史状态。
 * 模块边界：本文件编排存储和跨上下文通信，不定义快照领域规则或定时周期；纯状态转换位于 autoBackup，alarm 调度位于 app/background runtime。
 */
import {configStorage as storage} from '@/src/platform/storage/configStorageRuntime';
import {
    appendConfigAutoBackup,
    cloneConfigAutoBackups,
    createBaselineConfigAutoBackups,
    findConfigAutoBackup,
    parseConfigAutoBackups,
    restoreRestorableConfig,
    serializeConfigAutoBackups,
    type ConfigAutoBackupState,
} from './autoBackup';
import {
    config,
    configHistoryReady,
    configReady,
    getConfigHistorySnapshot,
    saveConfig,
    type ConfigHistoryState,
} from './store';

export const CONFIG_AUTO_BACKUP_STORAGE_KEY = 'local:configAutoBackups' as const;
export const CONFIG_AUTO_BACKUP_RESTORE_MESSAGE = 'configAutoBackupRestore' as const;

export interface CaptureConfigAutoBackupOptions {
    config?: unknown;
    savedAt?: string;
}

export interface ConfigAutoBackupRestoreResult {
    backups: ConfigAutoBackupState;
    history: ConfigHistoryState;
}

type ConfigAutoBackupListener = (nextBackups: ConfigAutoBackupState) => void;
type ConfigAutoBackupMessageResponse = {
    success?: boolean;
    error?: string;
    result?: ConfigAutoBackupRestoreResult;
} | undefined;
type ConfigAutoBackupMessageSender = (message: {
    type: typeof CONFIG_AUTO_BACKUP_RESTORE_MESSAGE;
    version: number;
}) => Promise<ConfigAutoBackupMessageResponse>;

const listeners = new Set<ConfigAutoBackupListener>();
let backupState: ConfigAutoBackupState;
let initialized = false;
let lastSerialized = '';
let writeQueue: Promise<void> = Promise.resolve();
let captureQueue: Promise<void> = Promise.resolve();

function notifyListeners(): void {
    if (!backupState) return;
    const snapshot = cloneConfigAutoBackups(backupState);
    listeners.forEach((listener) => listener(snapshot));
}

function setBackupState(nextState: ConfigAutoBackupState, notify = true): void {
    const next = cloneConfigAutoBackups(nextState);
    const serialized = serializeConfigAutoBackups(next);
    const changed = serialized !== lastSerialized;
    backupState = next;
    lastSerialized = serialized;
    if (notify && changed) notifyListeners();
}

function handleStoredBackupsChange(value: unknown): void {
    const parsed = parseConfigAutoBackups(value);
    if (!parsed) return;
    if (serializeConfigAutoBackups(parsed) === lastSerialized) return;
    setBackupState(parsed);
}

storage.watch(CONFIG_AUTO_BACKUP_STORAGE_KEY, handleStoredBackupsChange);

async function persistBackupState(nextState: ConfigAutoBackupState): Promise<void> {
    const next = cloneConfigAutoBackups(nextState);
    writeQueue = writeQueue
        .catch(() => undefined)
        .then(async () => {
            await storage.setItem<ConfigAutoBackupState>(CONFIG_AUTO_BACKUP_STORAGE_KEY, next);
            setBackupState(next);
        });
    await writeQueue;
}

async function initializeConfigAutoBackups(): Promise<void> {
    try {
        await configReady;
        const stored = await storage.getItem<unknown>(CONFIG_AUTO_BACKUP_STORAGE_KEY);
        const parsed = parseConfigAutoBackups(stored);
        if (parsed) {
            initialized = true;
            setBackupState(parsed, false);
            // 解析同时完成上限、凭据和非恢复字段迁移；有变化时立即清理旧存储。
            if (JSON.stringify(stored) !== serializeConfigAutoBackups(parsed)) {
                try {
                    await storage.setItem<ConfigAutoBackupState>(CONFIG_AUTO_BACKUP_STORAGE_KEY, parsed);
                } catch (error) {
                    console.warn('[FluentRead] 自动配置备份可恢复投影迁移暂未落盘', error);
                }
            }
            return;
        }

        const baseline = createBaselineConfigAutoBackups(config);
        await storage.setItem<ConfigAutoBackupState>(CONFIG_AUTO_BACKUP_STORAGE_KEY, baseline);
        initialized = true;
        setBackupState(baseline, false);
    } catch (error) {
        initialized = true;
        setBackupState(createBaselineConfigAutoBackups(config), false);
        console.error('[FluentRead] 自动配置备份读取失败，使用当前配置基线', error);
    }
}

export const configAutoBackupsReady = initializeConfigAutoBackups();

export function getConfigAutoBackupsSnapshot(): ConfigAutoBackupState {
    return cloneConfigAutoBackups(backupState || createBaselineConfigAutoBackups(config));
}

export function subscribeConfigAutoBackups(listener: ConfigAutoBackupListener): () => void {
    listeners.add(listener);
    if (initialized && backupState) listener(getConfigAutoBackupsSnapshot());
    return () => listeners.delete(listener);
}

/** 串行捕获时间检查点，保证重叠 alarm 不会复用 version 或丢失其中一份。 */
export function captureConfigAutoBackup(
    options: CaptureConfigAutoBackupOptions = {},
): Promise<ConfigAutoBackupState> {
    const capture = captureQueue
        .catch(() => undefined)
        .then(async () => {
            await configAutoBackupsReady;
            const next = appendConfigAutoBackup(
                backupState,
                options.config === undefined ? config : options.config,
                options.savedAt,
            );
            await persistBackupState(next);
            return getConfigAutoBackupsSnapshot();
        });
    captureQueue = capture.then(() => undefined, () => undefined);
    return capture;
}

export async function restoreConfigAutoBackup(version: number): Promise<ConfigAutoBackupRestoreResult> {
    await Promise.all([configAutoBackupsReady, configHistoryReady]);
    const entry = findConfigAutoBackup(backupState, version);
    if (!entry) throw new Error(`自动备份 v${version} 不存在`);

    const restored = restoreRestorableConfig(entry.config, config);
    await saveConfig(restored, {recordHistory: true, immediateHistory: true});
    return {
        backups: getConfigAutoBackupsSnapshot(),
        history: getConfigHistorySnapshot(),
    };
}

export async function requestConfigAutoBackupRestore(
    version: number,
    sendMessage?: ConfigAutoBackupMessageSender,
): Promise<ConfigAutoBackupRestoreResult> {
    if (!sendMessage) return restoreConfigAutoBackup(version);

    let response: ConfigAutoBackupMessageResponse;
    try {
        response = await sendMessage({
            type: CONFIG_AUTO_BACKUP_RESTORE_MESSAGE,
            version,
        });
    } catch (error) {
        if (!(error instanceof Error) || !error.message.includes('Receiving end')) throw error;
        return restoreConfigAutoBackup(version);
    }
    if (response?.success === false) throw new Error(response.error || '自动配置备份恢复失败');
    if (!response?.result) throw new Error('自动配置备份恢复没有返回结果');
    return response.result;
}
