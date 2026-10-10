/**
 * @file src/core/config/selectionPreview.ts
 * 文件职责：提供划词与 AI 讲解设置中不联网的英文原句和学习回答示例。
 * 主要内容：提供读懂、句法、用法和练习示例，使用与真实学习回答相同的格式，由共用组件呈现交互预览。
 * 模块边界：这些内容是固定的语言学习样本，不是模型结果，不参与配置迁移或网络请求。
 */
export const sentenceSource = 'Every language offers a new way to see the world.';
export const sentenceTranslation = '每一种语言，都带来一种看世界的新方式。';
export const sentenceAnalysis = '| Text | POS | Role | Meaning |\n| --- | --- | --- | --- |\n| Every language | noun phrase | 主语 | 每一种语言 |\n| offers | verb | 谓语 | 带来 |\n| a new way | noun phrase | 宾语 | 一种新方式 |\n| to see the world | infinitive phrase | 后置定语 | 看世界的 |';

export const learningPreviewAnswers = {
    meaning: {
        concise: '这句话表达：不同的语言带来不同的视角，让我们以新的方式理解世界。',
        detailed: '这句话表达：不同的语言带来不同的视角，让我们以新的方式理解世界。\n\n**Every language** 强调每一种语言都有价值；**a new way to see the world** 指新的理解方式，而不是字面上的视觉变化。',
    },
    usage: {
        concise: '**offer a new way to…** 表示“提供一种新的方式来……”。\n\n例句：Reading offers a new way to understand others.',
        detailed: '**offer a new way to…** 表示“提供一种新的方式来……”，适合说明某种经历如何改变理解。\n\n例句：Reading offers a new way to understand others.\n\n也可以把 **offers** 换成 **provides**，把 **see** 换成 **understand**，表达相近的意思。',
    },
    practice: {
        concise: '补全表达：Every language offers a new ____ to see the world.\n\n提示：一个表示“方式”的名词。',
        detailed: '补全表达：Every language offers a new ____ to see the world.\n\n提示：一个表示“方式”的名词。\n\n再试着用 **offers a new way to** 写一句话，描述阅读或旅行带来的变化。',
    },
} as const;
