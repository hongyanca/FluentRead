/**
 * WASM 私有 stderr 适配器，由构建器插入各引擎 glue 的闭包内。
 * 不覆盖全局 console，不更改模型、执行后端、参数或 Promise 错误传播。
 * 本文件保留为普通 JS，让发布资产中的诊断不被业务构建的 drop:console 删除。
 */
// 每个 WASM 实例仅保留一次完整的混合执行后端提示；不跨实例共享状态。
let fluentReadOnnxPlacementWarningSeen = false;
function fluentReadWasmStderr(message) {
    const text = String(message).replace(/\u001b\[[0-9;]*m/g, '');
    // ORT 将所有严重级别写入 stderr，Emscripten 默认全部转为 console.error。
    const onnx = !/[\r\n]/.test(text.trim())
        && /^(?:\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d+ )?\[([VIWEF]):onnxruntime[:\]]/.exec(text);
    if (onnx) {
        // 浏览器 WASM 不暴露 CPU 厂商；上游 https://github.com/microsoft/onnxruntime/pull/27399 已确认此单行提示无操作价值。
        // 只降低 vendor=0 的已知初始化提示，其他警告、错误和多行输出保持原级别。
        if (onnx[1] === 'W' && /\[W:onnxruntime:Default, cpuid_info\.cc:\d+ LogEarlyWarning\] Unknown CPU vendor\. cpuinfo_vendor value: 0\s*$/.test(text)) {
            console.debug(text);
            return;
        }
        // ORT Web 的 WASM/CPU 是隐式后端，动态 shape 运算会保留在 CPU；首条警告仍供诊断。
        // 仅匹配上游完整单行文案；不把未知回退、截断消息或附带失败的日志当作重复提示。
        const placement = /\[W:onnxruntime:[^\]\r\n]*, session_state\.cc:\d+ VerifyEachNodeIsAssignedToAnEp\] Some nodes were not assigned to the preferred execution providers which may or may not have an negative impact on performance\. e\.g\. ORT explicitly assigns shape related ops to CPU to improve perf\.\s*$/.test(text);
        const hint = /\[W:onnxruntime:[^\]\r\n]*, session_state\.cc:\d+ VerifyEachNodeIsAssignedToAnEp\] Rerunning with verbose output on a non-minimal build will show node assignments\.\s*$/.test(text);
        if (hint || (placement && fluentReadOnnxPlacementWarningSeen)) {
            console.debug(text);
            return;
        }
        if (placement) fluentReadOnnxPlacementWarningSeen = true;
        const level = {V: 'debug', I: 'info', W: 'warn', E: 'error', F: 'error'}[onnx[1]];
        console[level](text);
        return;
    }
    // 官方 CJK traineddata 仍带有 Legacy 引擎参数；LSTM-only core 不包含这些参数。
    // 只降级已核对的完整单行提示；陌生参数或附带其他错误的输出仍然可见。
    if (/^Warning: Parameter not found: (?:language_model_ngram_on|segsearch_max_char_wh_ratio|language_model_ngram_space_delimited_language|language_model_ngram_scale_factor|language_model_use_sigmoidal_certainty|language_model_ngram_nonmatch_score|classify_integer_matcher_multiplier|assume_fixed_pitch_char_segment|chop_enable|allow_blob_division)\s*$/.test(text)
        || /^Estimating resolution as \d+\s*$/.test(text)) {
        console.debug(text);
    } else if (/^Warning:[^\r\n]*\s*$/.test(text)) {
        console.warn(text);
    } else {
        // 未知 stderr 采用保守的错误级别；不能因为首行像提示就吞掉后续失败。
        console.error(text);
    }
}
