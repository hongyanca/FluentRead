# Restore scattered greetings, then refine their mobile presentation

First restored the two homepage files to their versions before the language ribbon in #790. Restoration PR #791 was merged as `63e91a85da74bff71fc0b45b35bcf0801f1b5109`; deployment run `37167828526` succeeded, and the official page was checked to contain the original ten scattered greetings and no ribbon before this refinement began.

The follow-up keeps that original presentation and changes only mobile CSS at widths up to 760px. The ten plain greeting words use varied small sizes, subtle rotations and soft colors instead of a uniform gray pattern. They sit around the icon and in the hero's bottom whitespace, clear of the heading, introduction and install buttons. There is no language strip, capsule container, extra row, or new greeting animation. Desktop styling is unchanged.

## Validation

- Docs typecheck, production build, link/asset validation and `git diff --check`: passed.
- Chinese browser widths: 320, 390, 430, 640, 760 and 1280. English widths: 320 and 390.
- All ten greetings remain visible at the checked narrow widths. Their transformed bounding boxes stay within the hero and do not intersect the brand icon, heading, introduction or install-action boxes.
- No horizontal page overflow at the checked narrow widths.
- Chinese 390px hero/icon/heading/introduction/button geometry and the first feature position match the restored production layout exactly.
- Chinese 1280px hero geometry and all ten desktop greeting positions/sizes match the restored production layout exactly.
- No warning or error logs observed in the local preview.

Browser validation used the built site in the background with temporary viewport overrides, not a physical iPhone Safari. No reference project was used or modified. Extension and speech behavior are outside this CSS-only change and were not retested.

## Evidence

- [Restored original mobile presentation](restored-mobile.png)
- [Refined mobile presentation](refined-mobile.png)
- [English mobile presentation](refined-en-mobile.png)
- [Desktop presentation](refined-desktop.png)
- [Layout measurements](measurements.json)
