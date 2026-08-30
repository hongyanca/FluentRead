/**
 * @file src/features/model-usage/model/tokenFormat.ts
 * 文件职责：把可能增长到亿级或万亿级的 Token 整数转换为稳定、可读且可追溯的中文展示值。
 * 主要内容：提供精确千分位文本、万/亿/万亿紧凑文本、跨单位四舍五入和缓存命中率百分比格式化。
 * 模块边界：本文件只处理展示格式，不参与 Token 聚合、排序、计费、导入导出或供应商 usage 解释；业务数据始终保留原始整数。
 */

export interface FormattedTokenCount {
    compact: string;
    exact: string;
    isCompact: boolean;
}

interface CompactUnit {
    divisor: number;
    label: '万' | '亿' | '万亿';
}

const COMPACT_UNITS: CompactUnit[] = [
    {divisor: 10_000, label: '万'},
    {divisor: 100_000_000, label: '亿'},
    {divisor: 1_000_000_000_000, label: '万亿'},
];

const exactFormatter = new Intl.NumberFormat('zh-CN', {maximumFractionDigits: 0});
const compactValueFormatter = new Intl.NumberFormat('zh-CN', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
});
const percentFormatter = new Intl.NumberFormat('zh-CN', {
    style: 'percent',
    minimumFractionDigits: 0,
    maximumFractionDigits: 1,
});

function safeCount(value: number): number {
    return Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

function roundedCompactValue(value: number): number {
    return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function formatTokenCount(value: number): FormattedTokenCount {
    const count = safeCount(value);
    const exact = exactFormatter.format(count);
    if (count < COMPACT_UNITS[0].divisor) return {compact: exact, exact, isCompact: false};

    let unitIndex = 0;
    for (let index = 1; index < COMPACT_UNITS.length; index += 1) {
        if (count >= COMPACT_UNITS[index].divisor) unitIndex = index;
    }
    let unit = COMPACT_UNITS[unitIndex];
    let scaled = roundedCompactValue(count / unit.divisor);
    // 99,999,999 等边界四舍五入后直接进入更高中文单位，避免显示“10,000 万”。
    if (scaled >= 10_000 && unitIndex < COMPACT_UNITS.length - 1) {
        unitIndex += 1;
        unit = COMPACT_UNITS[unitIndex];
        scaled = roundedCompactValue(count / unit.divisor);
    }
    return {
        compact: `${compactValueFormatter.format(scaled)} ${unit.label}`,
        exact,
        isCompact: true,
    };
}

export function formatUsageRate(value: number | null): string {
    if (value === null || !Number.isFinite(value) || value < 0) return '—';
    return percentFormatter.format(Math.min(1, value));
}
