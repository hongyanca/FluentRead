# Keep hero greetings clear of floating cards

The desktop Japanese and Russian greetings overlapped the right grammar card, and the German greeting touched the left webpage card. Move these three greetings into upper whitespace without changing the cards, central hero, mobile positions or animation.

## Validation

- WXT preparation, docs typecheck, production build, docs link/asset checks and diff checks passed. Docs checker: 75 pages, 3758 links, 722 anchors and 112 images.
- Checked Chinese and English at 320, 390, 760, 1100, 1101, 1279, 1280, 1440 and 1920px in a background in-app browser with temporary viewport overrides. All ten greetings remain; no horizontal overflow.
- Desktop checks compare all 30 greeting/card pairs. Their conservative bounds cover the full -6px to 0px vertical animation range independently, including each card's rotated bounding rectangle. The minimum gap is 33.83px; no pair is within 24px.
- Cards remain hidden at widths up to 1100px. Their existing styles and the narrow-screen greeting overrides are unchanged.
- At 1280px, the icon, slogan, introduction and installation-button rectangles match production before this change exactly.
- Browser warning/error logs were empty. These are browser viewport checks, not physical phone verification. No extension behavior changed and no full regression suite was run.

[Desktop screenshot](desktop.png) · [Mobile screenshot](mobile.png) · [Narrow English desktop](en-1101.png) · [Measurements](measurements.json)
