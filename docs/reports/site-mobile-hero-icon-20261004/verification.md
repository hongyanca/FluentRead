# Narrow-screen homepage brand icon

The Chinese and English homepages now show the existing brand icon above the two-line slogan at widths of 760px or less. The icon is 64 × 64 CSS pixels, centered, with a 24px gap before the slogan. Narrow-screen hero top padding is 72px. The icon has intrinsic dimensions to reserve its space and an empty alt attribute because it is decorative beside the already identified brand.

At widths above 760px the icon is hidden. Hero wording, navigation, feature sections, and speech behavior are unchanged.

## Validation

- `pnpm docs:typecheck`: passed.
- `pnpm docs:build`: passed.
- `pnpm docs:check`: passed; 75 pages, 3754 links, 718 anchors, 112 images.
- `git diff --check`: passed.
- Built-site browser validation: Chinese widths 320, 390, 430, 640, 760, 761, 840, and 1280; English widths 320, 390, and 1280.
- At every checked narrow width, the icon is 64 × 64, horizontally centered, 72px below the hero top, and 24px above the slogan.
- No horizontal page overflow at the checked widths; both localized slogans remain on two lines.
- At 840px and 1280px, the Chinese hero, slogan, introduction, buttons, and first feature positions and sizes match the official pre-change page exactly.
- No warning or error logs in the local preview during these checks.

This is browser viewport validation of the built site, not a physical iPhone Safari test. Extension tests and the speech playback tests were not rerun because this change only adds responsive hero markup and styling.

## Evidence

- [Layout geometry](geometry.json)
- [Chinese phone layout](zh-mobile.png)
- [English phone layout](en-mobile.png)
- [Desktop before](desktop-before.png)
- [Desktop after](desktop-after.png)

The design uses FluentRead's existing brand asset and homepage layout. No reference repository was modified or copied for this change.
