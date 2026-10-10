# Highlight the product name and restore floating cards and silent read-aloud previews

The user requested the original tilted floating cards instead of margin notes, and requested that clicking the homepage read-aloud demonstration not play sound. They also requested more emphasis on the product name in the introduction. The centered hero icon and two-line slogan from PR #794 are retained.

## Changes

- Restored the original HeroOrbit component from the parent of the PR #784 implementation commit, including the page-card window dots and visibility-aware animation lifecycle.
- Restored its original card borders, 20px corners, shadows, tilts, dimensions and gentle 6px floating animation; removed the margin-note frame lines. At 1101–1279px the side cards sit farther outward to leave room for the English introduction.
- Central hero geometry, localized wording and ten greeting placements remain unchanged; cards stay hidden at widths up to 1100px as before.
- Restored FeatureDemo to its silent version from `c36f7f89`. Clicking original/translation selects the appropriate visual demonstration and pauses autoplay; labels and the note explicitly identify a silent preview.
- Removed the website-only speech helper, its tests and test-matrix entry, and restored the documentation verifier's preview-control contract. Extension read-aloud code was not changed.
- Highlighted the inline product name (流畅阅读 / FluentRead) with a pale yellow marker stroke behind the lower half of the letters. The text retains its original color, weight and size, and stays together on narrow screens. The decorative stroke occupies no layout space.

## Verification

- WXT prepare, docs typecheck, production build, docs link/asset checks and `git diff --check`: passed.
- Docs checker: 75 pages, 3758 links, 722 anchors and 112 images.
- Test registration audit: passed; 453 files and 5804 cases. This was the registration audit, not execution of the full test suite.
- The compiled website JavaScript contains no `speechSynthesis`, `SpeechSynthesisUtterance` or `createDemoSpeech` reference.
- Chinese and English viewports: 320, 390, 760, 1100, 1101, 1280 and 1440px. No horizontal overflow; cards are visible on desktop and hidden below their original breakpoint; the 64px hero icon and ten greetings remain.
- Before the additional inline brand emphasis, repeated 1280px hero samples showed moving cards with identical central geometry matching the previous production layout. The final change retains the hero structure and adds a decorative marker stroke behind the inline product name.
- Original/translation preview clicks in both languages select steps 3/4, update pressed/highlight state, pause autoplay, keep the demo frame at the same size and show the silent-preview note. No speech state is present.
- Moving to the selection section pauses all three hero-card animations. Reduced-motion CSS disables the restored animation.
- Final browser warning/error logs were empty. Verification used a background in-app browser and responsive viewport overrides, not a physical phone test.
- The local preview server was restarted after a subsequent build so the final checks used the final asset set; intermediate unstyled samples are excluded from the report.
- After the additional product-name change, docs typecheck, production build, link/asset checks and diff checks passed again. Chinese and English at 320, 390, 1101 and 1280px retain the localized name in rgb(78, 73, 84), 400 weight and 15/18px font size, with a yellow rgba(244, 216, 120, 0.48) marker and zero horizontal overflow. Updated hero screenshots use this final build.

Screenshots: [Desktop](desktop.png), [Mobile](mobile.png), [Silent selection preview](selection.png), [Narrow English desktop](en-1101.png). [Restoration measurements](measurements.json). [Final brand measurements](brand-measurements.json).
