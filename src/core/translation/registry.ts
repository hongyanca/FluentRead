/**
 * @file src/core/translation/registry.ts
 *
 * 文件职责：登记并排序 FluentRead 内置站点翻译适配器，为候选核心提供稳定、只读的默认规则集合。
 * 主要内容：汇集 GitHub、GNU、Hacker News、LearnOpenGL、Reddit、X 与 YouTube 适配器，按 priority 和声明顺序生成 defaultTranslationAdapters。 可核对的公开符号包括 defaultTranslationAdapters。
 * 模块边界：本文件属于可独立测试的 core 候选领域；可以读取传入 DOM 以计算结果，但不访问配置存储、不调用 provider、不注册页面监听器，也不负责译文渲染或 feature 生命周期。
 */

import type {TranslationSiteAdapter} from './types';
import {githubAdapter} from './adapters/github';
import {xAdapter} from './adapters/x';
import {redditAdapter} from './adapters/reddit';
import {hackerNewsAdapter} from './adapters/hackernews';
import {youtubeAdapter} from './adapters/youtube';
import {gnuManualAdapter} from './adapters/gnu';
import {learnOpenGLAdapter} from './adapters/learnopengl';

const declaredAdapters = [
    githubAdapter,
    xAdapter,
    redditAdapter,
    hackerNewsAdapter,
    youtubeAdapter,
    gnuManualAdapter,
    learnOpenGLAdapter,
] as const satisfies readonly TranslationSiteAdapter[];

export const defaultTranslationAdapters: readonly TranslationSiteAdapter[] =
    Object.freeze([...declaredAdapters]);
