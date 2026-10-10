/**
 * @file src/core/config/mangaSiteCatalog.ts
 * 文件职责：保存用户要求的漫画网站目录和通用图片阅读器选择器，支持统一入口与后续逐站适配。
 * 主要内容：JinMangas 原站及公开重定向目标登记但正文仍受验证限制；ACG 原站公开 301 跳转后的当前目录域名，显式域名与公开网站别名，精确域名/子域匹配；目录只表示可以尝试图片阅读器，不等于全部站点已通过真实章节验收。
 * 模块边界：静态目录和纯匹配，不抓取章节，不绕过登录，不声明画布或分片阅读器可译；没有复制第三方适配源码。
 */
export const MANGA_READER_SELECTORS = '.reading-content img, .reader-area img, .chapter-content img, .page-break img, #reader img, #manga-reader img, #viewer img, [data-manga-reader] img, [class*="Reader"] img, [class*="reader"] img, [class*="viewer"] img';
/** 来源：用户域名清单、指定 Issue 的名称链接及原站名称/公开重定向；实际能力由页面检测决定。 */
export const MANGA_SITE_DOMAINS = `
mangamillion.shueisha.co.jp mangadna.com rimacomiplus.jp comic-growl.com heros-web.com speed-manga.net mangaball.com luvyaa.co v5.luvyaa.co
younganimal.com animatebookstore.com cmoa.jp jumptoon.com comic-gardo.com manga.bilibili.com page.kakao.com
zebrack-comic.shueisha.co.jp comic-fuz.com mangadex.org yamibo.com shonenjumpplus.com viewer.heros-web.com comic-days.com comic-top.com comic-walker.com web-ace.jp antbyw.com jmanga.org twicomi.com mangaz.com pash-up.jp colamanga.com ganganonline.com asuracomic.net allmanga.to manhwaclan.com corocoro.jp tonarinoyj.jp yymanhua.com manhwatop.com palcy.jp comic-trail.com templetoons.com batocomic.net comic-action.com ac.qq.com sololevelingmangafree.com
rawdevart.art manga-shinchan.com yaoimangaonline.com mangalib.me novelcrow.com cn.twbzmg.com 뉴토끼대피소.com 블랙툰.co happytoon01.com twmanga.com mgeko.cc greentoon.net dynasty-scans.com mangaoi.net rawlazy.io toptoon.com acgmhh.com acgmhn.com readcomicsonline.ru vortexscans.org freeonlinehd.site weebrook.com toonily.com mangadistrict2.com manhuaread.com mangaread.org mangaforfree.net bakamh.com yakshascans.com toonclash.com rawdex.net reset-scans.org cultivationmanhua.com manhwaread.com manhwabuddy.com wto.to sukima.me comix.to youngchampion.jp manga-one.com book.dmm.com newmanhwa.com fxfx302.com comic-meteor.jp omegascans.org readallcomics.com ranfren.neocities.org utoon.net manhuapica.com comic-ryu.jp ctccomic.com nyaa.fan mangago.me rinkocomics.com roliascan.com novelpia.com zerobywai.com toongod.cc kingofshojo.com weebcentral.com lrr.tvc-16.science mangarawad.org manga-park.com mangaflame.org manhwa404.com xmanga.org florascans.net comic.mf-fleur.jp komiic.com manhwaus.org tichct.org manhuaplus.org manhuazhan.com blossommanga.com w226.npdn.top komiku.com webtoonraw.com kissmanga.in 02.ikiru.wtf mangahub.ru ezmanga.org magustoon.org violetscans.org publicdiplomacymagazine.com raw1001.net mkissa.to iqiyi.com jcomic.net tapas.io kagane.to soraraw.com gomuraw.biz webtoonscan.com zipcomic.com zerobywzz.com dokusho-ojikan.jp bomtoon.com copymanga.site readcomiconline.li championcross.jp mechacomic.jp kuragebunch.com ichicomi.com rookie.shonenjump.com manhwa-raw.com s1.managall.com manhwato.com kuaikanmanhua.com mangapark.net mangasuika.com firemanga.com lmanga.com manhwahub.net manhuatop.org aedexnox.vxviral.xyz manhuabika.com rawotaku.com pixiv.app speed-manga.com yomonga.com global.manga-up.com mangaball.net yanmaga.jp viewer.bookhodai.jp play.comipo.app arenascan.com luvyaa.my.id toondex.co manwadd.cc saucemanhwa.com mangakoinu.com comicmanga.cc mangajikan.com manhwaden.com dvamh-vzwp7.top comic.pixiv.net comico.jp manhwas.men ridibooks.com sunday-webry.com ynjn.jp mangayun.com manhwaweb.com a-i-manga.com
atsu.moe fenoxo.com hanime1.me klmanga.my mangafreak.me mangafreak.net mangalove.me mangaraw.ac mangaraw.best mangarawjp.me manhuaus.com manhuaus.org manhwaclub.net mgread.io mn4u.net nhentaiyaoi.net nyxscans.com omemh8.com orchisasia.org qimanga.com rawkuma.com rawkuma.net revengeoftheiron-bloodedswordhound.one smokingbehindthesupermarket.com sololevelingfree.vip syosetu.si syosetu.cheap televikun-super-hero-comics.com topreadmanga.com kaijimanga.com uzakichanmanga.com hmttmh.com asurascans.com violetmanga.com ravenscans.org kirapo.jp
bookwalker.jp mangafire.to reaperscans.com manhuatop.com dlsite.com shonenmagazine.com comic.naver.com comic-zenon.com webtoons.com lezhin.com lezhinus.com twbzmg.com beltoon.jp poipiku.com booklive.jp mrblue.com ganma.jp piccoma.com hentaizap.com globalcomix.com syosetu.com comick.io comick.dev comick.fun klz9.com idmzj.com hanimeone.me battwo.com mangabuddy.com readcomic.me
jinmangas.com mangafree.info
komiic.cc
`.trim().split(/\s+/).map(host => new URL(`https://${host}`).hostname);
const domains = new Set(MANGA_SITE_DOMAINS);
export function isCatalogMangaHost(hostname: string): boolean {
    const parts = hostname.split('.');
    for (let index = 0; index < parts.length - 1; index++) if (domains.has(parts.slice(index).join('.'))) return true;
    return false;
}

/** 展示完整需求名称与域名；名称未确认时保留空域名，不拼造跳转链接。 */
export const MANGA_SITE_CATALOG: {name: string; hosts: string[]}[] = `
Pixiv|pixiv.net
MANGA Plus by SHUEISHA|mangaplus.shueisha.co.jp
Zebrack by SHUEISHA|zebrack-comic.shueisha.co.jp
MANGA Million by SHUEISHA|mangamillion.shueisha.co.jp
COMIC FUZ|comic-fuz.com
MangaDex|mangadex.org
MangaDNA|mangadna.com
Yamibo|yamibo.com
ShonenJumpPlus|shonenjumpplus.com
Rimacomiplus|rimacomiplus.jp
Heros Web|viewer.heros-web.com heros-web.com
Comic Days|comic-days.com
Comic Top|comic-top.com
ComicWalker|comic-walker.com
Web Ace|web-ace.jp
Antbyw|antbyw.com
Jmanga|jmanga.org
Twitter Comic|twicomi.com
MangaZ|mangaz.com
PASH UP|pash-up.jp
BOOK☆WALKER|bookwalker.jp
COLAMANGA|colamanga.com
GANGAN ONLINE|ganganonline.com
Asura Scans|asuracomic.net asurascans.com
All Manga|allmanga.to
Manhwaclan|manhwaclan.com
CoroCoro|corocoro.jp
tonarinoyj|tonarinoyj.jp
Yymanhua|yymanhua.com
Manhwatop|manhwatop.com
Palcy|palcy.jp
Comic-Trail|comic-trail.com
Templetoons|templetoons.com
Batocomic|batocomic.net
Comic-action|comic-action.com
腾讯动漫|ac.qq.com
Sololevelingmangafree|sololevelingmangafree.com
Syosetu|syosetu.si syosetu.cheap
Comick|comick.io comick.dev comick.fun
YoungAnimal|younganimal.com
Piccoma|piccoma.com
Hentaizap|hentaizap.com
Hanime1|hanime1.me
Globalcomix|globalcomix.com
KL|klz9.com
comemh8|omemh8.com
Mangaraw|mangarawjp.me mangaraw.ac mangaraw.best
Bilibili-Manga|manga.bilibili.com
Kaijimanga|kaijimanga.com
Idmzj|idmzj.com
Manga4u|mn4u.net
Animatebookstore|animatebookstore.com
GANMA|ganma.jp
Mangafire|mangafire.to
Reaperscans|reaperscans.com
Manhuatop|manhuatop.com
Dlsite|dlsite.com
uzakichanmanga|uzakichanmanga.com
Shonenmagazine|shonenmagazine.com pocket.shonenmagazine.com
ComicNaver|comic.naver.com
comic-zenon|comic-zenon.com
Webtoons|webtoons.com
Lezhin Comics|lezhin.com lezhinus.com
BeLTOON|beltoon.jp
ManhwaClub|manhwaclub.net
JinMangas|jinmangas.com mangafree.info
Atsumaru|atsu.moe
Comic CMOA|cmoa.jp
Televi-Kun Super Hero Comics|televikun-super-hero-comics.com
KLMANGA|klmanga.my
SoloLevelingFree|sololevelingfree.vip
Rawkuma|rawkuma.net rawkuma.com
Kakao|page.kakao.com
TopReadManga|topreadmanga.com
Revenge of the Iron Blooded Swordhound|revengeoftheiron-bloodedswordhound.one
Poipiku|poipiku.com
Manhuaus|manhuaus.com manhuaus.org
HMTTMH|hmttmh.com
Smoking Behind the Supermarket|smokingbehindthesupermarket.com
Comic Growl|comic-growl.com
Jumptoon|jumptoon.com
Fenoxo|fenoxo.com
MangaFreak|mangafreak.net mangafreak.me
ComicGardo|comic-gardo.com
Booklive|booklive.jp
MrBlue|mrblue.com
MangaLove|mangalove.me
rawdevart.art|rawdevart.art
manga-shinchan.com|manga-shinchan.com
yaoimangaonline.com|yaoimangaonline.com
nhentaiyaoi|nhentaiyaoi.net
orchisasia|orchisasia.org
mangalib|mangalib.me
novelcrow|novelcrow.com
cn.twbzmg.com|cn.twbzmg.com
Nyx Scans|nyxscans.com
Qi Manga|qimanga.com
MG Read|mgread.io
뉴토끼대피소.com|뉴토끼대피소.com
블랙툰.co|블랙툰.co
happytoon01.com|happytoon01.com
twmanga.com|twmanga.com twbzmg.com
mgeko.cc|mgeko.cc
greentoon.net|greentoon.net
dynasty-scans.com|dynasty-scans.com
mangaoi.net|mangaoi.net
rawlazy.io|rawlazy.io
toptoon.com|toptoon.com
acgmhh.com|acgmhh.com acgmhn.com
readcomicsonline.ru|readcomicsonline.ru
vortexscans.org|vortexscans.org
freeonlinehd.site|freeonlinehd.site
weebrook.com|weebrook.com
toonily.com|toonily.com
mangadistrict2.com|mangadistrict2.com
manhuaread.com|manhuaread.com
mangaread.org|mangaread.org
mangaforfree.net|mangaforfree.net
bakamh.com|bakamh.com
yakshascans.com|yakshascans.com ravenscans.org
toonclash.com|toonclash.com
rawdex.net|rawdex.net
reset-scans.org|reset-scans.org
cultivationmanhua.com|cultivationmanhua.com
manhwaread.com|manhwaread.com
manhwabuddy.com|manhwabuddy.com
wto.to|wto.to
sukima.me|sukima.me
comix.to|comix.to
youngchampion.jp|youngchampion.jp
manga-one.com|manga-one.com
book.dmm.com|book.dmm.com
newmanhwa.com|newmanhwa.com
fxfx302.com|fxfx302.com
comic-meteor.jp|comic-meteor.jp kirapo.jp
omegascans.org|omegascans.org
readallcomics.com|readallcomics.com
ranfren.neocities.org|ranfren.neocities.org
utoon.net|utoon.net
manhuapica.com|manhuapica.com
comic-ryu.jp|comic-ryu.jp
ctccomic.com|ctccomic.com
nyaa.fan|nyaa.fan
mangago.me|mangago.me
rinkocomics.com|rinkocomics.com
roliascan.com|roliascan.com
novelpia.com|novelpia.com
zerobywai.com|zerobywai.com
toongod.cc|toongod.cc
kingofshojo.com|kingofshojo.com
weebcentral.com|weebcentral.com
lrr.tvc-16.science|lrr.tvc-16.science
mangarawad.org|mangarawad.org
manga-park.com|manga-park.com
mangaflame.org|mangaflame.org
manhwa404.com|manhwa404.com
xmanga.org|xmanga.org
florascans.net|florascans.net
comic.mf-fleur.jp|comic.mf-fleur.jp
komiic.com|komiic.com komiic.cc
manhwaus.org|manhwaus.org
tichct.org|tichct.org
manhuaplus.org|manhuaplus.org
manhuazhan.com|manhuazhan.com
blossommanga.com|blossommanga.com
w226.npdn.top|w226.npdn.top
komiku.com|komiku.com
webtoonraw.com|webtoonraw.com
kissmanga.in|kissmanga.in
02.ikiru.wtf|02.ikiru.wtf
mangahub.ru|mangahub.ru
ezmanga.org|ezmanga.org
magustoon.org|magustoon.org
violetscans.org|violetscans.org violetmanga.com
publicdiplomacymagazine.com|publicdiplomacymagazine.com
raw1001.net|raw1001.net
mkissa.to|mkissa.to
iqiyi.com|iqiyi.com
jcomic.net|jcomic.net
tapas.io|tapas.io
kagane.to|kagane.to
soraraw.com|soraraw.com
gomuraw.biz|gomuraw.biz
webtoonscan.com|webtoonscan.com
zipcomic.com|zipcomic.com
zerobywzz.com|zerobywzz.com
dokusho-ojikan.jp|dokusho-ojikan.jp
bomtoon.com|bomtoon.com
copymanga.site|copymanga.site
readcomiconline.li|readcomiconline.li
championcross.jp|championcross.jp
mechacomic.jp|mechacomic.jp
kuragebunch.com|kuragebunch.com
ichicomi.com|ichicomi.com
rookie.shonenjump.com|rookie.shonenjump.com
manhwa-raw.com|manhwa-raw.com
s1.managall.com|s1.managall.com
manhwato.com|manhwato.com
kuaikanmanhua.com|kuaikanmanhua.com
mangapark.net|mangapark.net
mangasuika.com|mangasuika.com
firemanga.com|firemanga.com
lmanga.com|lmanga.com
manhwahub.net|manhwahub.net
manhuatop.org|manhuatop.org
aedexnox.vxviral.xyz|aedexnox.vxviral.xyz
manhuabika.com|manhuabika.com
rawotaku.com|rawotaku.com
pixiv.app|pixiv.app
speed-manga.com|speed-manga.com speed-manga.net
yomonga.com|yomonga.com
global.manga-up.com|global.manga-up.com
mangaball.net|mangaball.net mangaball.com
yanmaga.jp|yanmaga.jp
viewer.bookhodai.jp|viewer.bookhodai.jp
play.comipo.app|play.comipo.app
arenascan.com|arenascan.com
luvyaa.my.id|luvyaa.my.id luvyaa.co v5.luvyaa.co
toondex.co|toondex.co
manwadd.cc|manwadd.cc
saucemanhwa.com|saucemanhwa.com
mangakoinu.com|mangakoinu.com
comicmanga.cc|comicmanga.cc
mangajikan.com|mangajikan.com
manhwaden.com|manhwaden.com
dvamh-vzwp7.top|dvamh-vzwp7.top
comic.pixiv.net|comic.pixiv.net
comico.jp|comico.jp
manhwas.men|manhwas.men
ridibooks.com|ridibooks.com
sunday-webry.com|sunday-webry.com
ynjn.jp|ynjn.jp
mangayun.com|mangayun.com
manhwaweb.com|manhwaweb.com
a-i-manga.com|a-i-manga.com
`.trim().split('\n').map(row => {
    const [name, hosts] = row.split('|');
    return {name, hosts: hosts.split(' ').filter(Boolean)};
});
