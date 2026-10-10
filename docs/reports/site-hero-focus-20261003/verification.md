# Focused marketing homepage

The previous hero repeated a large brand lockup, slogan, install links and three browser cards. Those competing blocks obscured the product's reading order. The new homepage uses a dedicated Vue layout with a compact navigation bar, one large two-line headline, a short explanation of the supported content, and one primary installation action. Edge and Firefox are available in a native disclosure menu beside Chrome. The full automatic translation demonstration follows directly below.

Reference: https://www.readfrog.app/zh. Its central headline, nearby installation actions and peripheral content illustrations informed the hierarchy. The components and SVG illustrations were independently implemented in FluentRead's Vue/VitePress stack. No reference repository was modified and no code or artwork was copied. The shared brand tagline remains the source of the headline.

White page backgrounds remain in place. Small content illustrations move gently outside the main reading column and pause when offscreen or when the document is hidden. They are hidden from assistive technology and from narrow viewports. Reduced motion suppresses these animations in source. The detailed product demonstrations retain their automatic playback and pause controls.

## Verification

- Website typecheck, production build, and the existing 75-page link/asset checker pass.
- In-app browser checks covered Chinese and English at 320, 390, 768, 1024, 1280 and 1920 pixels. Sampled pages had no horizontal overflow.
- Edge, Firefox and installation-guide targets are accessible through the browser menu. Escape closes it and returns focus; clicking outside also closes it. At 320 pixels the final menu is contained between x=39 and x=281.
- English headline remains two lines at 320 pixels.
- Client navigation from homepage to documentation and back uses the correct layout; documentation retains its search, sidebar, white surfaces and language-preserving link.
- Translation results appear automatically, and hero illustration animations suspend when offscreen.
- No console errors were captured. Browser details are in browser-summary.json. OS reduced-motion settings, real store installation and live translation providers were not exercised.

The change affects the public website layout. Extension regression suites were not run for this scope.
