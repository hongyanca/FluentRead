# Clear translation features and documentation

The homepage now starts with the localized product name and a concrete bilingual translation headline. Each illustration follows a visible feature name and a short explanation. The five featured capabilities are webpage bilingual translation, selection translation, document translation, image/comic translation, and video/meeting translation. Input translation remains in the documentation but has been removed from homepage marketing. The repeated bottom installation section has been deleted.

Hello, 你好, Bonjour, Hola, こんにちは and 안녕하세요 form an ordered, gently animated greeting row. The large curved mouse trajectories and pretend action buttons have been removed from homepage and documentation examples. Translations appear in their owning content area after approximately one second, then remain readable for several seconds. The original webpage and document text stays visible. An independently drawn inline SVG comic demonstrates translating dialogue inside a speech bubble. Video subtitles show a practical meeting sentence with its translation. These local demonstrations do not send translation requests.

Selection translation is the default illustration in its section. Optional sentence structure is disclosed underneath; automatic highlighting, manual phrase selection, pause and arrow-key navigation remain available. The homepage foregrounds translation without AI marketing. Documentation keeps technical model requirements where relevant.

The video section explicitly lists YouTube, X, Google Meet, Teams and Zoom, with the requirement for a web client and readable meeting captions. These capabilities were checked against the existing product documentation, not against live meetings or authenticated platform accounts.

The documentation homepage uses one quick-start action followed by 22 named guide links grouped under webpage translation, media, learning and settings. Decorative preview cards and the redundant numbered installation strip have been removed. Chinese documentation navigation now uses 流畅阅读. Backgrounds remain white. Existing guide URLs and group anchor IDs are preserved.

The existing Vue/VitePress framework supports the new layout. No dependencies were added, no reference repository was modified, and no reference code or artwork was copied. Read Frog informed the earlier visual hierarchy; this revision follows the user's more specific feature and clarity feedback.

## Verification

- `pnpm docs:typecheck`, `pnpm docs:build`, `pnpm docs:check` pass. The production checker covers 75 pages, 3748 internal links, 712 anchors and 102 local images, locale navigation, provider placeholders, and the five featured translation capabilities.
- The preview build emits the existing missing `.wxt/tsconfig.json` warning in the isolated docs worktree; the separate documentation typecheck passes.
- Background in-app browser checks covered Chinese homepage widths 320, 390 and 1280, English homepage widths 320, 768 and 1920, Chinese documentation at 320 and 1280, and English documentation at 768. Measured viewports had no horizontal overflow. Requested viewport sizes were not counted without DOM confirmation.
- At 320px the Chinese and English headline spans each remain one line. The browser dropdown is contained between x=39 and x=281. Escape closes it. Six greeting chips remain visible on mobile.
- Browser navigation from English homepage to documentation and back retains the appropriate layout and documentation search.
- Bilingual translation results appear automatically. Pause retains the result; replay resumes. Offscreen demonstrations stop their timers. Document and comic translation results and video bilingual captions were observed. Grammar phrase selection and ArrowRight advance to the expected phrase and stop autoplay.
- No console errors were captured on the final homepage and documentation tabs. Screenshot and DOM records are included alongside this report.
- Source retains reduced-motion handling and listener/timer cleanup. OS reduced-motion settings, store installation, live translation providers, real Firefox, live YouTube/X playback and authenticated meetings were not exercised. Extension regression suites were not run for this website-only change.

Report screenshots are excluded from the public website build.
