/**
 * @file scripts/testing/wait-for-async-condition.cjs
 * 文件职责：在 Node 侧轮询浏览器异步读取，使用同一截止时间约束读取与间隔。
 * 模块边界：只等待只读谓词，不修改配置，不把排队或乐观界面当成保存成功。
 */
async function waitForAsyncCondition(predicate, {timeoutMs, pollingMs = 100, message = '异步条件等待超时'}) {
  if (typeof predicate !== 'function' || !Number.isFinite(timeoutMs) || timeoutMs <= 0
    || !Number.isFinite(pollingMs) || pollingMs <= 0) {
    throw new TypeError('异步条件等待需要有效谓词和正数预算');
  }
  const deadline = performance.now() + timeoutMs;
  const timeoutError = () => new Error(`${message} (${timeoutMs}ms)`);
  while (true) {
    const remaining = deadline - performance.now();
    if (remaining <= 0) throw timeoutError();
    let timer;
    let matched;
    try {
      matched = await Promise.race([
        Promise.resolve().then(predicate),
        new Promise((_, reject) => {timer = setTimeout(() => reject(timeoutError()), remaining);}),
      ]);
    } finally {
      clearTimeout(timer);
    }
    if (performance.now() >= deadline) throw timeoutError();
    if (matched) return;
    await new Promise(resolve => setTimeout(resolve, Math.min(pollingMs, deadline - performance.now())));
  }
}

module.exports = {waitForAsyncCondition};
