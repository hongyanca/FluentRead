# White website and automatic demonstrations

The hero now focuses on the brand and installation. The webpage demonstration appears in a separate section below three browser installation cards. Homepage and documentation backgrounds, navigation, tables and illustration stages use white; light appearance is enforced.

Webpage, sentence analysis and guide illustrations start automatically when visible. A measured curved cursor path ends at the illustrated action, followed by a click pulse and the result. Numbered demo controls were removed. Webpage translation begins after 1.2 seconds; guide results appear after 1.7 seconds. Results remain visible longer than the action. Timelines are local examples and do not call translation providers.

Pause stops both playback and pointer motion. Offscreen examples stop their timers. Reduced-motion preferences use the final static state and suppress the cursor; this was reviewed in source, not by changing an OS preference. Replay restarts its timeline. Compact stages reserve space for original and translated content.

## Validation

- Website typecheck, production build and link/asset checks passed: 75 pages, 3778 links, 714 anchors, 171 image references.
- Codex in-app browser inspected Chinese and English pages at 320, 390, 768 and 1280 pixel widths. No horizontal overflow in sampled homepages and selection, image, document and input guides.
- Original and translated input states fit the compact stage at 320 pixels; selection result fits its white stage.
- Automatic pointer travel, automatic translated results, offscreen timer suspension and pause behavior were observed. Browser records are in browser-summary.json.
- No browser console errors were captured. No extension regression suite or live translation service test was run for this website-only change.

## Screenshots

- home-white.png: centered hero and browser installation cards.
- docs-white.png: white selection guide after its automatic result appears.
- docs-mobile.png: selection guide at 320 pixels.
