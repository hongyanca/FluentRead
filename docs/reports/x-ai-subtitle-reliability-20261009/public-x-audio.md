# X AI 字幕：公开真实媒体获取验证

日期：2026-10-09。两条来自公开上游测试的 X 样例，均通过本轮生产 HLS 纯函数读取到真实 AAC 音轨，最低标称码率 MP4 也通过了音轨校验。这证明这两组公开媒体可以读取，**不能替代用户当前失败链接的复现，也没有证明浏览器采集、解码和翻译全过程可用**。本轮没有调整默认音频码率。

结构化结果见 [public-x-audio.json](./public-x-audio.json)，不含音频、字幕或转写正文。

## 来源与执行范围

样例分别取自 yt-dlp 官方 [Twitter extractor](https://github.com/yt-dlp/yt-dlp/blob/master/yt_dlp/extractor/twitter.py) 的公开测试：

- [CTVJLaidlaw，第 2 个视频](https://twitter.com/CTVJLaidlaw/status/1600649710662213632/video/2)，所读取源码快照的 735–758 行；公开元数据返回两个视频，明确选择索引 1。
- [DavidToons_](https://twitter.com/DavidToons_/status/1578353380363501568)，同快照的 658–675 行；公开元数据返回一个视频。

源代码快照 SHA-256 为 `1a11f1b902faa077ad673a853b4c29a76d43df91513380b967d605be1b18ddc3`。上游源码采用 [Unlicense](https://github.com/yt-dlp/yt-dlp/blob/master/LICENSE)；这不改变视频自身的版权。仅借助公开测试定位样例，没有复制 extractor 实现，也没有使用用户 HAR 派生的地址。

公开 syndication 元数据和媒体请求均不带账号凭据；两条元数据响应均为 HTTP 200。Node 导入生产提交 `259da93a04b99bdfd0885559796282638e339ed0` 中的 [hlsAudio.ts](../../../src/features/video-subtitle/content/hlsAudio.ts)，实际调用 `readXHlsAudio`、`readBoundedMediaResponse` 和 `hasMp4AudioTrack`，没有 mock 媒体。另以本机 ffprobe 检查 codec、声道与时长，以 ffmpeg 从真实源文件生成用于独立 ASR 实验的 PCM。

HLS 保留生产函数的 30 秒总预算、清单/初始化段 5 秒预算、64 MiB 总大小和 3 路媒体分片读取；清单/初始化段每项限制 1,000,000 bytes，最多 256 个媒体分片。MP4 直接调用有界读取与音轨校验，大小限制 32 MiB。harness 外层请求预算为 45 秒，**未执行浏览器 runtime 的 20 秒 MP4 预算、候选选择、AudioContext 解码或页面桥接**。时延是单次公网读取观察，受当时网络与 CDN 状态影响。

## 真实读取结果

HLS 请求数包含首次 master、子清单、初始化段和媒体分片。MP4 表中的码率是元数据 variant 标称值，不是 ffprobe 实测音轨码率。

| 公开样例 | 路径 | 返回 bytes | 清单 / 音轨时长 | 用时 ms | 请求数 | 音轨 |
| --- | --- | ---: | --- | ---: | ---: | --- |
| CTVJLaidlaw /video/2 | 默认顺序 HLS 音频 rendition | 443,041 | 102,232 / 102,236.009 ms | 18,711 | 38 | AAC-LC，44.1 kHz，mono |
| CTVJLaidlaw /video/2 | 最低标称 MP4，632,000 bps | 3,668,142 | — / 102,236.009 ms | 7,735 | 1 | AAC-LC，44.1 kHz，mono |
| DavidToons_ | HLS 音频 rendition | 73,291 | 4,450 / 4,458.667 ms | 5,070 | 5 | AAC-LC，48 kHz，stereo |
| DavidToons_ | 最低标称 MP4，432,000 bps | 81,974 | — / 4,458.667 ms | 773 | 1 | AAC-LC，48 kHz，mono |

四次媒体读取均通过真实 `soun` 音轨检查。较长样例的元数据视频时长为 102,226 ms，较短样例为 4,458 ms；清单与解码器探测的音轨时长差远小于生产 1 秒校验容差。这里的 ffprobe 成功不等于所有浏览器 AudioContext 都能解码。

## 同视频 32 / 64 / 128 kbps 音轨

CTVJLaidlaw 样例的 master 声明三个音频 rendition，`NAME=Audio`、`AUTOSELECT=YES`，均没有 `DEFAULT` 或 `LANGUAGE`。按现有规则优先 `DEFAULT=YES`；此 master 无默认标记时保留声明顺序，首先选择 32 kbps。没有根据码率重新排序。

| 标称 bps | GROUP-ID | 实际 bytes | 清单时长 ms | 源声道 | ffprobe 实测音轨 bps |
| ---: | --- | ---: | ---: | --- | ---: |
| 32,000 | audio-32000 | 443,041 | 102,232 | mono | 32,838 |
| 64,000 | audio-64000 | 862,084 | 102,232 | stereo | 65,628 |
| 128,000 | audio-128000 | 1,657,576 | 102,232 | stereo | 127,876 |

三项均实际读取并包含 AAC-LC 44.1 kHz 音轨。额外指定 64/128 kbps 的读取没有记录用时或请求数，JSON 以 `null` 表示未记录，没有补算数据。master 原文、精确媒体候选 URL 和源文件摘要只保存在本机临时实验目录。

32 与 128 kbps 均截取同一视频开头 **0–12,000 ms**，分别生成 16 kHz mono float32-le PCM，各 192,000 samples / 768,000 bytes；不做增益归一化。较短样例截取 0–4,458 ms，得到 71,328 samples / 285,312 bytes。

| PCM 来源 | SHA-256 | RMS |
| --- | --- | ---: |
| 长样例 32 kbps，12 秒 | `b41150dd2da23e33c6699d5d6234cd12b676bd8966fcce0261fab6e44a2074c9` | 0.01700963 |
| 长样例 128 kbps，12 秒 | `b5602afe0ef4864d7eaf0d1df34b7f75e55ae8fa80d005f01484e1be5d6bff63` | 0.01212370 |
| 短样例 128 kbps，4.458 秒 | `e2c41f8b0ad0a1d968c93a731b3450e00e30a24c2ce5440e499eb59ccf6d6c3e` | 0.16069841 |

长样例两份同时间窗 PCM 的零延迟 Pearson 相关系数为 0.98801443，但 32 kbps 原轨为 mono，128 kbps 原轨为 stereo，后者混为 mono 后 RMS 也更低。因此后续转写差异不能唯一归因于码率，没有改变生产增益策略或默认音轨优先规则。

## 语言与准确率边界

独立 WASM ASR 的语言倾向与模型转写对照统一见 [公开样例精简结果](./accuracy-experiment/public-x-wasm-summary.json) 与 [准确率实验说明](./accuracy-experiment.md)，本记录不复制持续更新的模型观测数值。没有人工真值，不能据此称转写正确或提高码率有收益。

较短样例公开 master 的原生自动字幕标签为 en-US；自动字幕和模型检测都不能代替人工听辨。当前工具无法听取音频，不声称已人工确认语言、采访内容或准确率。WASM 结果不代表浏览器 WebGPU 验收。

完整源媒体、PCM、字幕和转写正文仅留在 `/private/tmp/fluentread-public-x-samples-20261009` 及相应本机 ASR 实验目录，不进入仓库或 PR。用户当前失败视频、带背景音乐或口音的真实质量、原生浏览器解码和端到端翻译仍需对应样例验证。
