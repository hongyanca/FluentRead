# X AI 字幕：开源实现审查

审查日期：2026-10-09。这里只记录上游设计和可落地的实验方向；上游宣称的速度、准确率与 FluentRead 的实测分别记录。没有复制上游代码、安装 Python ASR 服务或修改参考仓库。

## 音频来源

[yt-dlp 的 Twitter extractor](https://github.com/yt-dlp/yt-dlp/blob/master/yt_dlp/extractor/twitter.py)按帖子元数据里的 `video_info.variants` 枚举候选，再分别解析 HLS 与渐进式 MP4；HLS 解析保留 audio-only 格式和字幕。它也支持 syndication 元数据，并明确处理空 JSON、鉴权失败和限流。

FluentRead 可以独立实现相同的数据流：从页面已有响应中提取播放器所属 media ID 和 variants，先试已知音轨，再试同媒体的其他候选；失败项不能覆盖其他可用来源。跨帖子和引用视频必须按 ID 配对。单纯发现最新 `.m3u8` 或 MSE `blob:` 不能证明已经拿到可解码音轨。不能把 yt-dlp 的 Python 运行时或会话鉴权代码直接放进内容脚本。

## 识别窗口与交互

[Whisper Web 的 Worker](https://github.com/xenova/whisper-web/blob/main/src/worker.js)复用模型实例，语言和任务通过识别参数传入；普通 Whisper 使用 30 秒窗口和 5 秒重叠，并区分临时 `update` 与最终 `complete`。

可借鉴模型复用、明确的语言参数、临时/已确认字幕状态。窗口长度应由 FluentRead 的浏览器预算与独立基准决定：当前产品使用 Tiny 10 秒、Base 14 秒和 1.2 秒重叠，不能仅因为上游示例选择 30 秒就扩大。普通话、英文、韩文与连续音乐需要分别检查漏词、重复和时轴边界。

## 背景音乐与持续识别

[WhisperLiveKit](https://github.com/QuentinFuxa/WhisperLiveKit)把语音活动控制和检测、稳定前缀提交、音频累积量控制、暂停边界及缓存裁剪作为持续识别的独立层。其 Python 服务支持多个 ASR 后端；这些能力需要本地服务，不能视为已经在浏览器扩展里可用。

下一阶段可在 FluentRead 既有 Worker/ONNX 运行时中试验轻量 VAD；须先固定真实人声加背景音乐、纯音乐、片头、长静音和低音量样本，再比较误报、漏报、等待时长与资源消耗。[Silero VAD](https://github.com/snakers4/silero-vad)提供 ONNX 与 8/16 kHz 使用路径，是可调查的候选；下载体积、模型许可、兼容性和效果需单独验证。当前 RMS/暂停检测不是语义上的人声检测。

## 本轮证据边界

- Home HLS fixture：真实媒体解码和 PCM；ASR 与翻译响应受控，可验证采集与状态机，不能验证识别准确率。
- 中文 benchmark：真实生产 Whisper Worker，macOS 合成的 3 条普通话，显式中文与自动检测；记录原始 CER、RTF、浏览器总 RSS 与 CPU。繁简差异计入原始 CER，不能把它当作纯语音内容错误率。
- 公开上游样例：使用 yt-dlp 测试公开列出的两个 X 视频，实际读取 CDN 的 HLS/MP4，再在本地 WASM 上识别。它们补充了真实来源音频证据，但没有人工正确转写，也没有完成浏览器端完整验收；没有复用上游鉴权代码或引入网络识别服务。详见 [公开 X 音频验证](./public-x-audio.md)。
- 精度实验：固定 q4 encoder 和同一模型快照，在单线程 ORT Web WASM 上对照 q4/q8 decoder；仅三条合成普通话，不用于决定生产默认值。原始与简繁归一化指标分别保留，WebGPU 组合仍未验收。详见 [准确率实验](./accuracy-experiment.md)。
- 恢复后另完成一条自然英文 AAC/MP4 的实际 PCM16、Base WebGPU q4 和完整字幕浏览器链路。UI 翻译响应受控，独立实际 Microsoft 协议请求成功；不能代替真实中文、用户故障帖或广泛准确率验收。详见[合并前验证](./merge-validation.md)。
- 真实 X 页面：公开页面可验证入口、播放器归属和页面限制。没有用户当前故障视频时，不能确认该视频已恢复，也不能推断所有 X 视频的可用率。
- Tiny/Base 是轻量本地模型。对复杂口音、多人、音乐和小语种的质量应通过真实样本决定；不能用三个合成普通话样本证明整体产品准确率。
