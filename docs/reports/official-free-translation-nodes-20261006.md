# 官方免费翻译节点与并发验证

2026-10-06，在 FluentRead 的 Vue/WXT/TypeScript 架构内新增阿里翻译、ModernMT、Lara、Lingvanex 四家免密钥网页服务。免费池只保留供应商直连节点，移除 DeepLX、Lingva 代理；独立 DeepLX 配置继续保留。新配置默认启用 15 家，旧配置保留其余明确选择，用户可手动开启新增项。

## 开源软件与插件线索

| 查阅对象 | 本次核查范围与结论 |
| --- | --- |
| [UlionTse/translators](https://github.com/UlionTse/translators) | 只读核查供应商列表与 Python 协议；定位阿里、ModernMT、Lara、Lingvanex、Papago、小牛等候选，再向官方节点发起独立探测。GPL-3.0，仅作为协议线索，未复制非零碎代码。 |
| [TWP](https://github.com/FilipePS/Traduzir-paginas-web) | 查阅浏览器翻译服务实现；Google/Bing/Yandex 与 FluentRead 已有路线重叠，未把相同上游包装为新供应商。 |
| [Pot](https://github.com/pot-app/pot-desktop) | 查阅源码目录与阿里、百度实现：主程序使用 AccessKey 或 APPID/Secret，并非免密钥网页接口。 |
| [Pot 插件目录](https://github.com/pot-app/pot-app-plugin-list) | 有免配置百度、有道及 LibreTranslate 插件；“免配置”不足以证明节点官方或当前可用，继续按域名归属、凭据要求和实测筛选。 |
| [Simple Translate](https://github.com/sienori/simple-translate) | 核查项目入口与功能说明作为浏览器插件线索，未从说明推断额外匿名节点可用。 |
| 工作区 read-frog / kiss-translator | 限定路径只读搜索；kiss-translator 的百度 `/transapi` 可作为旧协议线索，但本次返回业务错误。未编辑、安装依赖或构建两个参考项目。 |

新增适配器独立编写，复用 FluentRead 的文本槽、HTTP 端口、配置快照和免费调度器。没有跨仓库 import、路径依赖或 React 依赖。

## 官方节点实测

所有在线请求只发送固定合成英文句子，不发送用户网页、Cookie、私有凭据或用户代理。命令行探测后，使用生产扩展和独立临时 Edge 再次逐家验证。

| 新服务 | 官方请求节点 | 生产扩展检查 |
| --- | --- | --- |
| [阿里翻译](https://translate.alibaba.com/) | `translate.alibaba.com/api/translate/csrftoken` 与 `/text` | 有效中文译文，425 ms |
| [ModernMT](https://www.modernmt.com/translate) | `webapi.modernmt.com/translate` | 有效中文译文，1829 ms |
| [Lara](https://laratranslate.com/translate) | `webapi.laratranslate.com/translate/segmented` | 有效中文译文，1882 ms |
| [Lingvanex](https://lingvanex.com/en/translate/) | 官网动态网页参数与 `api-b2b.backenster.com/b1/api/v3/translate` | 有效中文译文，4564 ms |

Lingvanex 官网直接调用 `backenster.com`，其[官方 API 文档](https://docs.lingvanex.com/translate)也列出同一端点。这里使用官网匿名网页参数，不使用用户的商业 API Key。ModernMT 校验前缀与当次下载的官网 `app.bundle.js` 一致；[官网](https://www.modernmt.com/translate)已公告计划在 2026 年底停用并迁移到 Lara。

上述耗时仅为本次网络的单次连接检查，包含每家所需的网页初始化；不代表速度排名、无限免费额度或持续可用性。正式云 API 的免费额度不能套用到网页接口。

## 未新增的候选

| 候选 | 本次结论 |
| --- | --- |
| 百度旧 `/transapi` | HTTP 200，但业务码 1022，没有有效译文；未加入故障节点。 |
| Papago | 当前官网已采用 Next.js 页面结构，开源适配器的旧主页脚本/签名流程不能直接套用；未取得当前匿名协议的有效译文。 |
| 小牛网页 | 查到的现行开源协议依赖验证码及登录状态检查，未验证纯匿名调用；未接入。 |
| Bing 网页 | 官网可访问，但与已有微软上游重复；未把仅能打开首页当作新增接口成功。 |
| LibreTranslate | [官方文档](https://docs.libretranslate.com/guides/api_usage/)说明官方托管站需要 API Key；第三方公共实例不符合本次范围。 |
| 彩云、讯飞、SYSTRAN 等开源目录候选 | 查阅协议线索不等于完成当前匿名实测；本次没有足够证据加入默认池。 |

## 多节点并发边界

- 不同段落可分配给不同官方节点，最多六条翻译任务同时执行；批量结果按输入顺序返回。
- 每家最多一条在途请求，微软最多两条；微软间隔 100 ms，MyMemory/Lara/Lingvanex 间隔 1 秒，其余节点间隔 300 ms。
- 智能加速保留按成功率、耗时和在途负载分配的策略。慢请求仍只允许一路全局备用竞争，取首个有效译文并取消另一条；竞争预算和冷却没有放宽。
- 全局上限为六条任务加最多一路竞争。默认单路超时 5 秒，总调用预算最多 20 秒，排队、分块、回退共享截止时间。
- 原文回显、错语种、空结果仍被拒绝；HTTP 与业务状态的限流、配额、拦截进入既有冷却。用户取消停止当前批次和队列领取。
- 设置页连接检查仍最多三家同时执行，区别于翻译任务并发；检查不改写启用列表或运行权重。

## 验证与证据

按本次影响范围验证 20 个测试文件，共 1202 项测试通过（首轮发现目录/旧节点断言需要同步后，复跑相关四个文件 115 项全部通过）。类型检查、测试归类审计、源码头注释和 provider 模块边界检查通过。

新适配器的 statements / branches / functions / lines 均为 100%，包括固定端点、临时网页参数、语言映射、Unicode 分块、文本槽、换行空白、业务错误、Retry-After 与取消。确定性测试验证六家节点同时处理六个不同段落、乱序完成仍保序，以及取消后六家均停止且不领取下一段。

生产扩展在线测试对四个新增节点分别检查，并用真实 Control 手势得到翻译节点计数 `[1, 0, 1]`，相邻段落保持原状，无重复译文。[在线报告](./official-free-nodes-live-20261006/report.json)、[截图](./official-free-nodes-live-20261006/live-translate-restore-retranslate.png)。

设置专项验证 15 个官方候选、逐家连接结果/耗时、重测、开关/优先顺序和邮箱持久化，以及 1440/1024/820/390 像素和中英文布局；未出现横向溢出或页面异常。[设置报告](./official-free-nodes-ui-20261006/report.json)、[桌面截图](./official-free-nodes-ui-20261006/checks-1440.png)、[英文窄屏](./official-free-nodes-ui-20261006/english-390.png)。设置截图使用受控响应演示成功与失败，不能用其中的失败状态判断真实供应商可用性。

另用生产扩展的受控 HTTP 测试验证慢请求竞争取消、顺序模式等待和失败不重复整个免费池；[调度报告](./official-free-nodes-routing-20261006/report.json)。其中计时只反映受控场景。

三项浏览器专项均使用 production Chrome MV3 构建、独立临时 Edge profile、`launchMode: macos-background-cdp`、`focusPolicy: launchservices-no-foreground`；窗口完整位于第二块显示器且 `browserFrontmost: false`。测试后关闭本次实例，没有操作用户日常浏览器。

Chrome 与 Firefox 生产构建、userscript 构建及 verifier 验证成功。userscript 在本轮多语言文案更新后先重新生成对应资源再构建。Firefox 和 userscript 尚未进行本轮真实运行时验证；没有运行全量回归。
