---
title: Design system & component previews
description: Explore FluentRead colors, typography and real Vue components across themes, skins and screen sizes.
---

# Design system & component previews

FluentRead uses Storybook to bring its visual guidelines and reusable interface components together. Browse colors and typography, interact with selects and switches, and compare light, dark and built-in skins.

<a class="bv-button bv-primary" href="/storybook/?path=/docs/foundations-colors--docs" target="_blank" rel="noopener noreferrer">Open the component explorer →</a>

## What you can explore

| Section | Contents |
| --- | --- |
| Overview | An introduction and instructions for the explorer |
| Foundations | Active theme colors, text contrast, typography, font stacks, radius and elevation |
| UI | Selects, feature switches, download progress, service icons, interface icons, translation loading indicators, basic controls and dialogs |
| Examples | Settings fragments composed from real components, including long labels and narrow layouts |

Colors come from the CSS variables used by FluentRead. Previews import the extension's actual Vue components. Changes to shared components and styles rebuild the explorer alongside the documentation.

## How to use it

1. Select a section or component in the sidebar and open its documentation or an individual story.
2. Use the toolbar to switch themes, skins or the language of built-in component messages. Story descriptions and text supplied as demo props retain their original language.
3. Change component parameters in the story's **Controls** panel, such as disabled states, icon sizes or progress data.
4. Switch the viewport to Popup, Mobile or Desktop to inspect wrapping and layout.
5. Click, search or use the keyboard to inspect interactions and focus states.

Preview data is for demonstration only. The explorer does not read or change your extension settings, call translation providers, or download models or fonts. The typography page lists available font stacks; fonts that are not installed fall back to system fonts. The explorer covers components and composed fragments. Use the extension to experience complete features.

## Contributing to the interface

Install dependencies and start the explorer from the FluentRead repository root:

```sh
pnpm install --frozen-lockfile
pnpm storybook
```

Open the local address shown in the terminal, usually `http://127.0.0.1:6006`. Stories live in `storybook/` and configuration lives in `.storybook/`. Import components from `src/ui/components/` and shared styles from `src/ui/styles/`. Include relevant default, disabled, long-label and narrow-screen states.

```sh
pnpm storybook:typecheck
pnpm docs:build:site
pnpm storybook:check
pnpm docs:check
pnpm docs:preview
```

`docs:build:site` builds the documentation, then writes Storybook into its `storybook/` subtree. Open the explorer through the local documentation to preview the complete site. GitHub Pages publishes both from the same artifact, without requiring another subdomain.

## References

The organization was inspired by [Read Frog's Storybook](https://storybook.readfrog.app/?path=/docs/foundations-colors--docs): foundations first, followed by components and their states. FluentRead's stories, style integration and documentation use its own Vue, Element Plus and Vite architecture.

Learn more about the tool in the [Storybook Vue and Vite documentation](https://storybook.js.org/docs/8/get-started/frameworks/vue3-vite).
