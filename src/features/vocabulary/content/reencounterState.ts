/**
 * @file src/features/vocabulary/content/reencounterState.ts
 * 文件职责：定义再次遇见浮层的可观察状态与展示合同。
 * 主要内容：保存当前附近的命中、用户打开的命中、按需读取的收藏快照及读取反馈。
 * 模块边界：仅定义类型，不读取网页或数据库，不注册事件，不请求模型；内容挂载器管理更新，Vue 卡片只呈现。
 */
import type {ReencounterEntry} from '../domain/reencounter';
import type {ReencounterOccurrence} from './readingText';

export interface ReencounterState {
  occurrences: ReencounterOccurrence[];
  current: ReencounterOccurrence | null;
  saved: ReencounterEntry | null;
  loading: boolean;
  error: string;
  paused: boolean;
}
