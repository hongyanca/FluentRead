# Restore the PR #786 homepage and show the hero icon on desktop

The user requested the homepage as merged in PR #786 (`d1bc548c56cee44fea71fc2a29c5bf5611b09f7f`), then requested the desktop hero icon above the slogan as on mobile.

## Implementation

- Restored `homepage.css` from that exact merge commit, removing the later mobile greeting placement, tint, rotation and frame changes.
- Promoted the existing 64 × 64 icon to a shared hero rule, with the same centered alignment and 24px bottom gap at all screen widths.
- Renamed its class to `bv-hero-icon`; explicit markup dimensions reserve its layout space.
- The theme diff against #786 contains only this shared icon change. The greeting markup, wording, demos and mobile hero geometry are unchanged from #786. Other repository changes remain intact.

## Validation

- `pnpm exec wxt prepare`: passed (fresh worktree type setup).
- `pnpm docs:typecheck`: passed.
- `pnpm docs:build`: passed.
- `pnpm docs:check`: passed; 75 pages, 3758 links, 722 anchors and 112 images.
- `git diff --check`: passed.
- Chinese browser viewports: 320, 390, 760, 840, 1100, 1280 and 1440px.
- English browser viewports: 320, 390 and 1280px.
- At every viewport the loaded icon was 64 × 64px, its center matched the slogan center exactly, the gap was 24px and horizontal overflow was zero.
- Ten scattered greetings remained; no language ribbon was present. Mobile greetings intentionally follow #786, including its original edge placements.
- Repeated English desktop geometry matched; no new animation or layout-changing state was added. Browser warning/error logs were empty.
- Browser: background Codex in-app browser, temporary viewport overrides; no user tab interactions. This is responsive browser validation, not a physical phone/Safari test.

Screenshots: [Chinese desktop](desktop.png), [Chinese mobile](mobile.png), [English desktop](en-desktop.png). Measurements: [JSON](measurements.json).
