# Mobile homepage greetings without a watermark pattern

On narrow screens the ten greetings were scattered behind the slogan, copy and installation buttons, with several words clipped at the viewport edges. At widths up to 760px they now appear in a single 30px decorative language ribbon above the existing icon. Three centered groups fade between the ten greetings over an 18-second cycle. The solid, subtle background separates this decoration from the page content, and every word fits completely inside the ribbon.

The ribbon is absolutely positioned and only animates opacity. It reserves no additional document-flow space. The existing icon, slogan, introduction and buttons retain their positions. The scattered greetings and background rules are hidden only at the narrow breakpoint; the desktop presentation remains unchanged. The greetings retain their language attributes and Arabic direction, and all decoration remains hidden from assistive technology. The reduced-motion media rule disables the fade and shows the first group statically.

## Validation

- `pnpm docs:typecheck`, `pnpm docs:build`, `pnpm docs:check`, and `git diff --check`: passed.
- Built-site integrity: 75 pages, 3754 links, 718 anchors, 112 images.
- Chinese browser widths: 320, 390, 430, 640, 760, 761, 1280. English widths: 320 and 390.
- At every checked narrow width all ten greeting elements are retained, every word fits inside the ribbon, the scattered background words are hidden, and horizontal overflow is zero.
- The 390px Chinese hero, icon, heading, introduction, buttons and first feature geometry match the official pre-change layout.
- The 1280px hero geometry and all ten desktop greeting positions/sizes match the official pre-change layout exactly. At 761px the ribbon is hidden and the original greetings remain visible.
- Observed all three groups becoming visible during the fade cycle; subsequent geometry samples remain identical while the animation runs.
- No warning or error logs were observed in the local preview.

Validation used the built site in a background browser with temporary viewport overrides. It was not a physical iPhone Safari test. Reduced-motion behavior was checked in the CSS source, without changing the user's operating-system preference. Extension or speech playback tests were not rerun because they are outside this decorative homepage change.

## Evidence

- [Phone layout in Chinese](zh-mobile.png)
- [Phone layout in English](en-mobile.png)
- [Desktop before](desktop-before.png)
- [Desktop after](desktop-after.png)
- [Layout and animation measurements](layout.json)

This design uses FluentRead's existing language greetings and brand presentation. No reference repository or third-party design code was used.
