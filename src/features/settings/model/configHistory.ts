/**
 * @file src/features/settings/model/configHistory.ts
 * 文件职责：为设置历史建立按实际保存顺序比较的变更时间线。
 * 主要内容：将相邻的可恢复快照转换成字段、旧值和新值，保留前一版本编号；最早保留的记录不推测已丢失的修改。
 * 模块边界：仅消费配置服务的快照和 core 的脱敏差异算法，不读取存储、不修改历史状态，也不执行恢复。
 */
import {buildConfigDiff, type ConfigDiffResult} from '@/src/core/config/diff';
import {toRestorableConfig, type ConfigHistoryEntry} from '@/src/services/config/history';

export interface ConfigHistoryTimelineEntry extends ConfigHistoryEntry {
    previousVersion: number | null;
    diff: ConfigDiffResult | null;
}

/** 版本号在撤销后另存时可能跳号，因此始终比较相邻快照，而不是寻找 version - 1。 */
export function buildConfigHistoryTimeline(entries: readonly ConfigHistoryEntry[]): ConfigHistoryTimelineEntry[] {
    const snapshots = entries.map((entry) => ({...entry, config: toRestorableConfig(entry.config)}));
    return snapshots.map((entry, index) => {
        const previous = snapshots[index - 1];
        return {
            ...entry,
            previousVersion: previous?.version ?? null,
            diff: previous ? buildConfigDiff(previous.config, entry.config) : null,
        };
    }).reverse();
}
