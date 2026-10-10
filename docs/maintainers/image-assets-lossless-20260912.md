# 图片无损压缩验收 · 2026-09-12

首页、官网截图、扩展图标、商店素材和 README 配图保持原画面、分辨率、透明度与现有引用路径。检查 84 张图片，其中 80 张可以进一步缩小；图片合计从 12,262,403 bytes 降到 10,035,889 bytes，减少 2,226,514 bytes（2.12 MiB，18.2%）。不包含历史测试截图。

| 资源 | 压缩前 | 压缩后 | 减少 |
| --- | ---: | ---: | ---: |
| 首页标志图 `docs/public/product-icon.png` | 526,940 B | 320,066 B | 39.3% |
| 扩展 512px 图标 `public/icon/512.png` | 313,936 B | 273,406 B | 12.9% |
| 官网中文划词截图 `docs/public/screenshots/selection.webp` | 243,266 B | 151,326 B | 37.8% |
| 官网英文菜单截图 `docs/public/screenshots/en/popup.webp` | 123,756 B | 85,972 B | 30.5% |
| 三处赞赏码，每份 | 113,969 B | 91,256 B | 19.9% |

首页标志图仍为 896×880 PNG；扩展和商店要求使用的 PNG 格式保持不变。首页保留 PNG，是为了保证浏览器解码和缩放后的实际像素一致。所有尺寸、ICC、EXIF、XMP、IPTC 和方向信息均进行比较并保留。没有缩放、量化、近似无损压缩或生成式重绘。

## 方法与复核

基线提交：`bf827287e6d8c4d205c454b066d4df55faf2748a`。每张图片的原文件与成品 SHA-256、RGBA 像素 SHA-256、尺寸、体积和浏览器像素比较见 [完整验收记录](./image-assets-lossless-20260912.json)。`marketing/asset-manifest.json` 的 35 条成品体积和源图合计同步更新，截图采集时间保持原值。

压缩使用以下参数，先输出候选文件，再在体积更小且验证通过时替换源文件：

```sh
optipng -o 5 -out candidate.png source.png
cwebp -z 9 -exact -metadata all source.webp -o candidate.webp
jpegtran -copy all -optimize -progressive -outfile candidate.jpg source.jpg
```

PNG 只优化无损编码，WebP 使用无损模式并保留透明区域 RGB，JPEG 使用无损系数变换。Sharp 解码后逐字节比较完整 RGBA 数据，另用真实 Edge 的 Canvas 解码逐通道比较全部 80 张改动图片；所有差异通道数均为 0。

| 验证 | 结果 |
| --- | --- |
| 80 张改动图片的尺寸、元数据和解码 RGBA | 全部一致 |
| 80 张图片在 Edge 中的实际解码像素 | 全部一致，差异通道数均为 0 |
| 首页中英文 × 1440/390 CSS px × 明暗主题，DPR 2 | 8 种组合均通过；标志图的 Canvas 像素和实际渲染截图均与原图一致 |
| `pnpm compile` | 通过 |
| `pnpm docs:build` | 通过 |
| `pnpm build`、`pnpm build:firefox` | 通过；两种产物各 23 张图片均与优化后源文件逐字节一致 |
| 素材清单体积 | 35 条均与实际文件一致 |
| `git diff --check` | 通过 |

浏览器启动方式为 `headless-isolated`，焦点策略为 `no-visible-window`，仅访问本机生产构建与本机图片对照服务，不连接用户日常浏览器配置。截图与可执行复核脚本保存在本次本地证据目录 `/private/tmp/fluentread-image-lossless-20260912/`，其中 `home-images/` 包含 8 张截图和报告，`browser-assets.json` 包含全部改动图片的浏览器像素结果。

## 已知基线问题与交付边界

现有 `scripts/verify-product-site.cjs` 在检查 `/en/writing-assistant` 内链时失败；在未修改的基线提交导出目录重新构建后，复现完全相同的失败。该通用脚本在进入浏览器步骤前停止，不能宣称其全套通过。图片专项的浏览器验证独立完成，本次没有修改或跳过通用脚本的断言。

本次修改仅涉及图片文件、素材清单与本验收记录，没有业务代码或界面布局变化。Firefox 完成构建与图片打包一致性检查，实际像素与首页显示验证使用 Edge；未发布线上官网或商店版本。
