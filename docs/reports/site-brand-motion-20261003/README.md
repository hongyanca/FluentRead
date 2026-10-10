# Homepage brand and motion correction

The homepage now leads with 流畅阅读 / FluentRead and the canonical slogan 让语言更近，让世界更大。. Six greetings surround the hero as background decorations, alongside the retained webpage, PDF and word cards. The foreground greeting row and repetitive feature copy are removed.

All five capabilities use the same introduction/demo layout: bilingual webpages, selection translation, documents, images/comics, and video/meetings. The selection example follows the actual `SelectionTranslator.vue` presentation: a bilingual sentence card and a dictionary card with pronunciation, word class, definition and example. These are local demonstration fixtures, not live provider calls. There are no input-translation promotion, AI marketing headline, numbered animation controls, cursor paths or repeated bottom installation panel.

The demonstration stages reserve their dimensions. Translation lines and both selection cards remain in the layout, with opacity/visibility changes instead of inserting content during playback. Motion consists of a 3px result reveal, selection highlighting and a gentle 6px background float. Existing visibility and reduced-motion handling is reused.

## Validation

- `pnpm docs:typecheck`, `pnpm docs:build`, `pnpm docs:check` passed. The build checker inspected 75 pages, 3748 local links, 712 anchors and 112 image references.
- Controlled in-app browser: Chinese at 1280px and 320px; English at 390px. Each of the five demos was sampled at phases 0–5 and at the next loop's phase 0: 105 observations total. For every group, panel height, document height, scroll position and all feature-row positions were unchanged, with no stage overflow. Raw observations and per-group summaries are in `motion-samples.json`. The final shorter document title was rechecked in the 320px cycle; the earlier measurements used the same geometry with a longer title.
- Additional 768px and 1920px layout inspection: no horizontal overflow; wide-screen decorative cards remained outside the central brand. At smaller widths cards hide and peripheral greetings remain visible without obscuring the foreground.
- Pause/replay, browser installation dropdown, Escape dismissal, white documentation homepage and inactive demo pause state inspected. No captured browser console errors.
- Reduced-motion behavior verified in source; OS preference switching and real mobile devices were not exercised. Live translation providers, authenticated videos/meetings, extension store releases and full extension regression are outside this website-only check.
- Fresh worktree builds print the existing missing `.wxt/tsconfig.json` warning; the website build and its own typecheck succeed.

Design follows the user's retained hero elements and the existing FluentRead card UI. No reference repository code or new runtime dependencies were copied. Reports and screenshots are excluded from the published website.

## Screenshots

![Hero](hero-desktop.png)
![Bilingual webpages](webpage-desktop.png)
![Selection dictionary card](selection-desktop.png)
![White documentation homepage](docs-desktop.png)
