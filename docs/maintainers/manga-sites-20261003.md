# 漫画网站清单与访问核对

2026-10-05 核对，2026-10-06 补充，保留用户要求的 **235 个去重名称**。已登记的域名会自动检测正文图片；Pixiv、MANGA Plus、WeebCentral、Dynasty、MangaDNA、Rawkuma 与单作品站使用专用正文规则。Champion Cross、Comic Ryu 和 Comic Growl 的公开可读画布接入连续翻译；不可读画布和已核对的分片站提供圈选入口。网站停服、验证、登录与付费条件不会因登记而消失。

域名来源包括[用户指定 Issue](https://github.com/immersive-translate/immersive-translate/issues/1809)、其中[历史清单](https://github.com/immersive-translate/immersive-translate/issues/1809#issuecomment-3047801980)、[小学馆官网](https://televikun-super-hero-comics.com/rensai/ultramanblazar/)及公开站点名称核对。`comemh8` 对应旧清单 Omemh8；[JinMangas 原站页面](https://jinmangas.com/manga/dont-say-you-love-me/)的历史缓存确认名称归属，当前正常浏览器确认原域名以 301 跳转到 mangafree.info；目标返回 403，两个域名仅登记通用检测，正文未验收。Syosetu 与 KLMANGA 已纠正为旧清单中的漫画域名，首页重定向确认的 Syosetu 新域名一并登记。

“首页 HTML 可访问”只证明本次收到页面，不证明章节、模型识别、服务翻译或全部设备通过。首页失败也可能是本地网络、站点验证或区域限制，不推断永久停服。停服和域名停放单独标注。原始 HTML 留在临时证据目录；仓库只保存地址、状态、哈希与结构摘要，见 `scripts/testing/evidence/manga-site-checks-20261005.json`。

| 编号 | 名称 | 域名 | 阅读器方式 | 本次访问核对 |
| --- | --- | --- | --- | --- |
| 1 | Pixiv | pixiv.net | 专用正文图片 | 主站首页与 artworks/150354216 均 HTTP 200；960×1200 正文与生产入口确认，未作整站或 OCR 质量验收 |
| 2 | MANGA Plus by SHUEISHA | mangaplus.shueisha.co.jp | 专用正文图片 | 未做首页探测；见章节验证 |
| 3 | Zebrack by SHUEISHA | zebrack-comic.shueisha.co.jp | 专用正文图片规则 | 公开章节正文已核对 |
| 4 | MANGA Million by SHUEISHA | mangamillion.shueisha.co.jp | 专用编号正文图片检测 | 公开免费首话 66193 显示 3 张 694×1080 正文；指南图片排除，实页入口通过 |
| 5 | COMIC FUZ | comic-fuz.com | 专用正文图片 | 公开章节正文结构已核对 |
| 6 | MangaDex | mangadex.org | 专用正文图片 | 公开章节正文结构已核对 |
| 7 | MangaDNA | mangadna.com | 专用正文图片 | 公开章节正文结构已核对 |
| 8 | Yamibo | yamibo.com | 专用单章主图 | 两部公开作品正常开始阅读与下一页显示正文；长图 550×3900、普通页 800×1131；另一作品要求订阅，未验 OCR 或跨文档续译 |
| 9 | ShonenJumpPlus | shonenjumpplus.com | 画布/分片：圈选入口 | 首页 HTML 可访问 |
| 10 | Rimacomiplus | rimacomiplus.jp | 可读画布连续翻译 | 公开章节画布已核对 |
| 11 | Heros Web | viewer.heros-web.com、heros-web.com | 可读画布连续翻译 | 公开章节画布已核对 |
| 12 | Comic Days | comic-days.com | 画布/分片：圈选入口 | 首页 HTML 可访问 |
| 13 | Comic Top | comic-top.com | 通用正文图片检测 | 域名停放页，正文未确认 |
| 14 | ComicWalker | comic-walker.com | 正文可读画布 · 连续翻译 | 公开章节与两种正文标记已核对；本轮 Web Ace 链接的两个章节各有三张可读非空画布，生产入口通过；整章 OCR 未验收 |
| 15 | Web Ace | web-ace.jp | 本站通用检测；外链至 ComicWalker 可读画布 | YoungAceUP 作品列表的两个作品、两个章节已跟进并通过生产入口；复用 ComicWalker 规则，本站独立正文未确认 |
| 16 | Antbyw | antbyw.com | 专用正文图片 | 公开章节正文结构已核对 |
| 17 | Jmanga | jmanga.org | 通用正文图片检测 | 连接失败 |
| 18 | Twitter Comic | twicomi.com | 专用正文图片 | 公开章节正文结构已核对 |
| 19 | MangaZ | mangaz.com | 专用正文图片检测 | 公开 vw 阅读器 HTTP 200；翻页后正文已显示 |
| 20 | PASH UP | pash-up.jp | 专用当前屏可读画布 | 免费首话当前屏入口、译图与正常点击翻页续译通过；首屏描边字未识别，质量未验收 |
| 21 | BOOK☆WALKER | bookwalker.jp | 通用正文图片检测 | 正常免费点击打开公开弹窗，DOM 调查及直开超时；正文未确认 |
| 22 | COLAMANGA | colamanga.com | 通用正文图片检测 | 正常浏览器首页在 DOMContentLoaded 前超时，正文未确认 |
| 23 | GANGAN ONLINE | ganganonline.com | 专用正文图片规则 | 公开章节正文已核对 |
| 24 | Asura Scans | asuracomic.net、asurascans.com | 专用正文图片 | 公开章节正文结构已核对 |
| 25 | All Manga | allmanga.to | 通用正文图片检测 | 目录有章节链接；本轮两个章节为 HTTP 200 空壳，正常目录点击没有正文或新页；此前 mkissa.to 验证页记录保留，正文未确认 |
| 26 | Manhwaclan | manhwaclan.com | 通用正文图片检测 | 访问受限 |
| 27 | CoroCoro | corocoro.jp | 专用正文图片 | 公开章节正文结构已核对 |
| 28 | tonarinoyj | tonarinoyj.jp | 画布/分片：圈选入口 | 首页 HTML 可访问 |
| 29 | Yymanhua | yymanhua.com | 专用正文图片 | 公开章节正文结构已核对 |
| 30 | Manhwatop | manhwatop.com | 通用正文图片检测 | 访问受限 |
| 31 | Palcy | palcy.jp | 公开背景正文 · 连续翻译 | 同源背景完整页可读 |
| 32 | Comic-Trail | comic-trail.com | 画布/分片：圈选入口 | 公开章节 HTTP 200；画布像素 SecurityError；生产入口可打开并取消，未验证 OCR |
| 33 | Templetoons | templetoons.com | 专用直系长图正文，复用分段 | 另一免费章加载 720×10155 正文，标签页已选中且普通滚动后可见，实页入口通过；旧加载占位及关闭扩展的选中标签页空正文对照保留，未验 OCR 或全部章节 |
| 34 | Batocomic | batocomic.net | 通用正文图片检测 | 当前首页是分类停放页；未推断替代域名 |
| 35 | Comic-action | comic-action.com | 画布/分片：圈选入口 | 首页 HTML 可访问 |
| 36 | 腾讯动漫 | ac.qq.com | 专用正文图片 | 公开章节正文结构已核对 |
| 37 | Sololevelingmangafree | sololevelingmangafree.com | 通用正文图片检测 | 连接失败 |
| 38 | Syosetu | syosetu.si / syosetu.cheap | 通用正文图片检测 | 另一实际 686 话在正常窗口及原生标签页选中对照都只有 logo、加载图及摘要占位图，无正文；旧调查保留，未计为实章通过 |
| 39 | Comick | comick.io / comick.dev / comick.fun | 通用正文图片检测 | 当前官方公告称已改为追踪与社区、停止漫画阅读；新域名实测 403 |
| 40 | YoungAnimal | younganimal.com | 可读画布连续翻译 | 公开章节画布已核对 |
| 41 | Piccoma | piccoma.com | 通用正文图片检测 | 官方首页可见免费作品；当前免费作品页明确只供日本境内使用，无正文，未绕过地区限制 |
| 42 | Hentaizap | hentaizap.com | 专用逐页正文图片 | 公开编号阅读页 1280×1811 主图与扩展入口已核对；同作品路径翻页保留阅读状态，未验 OCR |
| 43 | Hanime1 | hanime1.me | 通用正文图片检测 | 访问受限 |
| 44 | Globalcomix | globalcomix.com | 正文圈选入口 | 免费正文已显示；扩展抓图 HTTP 401，保留圈选 |
| 45 | KL | klz9.com | 已核对正文图片 | 普通后台浏览器显示 14 张 1127×1600 正文，实际两页链路通过；竖排错识别、误译和排版仍可见 |
| 46 | comemh8 | omemh8.com | 通用正文图片检测 | 连接失败 |
| 47 | Mangaraw | mangarawjp.me / mangaraw.ac / mangaraw.best | 专用正文图片 | 公开章节正文结构已核对 |
| 48 | Bilibili-Manga | manga.bilibili.com | 正文可读画布 · 连续翻译 | 首屏真实翻译、恢复复用与加载等待通过；原站下一屏仍为空，翻页翻译未验收，标题修补有损伤 |
| 49 | Kaijimanga | kaijimanga.com | 专用正文图片 | 首页 HTML 可访问 |
| 50 | Idmzj | idmzj.com | 通用正文图片检测 | 连接失败 |
| 51 | Manga4u | mn4u.net | 专用正文图片 | 公开章节正文结构已核对 |
| 52 | Animatebookstore | animatebookstore.com | 可读画布连续翻译 | www 免费试读 HTTP 200；正文与透明交互层已核对 |
| 53 | GANMA | ganma.jp | 专用编号原稿图片检测 | 免费首话实际正文已显示，路径页码 /0→/4 保留同章；余白与推荐排除 |
| 54 | Mangafire | mangafire.to | 专用正文图片检测 | 公开章节 HTTP 200；首张正文已加载，后续懒加载 |
| 55 | Reaperscans | reaperscans.com | 通用正文图片检测 | 连接失败 |
| 56 | Manhuatop | manhuatop.com | 通用正文图片检测 | 本轮仍转至 ww547.manhuatop.com 域名停放页，无正文；停放域名未登记为漫画别名 |
| 57 | Dlsite | dlsite.com | 漫画目录委托 comipo 免费阅读 | 官方漫画入口正常转至 comipo，明确免费链接显示三张 1440×2048 blob 正文；不是本站独立正文或域名别名 |
| 58 | uzakichanmanga | uzakichanmanga.com | 专用正文图片 | 连接失败 |
| 59 | Shonenmagazine | shonenmagazine.com · pocket.shonenmagazine.com | 正文画布 · 圈选翻译 | 公开章节画布不可直接读取 |
| 60 | ComicNaver | comic.naver.com | 专用正文图片，自动韩语路径提示 | 实页正文与入口可见；自动源语言资源提示选择韩语和英语，未确认下载、未验实际 OCR；手动语言优先 |
| 61 | comic-zenon | comic-zenon.com | 不可读画布：圈选入口 | 公开章节结构已核对；画布受污染 |
| 62 | Webtoons | webtoons.com | 专用正文图片 | 公开章节正文结构已核对 |
| 63 | Lezhin Comics | lezhin.com、lezhinus.com | 专用英语站正文图片 | 免费首话真实翻译及滚动续译通过；韩语站未验收，Cookie 横幅遮挡下部 |
| 64 | BeLTOON | beltoon.jp | 专用正文图片检测 | 正常内容确认及免费首话入口打开 viewer/digging/p1；15 张同源 blob 长图，首张 1280×4306，入口通过；未验 OCR |
| 65 | ManhwaClub | manhwaclub.net | 专用正文图片 | 公开章节正文已核对；未验 OCR |
| 66 | JinMangas | jinmangas.com、mangafree.info | 通用正文图片检测；正文未验收 | 原站公开 301 跳转；当前目标及作品路径 HTTP 403，验证页无漫画入口 |
| 67 | Atsumaru | atsu.moe | 专用正文图片，长图分段 | 800×15744 原图的两段翻译链路通过；整条未验 |
| 68 | Comic CMOA | cmoa.jp | 分片正文：圈选入口 | www 免费试读 HTTP 200；正常关闭操作提示，分片已核对 |
| 69 | Televi-Kun Super Hero Comics | televikun-super-hero-comics.com | 画布/分片：圈选入口 | 首页 HTML 可访问 |
| 70 | KLMANGA | klmanga.my | 通用正文图片检测 | 连接失败 |
| 71 | SoloLevelingFree | sololevelingfree.vip | 通用正文图片检测 | 连接失败 |
| 72 | Rawkuma | rawkuma.net / rawkuma.com | 专用正文图片 | 首页 HTML 可访问 |
| 73 | Kakao | page.kakao.com | 专用正文图片 | 公开免费章节 HTTP 200；未验韩文 OCR 质量 |
| 74 | TopReadManga | topreadmanga.com | 通用正文图片检测 | 连接失败 |
| 75 | Revenge of the Iron Blooded Swordhound | revengeoftheiron-bloodedswordhound.one | 通用正文图片检测 | 连接失败 |
| 76 | Poipiku | poipiku.com | 公开单帖主图片 | 官方公开帖 800×579 主图与实页入口通过；推荐、头像排除，未验证私密帖或漫画质量 |
| 77 | Manhuaus | manhuaus.com / manhuaus.org | 通用正文图片检测 | 本轮 .com 与 .org 公开首页均为 HTTP 403 验证页，无正文 |
| 78 | HMTTMH | hmttmh.com | 通用正文图片检测 | 连接失败 |
| 79 | Smoking Behind the Supermarket | smokingbehindthesupermarket.com | 专用正文图片 | 公开章节正文结构已核对 |
| 80 | Comic Growl | comic-growl.com | 可读画布连续翻译 | 公开章节画布已核对 |
| 81 | Jumptoon | jumptoon.com | 受跨域限制画布：圈选入口 | 公开章节正文画布已核对 |
| 82 | Fenoxo | fenoxo.com | 通用正文图片检测 | 当前为游戏开发博客并有年龄验证表单，未确认公开漫画正文 |
| 83 | MangaFreak | mangafreak.net / mangafreak.me | 专用正文图片 | 公开章节正文结构已核对 |
| 84 | ComicGardo | comic-gardo.com | 画布/分片：圈选入口 | 公开章节 HTTP 200；画布像素 SecurityError；生产入口可打开并取消，未验证 OCR |
| 85 | Booklive | booklive.jp | 分片正文：圈选入口 | 正常免费试读、关闭说明及翻页已显示分片正文；圈选入口通过 |
| 86 | MrBlue | mrblue.com | 通用正文图片检测 | 正常免费首话按钮打开 viewer.mrblue.com 阅读窗口，窗口明确要求登录；没有正文，未提交登录 |
| 87 | MangaLove | mangalove.me | 正文画布圈选入口 | 免费 viewer 正文画布受跨域限制；不读取像素或启动连续图片翻译 |
| 88 | rawdevart.art | rawdevart.art | 通用正文图片检测 | 目录另外两部作品的 28.2、47 话仍只有空正文容器；47 话原生标签页选中对照仍为空；不据样本推断全站不可读 |
| 89 | manga-shinchan.com | manga-shinchan.com | 专用正文图片 | 最新免费章四张原稿及入口确认；推广遮挡下部，本轮未执行 OCR |
| 90 | yaoimangaonline.com | yaoimangaonline.com | 专用单帖正文图片 | 公开单帖 76 张正文，正常滚动后两张已加载、一张可见；入口通过，未验 OCR |
| 91 | nhentaiyaoi | nhentaiyaoi.net | 专用单帖正文图片 | 公开单帖 37 张正文已加载、一张可见；封面与推荐排除，入口通过，未验 OCR |
| 92 | orchisasia | orchisasia.org | 专用正文图片，长图分段 | 公开作者后记有 5 张 720 像素宽长图；实页入口通过，翻译质量未验 |
| 93 | mangalib | mangalib.me | 专用语义容器页图，自动俄语路径提示 | 另一公开章节加载 1337×1920 页图；正常方向键 p=2、同章页码及入口通过；自动源语言提示选择俄语和英语，旧空正文保留，未验实际 OCR |
| 94 | novelcrow | novelcrow.com | 通用正文图片检测 | 正常选中标签页目录可访问；仅确认封面与目录链接，正文待验证 |
| 95 | cn.twbzmg.com | cn.twbzmg.com | 包子漫画正文规则族 | 首页 HTML 可访问；本轮未验此域名章节 |
| 96 | Nyx Scans | nyxscans.com | 专用长条正文图片 | 免费章节与入口已核对；复用既有分段链路 |
| 97 | Qi Manga | qimanga.com | 专用长条正文图片 | 正常后台浏览器可打开免费章节；无界面模式的 403 记录保留 |
| 98 | MG Read | mgread.io | 专用正文图片 | 公开章节正文结构已核对 |
| 99 | 뉴토끼대피소.com | 뉴토끼대피소.com | 通用正文图片检测 | 当前 HTTP 200 但实际为 Parklogic 域名停放页，未确认正文或替代域名 |
| 100 | 블랙툰.co | 블랙툰.co | 通用正文图片检测 | 当前 HTTP 200 但实际为 Parklogic 域名停放页，未确认正文或替代域名 |
| 101 | happytoon01.com | happytoon01.com | 通用正文图片检测 | 连接失败 |
| 102 | twmanga.com | twmanga.com、twbzmg.com | 专用正文图片 | 公开阅读链接转至 www.twbzmg.com；AMP 正文已核对 |
| 103 | mgeko.cc | mgeko.cc | 专用正文图片 | 公开章节正文结构已核对 |
| 104 | greentoon.net | greentoon.net | 通用正文图片检测 | 当前 HTTP 429；正文未确认 |
| 105 | dynasty-scans.com | dynasty-scans.com | 专用正文图片 | 首页 HTML 可访问 |
| 106 | mangaoi.net | mangaoi.net | 专用直系章节图片 | 另一部作品的公开 50 话正常显示 130 张正文图片，实页入口通过；旧 221 话及新 21 话仍为 HTTP 200 的 404 页面，未验实际 OCR |
| 107 | rawlazy.io | rawlazy.io | 通用正文图片检测 | 另一实际 431 话的无界面调查及原生标签页选中对照都只有 logo、加载和摘要图；正文未确认，旧加载提示保留 |
| 108 | toptoon.com | toptoon.com | 首图/不可读画布：圈选入口 | 正常点击免费首话显示 720 像素宽正文；画布原生像素读取返回 SecurityError，首图和下一画布入口通过 |
| 109 | acgmhh.com | acgmhh.com / acgmhn.com | 专用编号页正文图片 | 原站 301 转至当前目录；经用户授权确认年龄提示后正常下一页显示 1000×1398 主图，推荐封面排除，实页入口通过；未验 OCR 或跨文档续译 |
| 110 | readcomicsonline.ru | readcomicsonline.ru | 通用正文图片检测 | 本轮公开首页 HTTP 403 验证页，无正文 |
| 111 | vortexscans.org | vortexscans.org | 专用正文图片 | 公开章节正文结构已核对 |
| 112 | freeonlinehd.site | freeonlinehd.site | 通用正文图片检测 | 当前为域名出售及联系页面，无漫画正文 |
| 113 | weebrook.com | weebrook.com | 通用正文图片检测 | 当前返回 522 原站连接超时，无正文 |
| 114 | toonily.com | toonily.com | 专用直系章节页图 | 关闭扩展的正常选中标签页第 254、255 话各有 30 张正文；生产 255 话入口通过，254 话当前 403 且没有漫画入口；未验 OCR |
| 115 | mangadistrict2.com | mangadistrict2.com | 通用正文图片检测 | 本轮公开首页连接被关闭，未取得正文；不推断永久停服 |
| 116 | manhuaread.com | manhuaread.com | 通用正文图片检测 | 当前首页为 PLAYBOOK88 博彩品牌，正文未确认 |
| 117 | mangaread.org | mangaread.org | 专用正文图片 | 公开章节正文结构已核对 |
| 118 | mangaforfree.net | mangaforfree.net | 专用正文图片 | 公开章节正文结构已核对 |
| 119 | bakamh.com | bakamh.com | 通用正文图片检测 | 目录在中止批次前返回 200；正常和无头章节样本均为 403，正文未确认 |
| 120 | yakshascans.com | yakshascans.com、ravenscans.org | 专用正文长图 | 正常关闭推广后五个分段翻译状态通过；标题和署名有错误，未作整章质量验收 |
| 121 | toonclash.com | toonclash.com | 通用正文图片检测 | 连接失败 |
| 122 | rawdex.net | rawdex.net | 专用正文图片 | 公开纵向章节正文和入口已核对；未验 OCR 或分页模式 |
| 123 | reset-scans.org | reset-scans.org | 通用正文图片检测 | 连接失败 |
| 124 | cultivationmanhua.com | cultivationmanhua.com | 通用正文图片检测 | HTTP 错误 |
| 125 | manhwaread.com | manhwaread.com | 通用正文图片检测 | 连接失败 |
| 126 | manhwabuddy.com | manhwabuddy.com | 专用正文图片 | 公开章节正文结构已核对 |
| 127 | wto.to | wto.to | 通用正文图片检测 | 正常跳转 CODA 网站关闭通知；通知中的教育漫画不是原站章节或域名迁移 |
| 128 | sukima.me | sukima.me | 通用正文图片检测 | 本轮浏览器 TLS 版本/密码套件错误，未取得正文 |
| 129 | comix.to | comix.to | 通用正文图片检测 | 访问受限 |
| 130 | youngchampion.jp | youngchampion.jp | 可读画布连续翻译 | 公开章节画布已核对 |
| 131 | manga-one.com | manga-one.com | 专用正文图片 | 公开章节正文结构已核对 |
| 132 | book.dmm.com | book.dmm.com | 通用正文图片检测 | 正常访问跳到明确的地区限制页，正文未显示 |
| 133 | newmanhwa.com | newmanhwa.com | 通用正文图片检测 | 本轮公开首页 HTTP 522 连接超时，无正文；不推断永久停服 |
| 134 | fxfx302.com | fxfx302.com | 通用正文图片检测 | 连接失败 |
| 135 | comic-meteor.jp | comic-meteor.jp · kirapo.jp | 分片阅读器 · 圈选翻译 | 公开章节 HTTP 200；旧站重定向 Kirapo |
| 136 | omegascans.org | omegascans.org | 专用长条正文图片 | 公开章节与入口已核对；排除上方横幅和外部推荐 |
| 137 | readallcomics.com | readallcomics.com | 通用正文图片检测 | 当前 HTTP 522 连接超时 |
| 138 | ranfren.neocities.org | ranfren.neocities.org | 静态正文图片 | 两种章节与 DDR 番外正文已核对；两页真实翻译、恢复与续译通过，手写/描边质量仍有限 |
| 139 | utoon.net | utoon.net | 通用检测；漫画正文未确认 | 当前首页为浏览器游戏；历史漫画归档返回 404 |
| 140 | manhuapica.com | manhuapica.com | 通用正文图片检测 | 网页版按钮打开线路测速选择，无正文；未登记代理域名 |
| 141 | comic-ryu.jp | comic-ryu.jp | 可读画布连续翻译 | 公开章节画布已核对 |
| 142 | ctccomic.com | ctccomic.com | 专用单页正文，含主页阅读 | 主页 900×1331、首话 900×1279 正文和实页入口通过；742 单独地址本次未加载正文 |
| 143 | nyaa.fan | nyaa.fan | 通用正文图片检测 | 连接失败 |
| 144 | mangago.me | mangago.me | 通用正文图片检测 | 访问受限 |
| 145 | rinkocomics.com | rinkocomics.com | 专用正文图片 · 长条分段 | 公开章节完整长图和入口已核对；本轮未验 OCR |
| 146 | roliascan.com | roliascan.com | 专用正文图片 | 公开章节正文结构已核对 |
| 147 | novelpia.com | novelpia.com | 专用正文圈选 | 正文可显示，但原生像素不可读且实际取图返回 403；已改为圈选，未验收实际圈选翻译 |
| 148 | zerobywai.com | zerobywai.com | 通用正文图片检测 | 当前 HTTP 200 但显示 404 Not Found，无正文 |
| 149 | toongod.cc | toongod.cc | 专用正文图片，长图分段 | 900×16006 原图的两段翻译链路通过；整条未验 |
| 150 | kingofshojo.com | kingofshojo.com | 专用正文图片 | 公开章节正文结构已核对 |
| 151 | weebcentral.com | weebcentral.com | 专用正文图片 | 首页 HTML 可访问 |
| 152 | lrr.tvc-16.science | lrr.tvc-16.science | 专用当前页图片检测 | 正常后台窗口显示 1081×1400 当前正文，隐藏概览排除；同 URL 正常翻页、暂停恢复和总开关清理通过；英语译文仍有误译 |
| 153 | mangarawad.org | mangarawad.org | 通用正文图片检测 | 连接失败 |
| 154 | manga-park.com | manga-park.com | 专用正文图片检测 | 作品页免费按钮已显示正文；直接章节地址 HTTP 404 |
| 155 | mangaflame.org | mangaflame.org | 通用检测；漫画正文未确认 | 当前跳转域名停放页，未将停放子域登记为漫画别名 |
| 156 | manhwa404.com | manhwa404.com | 通用正文图片检测 | 连接失败 |
| 157 | xmanga.org | xmanga.org | 通用正文图片检测 | 连接失败 |
| 158 | florascans.net | florascans.net | 通用正文图片检测 | 连接失败 |
| 159 | comic.mf-fleur.jp | comic.mf-fleur.jp | 专用正文图片 | 公开章节正文结构已核对 |
| 160 | komiic.com | komiic.com · komiic.cc | 通用正文图片检测 | 原站登录页明确公布官方 .cc 线路；两条线路当前均要求登录，生产验证无漫画入口；仅绑定域名，正文未确认 |
| 161 | manhwaus.org | manhwaus.org | 通用正文图片检测 | 连接失败 |
| 162 | tichct.org | tichct.org | 通用正文图片检测 | 连接失败 |
| 163 | manhuaplus.org | manhuaplus.org | 专用正文图片 | 公开章节 20 张完整正文；两张开头场景/SFX 阅读链路通过 |
| 164 | manhuazhan.com | manhuazhan.com | 正文懒加载图片 | 公开章节显示 1000 像素宽正文，实页入口通过；排除大尺寸加载占位图 |
| 165 | blossommanga.com | blossommanga.com | 通用正文图片检测 | 连接失败 |
| 166 | w226.npdn.top | w226.npdn.top | 通用正文图片检测 | 跳到群组/网址导航页，漫画正文未确认；不登记该跳转为漫画别名 |
| 167 | komiku.com | komiku.com | 通用正文图片检测 | 连接失败 |
| 168 | webtoonraw.com | webtoonraw.com | 通用正文图片检测 | 连接失败 |
| 169 | kissmanga.in | kissmanga.in | 通用正文图片检测 | 访问受限 |
| 170 | 02.ikiru.wtf | 02.ikiru.wtf | 通用正文图片检测 | 连接失败 |
| 171 | mangahub.ru | mangahub.ru | 专用正文图片，自动俄语路径提示 | 正文和入口已核对；自动源语言复用既有俄语与英语识别资源，手动选择优先；尚未验实际 OCR 及质量 |
| 172 | ezmanga.org | ezmanga.org | 通用正文图片检测 | 访问受限 |
| 173 | magustoon.org | magustoon.org | 通用正文图片检测 | 访问受限 |
| 174 | violetscans.org | violetscans.org、violetmanga.com | 专用正文图片 | 公开章节正文结构已核对 |
| 175 | publicdiplomacymagazine.com | publicdiplomacymagazine.com | 通用正文图片检测 | 访问受限 |
| 176 | raw1001.net | raw1001.net | 专用正文图片 | 正文和入口通过；开头页 OCR 链路通过，质量有明显限制 |
| 177 | mkissa.to | mkissa.to | 通用正文图片检测 | 公开作品有章节链接；实章 HTTP 403 验证页，正文未确认 |
| 178 | iqiyi.com | iqiyi.com | 通用正文图片检测 | 当前为视频门户；已观察链接未见漫画入口 |
| 179 | jcomic.net | jcomic.net | 专用单帖正文图片 | 公开 page 单帖 28 张直系 707×1000 正文；排除分类链接缩略图，未验 OCR |
| 180 | tapas.io | tapas.io | 专用正文图片 | 公开章节 HTTP 200；两张实际对白翻译链路已核对 |
| 181 | kagane.to | kagane.to | 通用正文图片检测 | 访问受限 |
| 182 | soraraw.com | soraraw.com | 通用正文图片检测 | 正常窗口缩放提示持续遮住阅读器，正文未验收 |
| 183 | gomuraw.biz | gomuraw.biz | 通用正文图片检测 | 连接失败 |
| 184 | webtoonscan.com | webtoonscan.com | 通用正文图片检测 | 访问受限 |
| 185 | zipcomic.com | zipcomic.com | 通用正文图片检测 | 当前 HTTP 403 验证页 |
| 186 | zerobywzz.com | zerobywzz.com | 通用正文图片检测 | 连接失败 |
| 187 | dokusho-ojikan.jp | dokusho-ojikan.jp | 专用画布圈选 | 公开试读九张正文画布不可读；圈选入口确认，实际圈选翻译待验证 |
| 188 | bomtoon.com | bomtoon.com | 专用可读正文画布 | 免费首话 p0 显示两块 1440×1440 可读非空正文画布；真实入口通过，版权图片排除；未验实页 OCR |
| 189 | copymanga.site | copymanga.site | 通用正文图片检测 | 当前为 ParkLogic 停放/广告跳转页，没有确认漫画目录或章节 |
| 190 | readcomiconline.li | readcomiconline.li | 通用正文图片检测 | 连接失败 |
| 191 | championcross.jp | championcross.jp | 可读画布连续翻译 | 公开章节画布已核对 |
| 192 | mechacomic.jp | mechacomic.jp | 纵向完整正文图片 | 正常免费入口及两幅对白 OCR 链路通过；竖排漏识别/错译仍在 |
| 193 | kuragebunch.com | kuragebunch.com | 画布/分片：圈选入口 | 公开章节 HTTP 200；画布像素 SecurityError；生产入口可打开并取消，未验证 OCR |
| 194 | ichicomi.com | ichicomi.com | 受跨域限制画布：圈选入口 | 公开章节画布结构已核对 |
| 195 | rookie.shonenjump.com | rookie.shonenjump.com | 专用正文图片 | 公开章节正文结构已核对 |
| 196 | manhwa-raw.com | manhwa-raw.com | 通用正文图片检测 | 访问受限 |
| 197 | s1.managall.com | s1.managall.com | 通用正文图片检测 | 连接失败 |
| 198 | manhwato.com | manhwato.com | 专用正文图片 | 公开章节正文及扩展入口已核对；无 OCR 验收 |
| 199 | kuaikanmanhua.com | kuaikanmanhua.com | 通用正文图片检测 | 本轮一章转向登录、一章显示付费提示与二维码，无正文；付费页生产验证无漫画入口，未点击购买；章节菜单正常点击超时 |
| 200 | mangapark.net | mangapark.net | 通用正文图片检测 | 连接失败 |
| 201 | mangasuika.com | mangasuika.com | 通用正文图片检测 | 本轮公开首页连接被关闭，未取得正文；不推断永久停服 |
| 202 | firemanga.com | firemanga.com | 通用正文图片检测 | 连接失败 |
| 203 | lmanga.com | lmanga.com | 通用正文图片检测 | 当前跳转 /lander；正文未确认 |
| 204 | manhwahub.net | manhwahub.net | 通用正文图片检测 | 本轮公开首页连接被关闭，未取得正文；不推断永久停服 |
| 205 | manhuatop.org | manhuatop.org | 通用正文图片检测 | 访问受限 |
| 206 | aedexnox.vxviral.xyz | aedexnox.vxviral.xyz | 通用正文图片检测 | 连接失败 |
| 207 | manhuabika.com | manhuabika.com | 通用正文图片检测 | PicaWeb 首页可访问；未找到可确认的公开章节正文 |
| 208 | rawotaku.com | rawotaku.com | 专用正文图片 | 公开章节入口与两页 OCR 链路通过；识别翻译质量仍有缺陷 |
| 209 | pixiv.app | pixiv.app | 通用正文图片检测 | 连接失败 |
| 210 | speed-manga.com | speed-manga.com / speed-manga.net | 专用正文图片 | 公开章节正文结构已核对 |
| 211 | yomonga.com | yomonga.com | 明确章节的完整分片页 · 圈选入口 | 当前免费首话及第二话 HTTP 200，整页分为三片；两个实页入口打开和取消通过，未验 OCR；旧维护记录保留 |
| 212 | global.manga-up.com | global.manga-up.com | 专用正文图片 | 公开章节 HTTP 200；正文与 Cookie 提示已核对 |
| 213 | mangaball.net | mangaball.net、mangaball.com | 通用正文图片检测 | 跳转现用 .com；正文图片受浏览器响应来源限制 |
| 214 | yanmaga.jp | yanmaga.jp | 画布/分片：圈选入口 | 首页 HTML 可访问 |
| 215 | viewer.bookhodai.jp | viewer.bookhodai.jp | 通用正文图片检测 | 此前根地址转至订阅与登录首页；本轮正常导航 25 秒超时，未记录 HTTP 状态，不推断停服，正文未确认 |
| 216 | play.comipo.app | play.comipo.app | 专用免费正文图片 | 官方免费链接正常转至 viewer/free/BJ 书号；实际翻译、暂停恢复、缓存与同 URL 翻页通过，三份不同输出已查看，存在误译及原文残留 |
| 217 | arenascan.com | arenascan.com | 专用正文图片 | 公开章节正文结构已核对 |
| 218 | luvyaa.my.id | luvyaa.my.id / luvyaa.co / v5.luvyaa.co | 已核对正文图片 | 原域名落地页显式链接与正常跳转确认现用域名，readerarea 中完整长图复用分段链路；排除上方广告 |
| 219 | toondex.co | toondex.co | 专用正文图片 | 编号正文及扩展入口已核对；无 OCR 验收 |
| 220 | manwadd.cc | manwadd.cc | 通用正文图片检测 | 连接失败 |
| 221 | saucemanhwa.com | saucemanhwa.com | 通用正文图片检测 | 当前返回 429；此前停放跳转保留，不视为永久关闭 |
| 222 | mangakoinu.com | mangakoinu.com | 通用正文图片检测 | 连接失败 |
| 223 | comicmanga.cc | comicmanga.cc | 通用正文图片检测 | 本轮公开首页连接被关闭，未取得正文；不推断永久停服 |
| 224 | mangajikan.com | mangajikan.com | 通用正文图片检测 | 连接失败 |
| 225 | manhwaden.com | manhwaden.com | 专用长图正文 | 完整长图及扩展入口已核对；共用分段，无本轮 OCR 验收 |
| 226 | dvamh-vzwp7.top | dvamh-vzwp7.top | 通用正文图片检测 | 当前首页 HTTP 429，无正文；不据此推断永久关闭 |
| 227 | comic.pixiv.net | comic.pixiv.net | 公开背景正文 · 连续翻译 | 同源背景完整页可读 |
| 228 | comico.jp | comico.jp | 通用正文图片检测 | 既有销售与租阅结束记录保留；本轮首页仅导航和账户入口，无公开章节，不新增停服日期推断；已购书架未验证 |
| 229 | manhwas.men | manhwas.men | 通用正文图片检测 | 连接失败 |
| 230 | ridibooks.com | ridibooks.com | 公开试读 blob 整页检测 | 原站试读显示两张 1512×2150 正文，生产入口通过；另一作品由占位换成 1500×2168，未验 OCR；旧 403 保留 |
| 231 | sunday-webry.com | sunday-webry.com | 正文画布 · 圈选翻译 | 公开章节画布不可直接读取 |
| 232 | ynjn.jp | ynjn.jp | 公开可读画布 · 连续翻译入口 | 两个阅读页 HTTP 200，可读非空的 840/844×1200 正文画布，生产入口通过；未验 OCR 或全部章节，旧 503 保留 |
| 233 | mangayun.com | mangayun.com | 专用正文图片 | 如漫画来源首话完整正文和入口通过；第一来源 403 保留 |
| 234 | manhwaweb.com | manhwaweb.com | 已核对正文图片 | /leer/ 公开章节限定正文直系图片，完整长图复用分段链路；排除音乐按钮图片和封面 |
| 235 | a-i-manga.com | a-i-manga.com | 专用正文图片检测 | 公开作品阅读页 HTTP 200；24 张编号正文图片 |
