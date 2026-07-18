# Nebulous — Style Reference
> A living constellation, not a landing page — deep space that reacts when you touch it

**Theme:** dark

nebulous.world isn't a marketing site with a nebula picture behind the headline — it's a control room for a living network: apps, tags, votes, and stake pull toward and away from each other in real time, force-directed maps drift and settle, reward accumulators tick upward, and every stat on screen is something a wallet actually did a moment ago. The previous pass at this doc borrowed a generic dev-tool-marketing-site language (Astro's own reference site) wholesale — pill CTAs and a static hero glow — and left it there. That's wrong for what this product is: the void should feel deeper and more electric, contrast should be pushed harder so dense data (stake amounts, reward deltas, force-graph labels) stays legible at a glance, and the UI chrome around the data (buttons, cards, nav) should carry a fraction of the same "alive" quality the constellation maps already have, instead of sitting there inert while only the canvases move. Components stay geometric and confident — pill-shaped interactive controls at 9999px radius, 16px cards, 8px chips, hairline borders — but the void itself is darker and more absolute, the signature nebula gradient and its accent colors read more saturated against it, and everything you can touch now visibly *responds*: a lift and a colored glow on hover, a spring-eased settle instead of a flat linear fade, a live pulse on anything actively accruing (rewards, a connected wallet, an in-progress transaction).

## Tokens — Colors

| Name            | Value                                                            | Token                     | Role                                                                                                                                                                                                        |
| ---------------- | ---------------------------------------------------------------- | ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Void Canvas     | `#10121a`                                                        | `--color-void-canvas`     | Primary page background — deepened from the previous pass's `#1f232e` toward true near-black so text, borders, and every accent color read at meaningfully higher contrast. Still a hair of cool blue, never flat black, so elements feel like they're floating in space rather than printed on paper |
| Carbon          | `#0d0f16`                                                        | `--color-carbon`          | Card and panel surface, one step darker than canvas. Cards read as recessed instrument panels (a hairline border + a shade darker), not elevated tiles — no drop shadows anywhere in this system            |
| Abyss           | `#080911`                                                        | `--color-abyss`           | Deeper inset wells: nested containers, decorative backdrops behind data canvases (see `NebulaField`/`ConstellationField`)                                                                                    |
| Singularity     | `#040509`                                                        | `--color-singularity`     | Darkest surface for terminal-style boxes and maximum-contrast containers. Effectively black with a whisper of blue                                                                                          |
| Lunar White     | `#f2f6fa`                                                        | `--color-lunar-white`     | Primary text and high-contrast foreground. Unchanged — it was already doing its job; the darker canvas beneath it is what pushes the contrast ratio up                                                     |
| Platinum        | `#e5e7eb`                                                        | `--color-platinum`        | Secondary text, icon strokes, light dividers                                                                                                                                                                 |
| Mist            | `#bfc1c9`                                                        | `--color-mist`            | Supporting neutral for secondary UI and muted labels. Not the primary CTA color                                                                                                                             |
| Steel           | `#9aa0ac`                                                        | `--color-steel`           | Muted body text and subdued descriptions — lightened from `#858b98` (a borderline-AA 4.2:1 against the old canvas) so paragraph copy and stat captions stay comfortably legible against the deeper void   |
| Gunmetal        | `#666c7a`                                                        | `--color-gunmetal`        | Hairline borders and dividers — lightened from `#545864` so structure reads crisply against the darker canvas without becoming a loud divider; still subordinate to content, never decorative              |
| Nebula Gradient | `linear-gradient(83.21deg, rgb(47, 61, 255), rgb(201, 63, 242))` | `--color-nebula-gradient` | The signature gradient — origin of the hero glow, the constellation maps' edge/node tint, and the accent on live/active states. Pushed slightly more saturated at both stops than the previous pass          |
| Plasma Gradient | `linear-gradient(66.77deg, rgb(255, 59, 59), rgb(255, 53, 250))` | `--color-plasma-gradient` | Secondary gradient (red-to-magenta), used sparingly for decorative energy bands and error/urgent accents                                                                                                     |
| Aurora Mint     | `#2ef7c6`                                                        | `--color-aurora-mint`     | Teal accent — success states, positive deltas (reward accrued, stake gained), trend-line fills                                                                                                              |
| Plasma Blue     | `#3aa8ff`                                                        | `--color-plasma-blue`     | Primary interactive blue — links, node fills on the force-directed maps, focus rings, the connect-wallet button                                                                                             |
| Ultraviolet     | `#9a9dff`                                                        | `--color-ultraviolet`     | Selection/hover ring color, code keywords, violet link variant                                                                                                                                                |
| Electric Cyan   | `#00daef`                                                        | `--color-electric-cyan`   | Secondary syntax/data token — reserved for specific data-visualization contexts and rare accent strokes                                                                                                      |
| Amber           | `#ffc670`                                                        | `--color-amber`           | Warning/pending accent — unclaimed rewards, decaying unstake-fee indicators                                                                                                                                  |
| Signal Blue     | `#61dafb`                                                        | `--color-signal-blue`     | Decorative dot/badge accent, live-status pulses (see Motion)                                                                                                                                                 |

## Tokens — Typography

Unchanged from the previous pass — the type system was never the problem. Obviously at weight 300-400 for headlines, ui-sans-serif for body/UI, ui-monospace for on-chain amounts and addresses, MDIO for small instrument-panel-style labels.

### ui-sans-serif — Body and UI text — system stack fallback. Weight 400 for body copy, 500/600 for button labels and nav, 700 for subheadings. Line-height 1.65 at 14px keeps dense UI readable without feeling airy. · `--font-ui-sans-serif`
- **Substitute:** Inter, system-ui
- **Weights:** 300, 400, 500, 600, 700
- **Sizes:** 14px, 16px, 20px
- **Line height:** 1.40, 1.50, 1.65, 1.81
- **Letter spacing:** normal
- **OpenType features:** `"calt", "zero"`

### Obviously — Display and headline face — the custom workhorse. Weight 300/400 used for the largest headlines, 700 for the hero. The cv09 and salt alternates give it a distinctive wide, slightly retro character. · `--font-obviously`
- **Substitute:** Space Grotesk, Inter
- **Weights:** 300, 400, 700
- **Sizes:** 20px, 30px, 36px, 48px
- **Line height:** 1.10, 1.11, 1.20, 1.40
- **OpenType features:** `"calt", "cv09", "liga", "salt", "ss06", "ss11"`

### ui-monospace — On-chain amounts, wallet addresses, code blocks. Fixed 14px, tabular numerals mandatory (see Motion/Do's) so a ticking reward figure never reflows its neighbors. · `--font-ui-monospace`
- **Substitute:** JetBrains Mono, Fira Code
- **Weights:** 300, 400
- **Sizes:** 14px
- **Line height:** 1.65
- **OpenType features:** `"calt", "zero"`

### MDIO — Icon and badge face — used at 12-16px with widened tracking (0.0250em) for small labels, version chips, and stat captions. · `--font-mdio`
- **Substitute:** Space Mono, IBM Plex Mono
- **Weights:** 300, 400
- **Sizes:** 12px, 16px
- **Letter spacing:** 0.0250em
- **OpenType features:** `"calt", "zero"`

### Type Scale

| Role       | Size | Line Height | Letter Spacing | Token               |
| ---------- | ---- | ----------- | -------------- | -------------------- |
| caption    | 12px | 1.5         | 0.3px          | `--text-caption`     |
| body-sm    | 14px | 1.65        | —              | `--text-body-sm`     |
| body       | 16px | 1.5         | —              | `--text-body`        |
| subheading | 20px | 1.4         | —              | `--text-subheading`  |
| heading-sm | 30px | 1.2         | —              | `--text-heading-sm`  |
| heading    | 36px | 1.11        | —              | `--text-heading`     |
| display    | 48px | 1.1         | —              | `--text-display`     |

## Tokens — Spacing & Shapes

**Base unit:** 4px · **Density:** comfortable — unchanged, the layout rhythm wasn't the problem.

### Border Radius

| Element | Value  |
| ------- | ------ |
| nav     | 8px    |
| cards   | 16px   |
| chips   | 9999px |
| images  | 12px   |
| buttons | 9999px |

## Tokens — Motion

New section — the previous pass documented zero motion tokens despite the product's data canvases (`ForceMap`, `GroupMap`, `NebulaField`) already being genuinely dynamic. This formalizes that language and extends it to the static UI chrome around them, which used to just sit there.

| Name            | Value                                | Token                | Role                                                                                                                                                            |
| ---------------- | ------------------------------------- | --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Spring           | `cubic-bezier(0.34, 1.56, 0.64, 1)`   | `--ease-spring`       | The signature "reactive" easing — a slight overshoot on settle. Used for hover/press feedback on buttons, cards, and chips: a lift or scale that springs into place rather than a flat linear ease |
| Smooth Decel     | `cubic-bezier(0.16, 1, 0.3, 1)`       | `--ease-out-smooth`   | Larger, non-bouncy movements — panel/modal entrances, tab-content swaps                                                                                          |
| Fast             | `150ms`                               | `--duration-fast`     | Hover/press feedback — must feel instant                                                                                                                        |
| Base             | `250ms`                               | `--duration-base`     | Content entering/leaving (fades, tab swaps)                                                                                                                     |
| Slow             | `480ms`                               | `--duration-slow`     | Camera-style movements — map pan/zoom, the constellation click-to-zoom transition                                                                               |

### Reactive glow (hover/focus feedback, not elevation)

A colored ambient glow on hover/focus — distinct from a generic elevation shadow (this system still has none of those; see Do's/Don'ts). It's feedback that something is *live* and responding to you, tinted to whatever accent that element already carries.

| Name          | Value                                                                    | Token             |
| -------------- | ------------------------------------------------------------------------- | ------------------- |
| Glow Plasma   | `0 0 0 1px rgba(58, 168, 255, 0.4), 0 0 24px rgba(58, 168, 255, 0.25)`   | `--glow-plasma`   |
| Glow Nebula   | `0 0 0 1px rgba(154, 157, 255, 0.4), 0 0 24px rgba(184, 69, 237, 0.25)` | `--glow-nebula`   |
| Glow Mint     | `0 0 0 1px rgba(46, 247, 198, 0.4), 0 0 24px rgba(46, 247, 198, 0.2)`   | `--glow-mint`     |

### Live-state pulse

A slow breathing opacity/scale pulse (already shipped once, on `ToastGlow` — now a named, reusable token) for anything actively accruing or in-flight: a connected wallet's status dot, an unclaimed-reward badge, a pending-transaction indicator.

```css
@keyframes pulse-live {
  0%, 100% { opacity: 0.55; transform: scale(0.92); }
  50%      { opacity: 1;    transform: scale(1.08); }
}
```

## Components

### Primary Pill Button
**Role:** Main call-to-action (connect wallet, submit vote/stake)

Full pill shape at 9999px radius, background Lunar White, text Void Canvas at 16px weight 600, padding 12px 24px. High-contrast inverted style — no border. On hover: lifts 1px (`translateY(-1px)`) and gains `--glow-plasma`, both eased with `--ease-spring` over `--duration-fast`. On press: `scale(0.96)` (never lower — anything below reads exaggerated).

### Data Card (App Card / Metric Tile)
**Role:** The base unit of every grid in the product — app cards on Discover, metric tiles on Explore, theme-style preview tiles

16px radius, Carbon background, 1px hairline border. No shadow at rest. On hover: border brightens to Plasma Blue at 40% opacity and the card gains `--glow-plasma` plus a 2px lift, both on `--ease-spring`/`--duration-fast` — the same reactive language as the button, so "this is touchable" reads consistently everywhere. Numeric fields (stake amounts, vote weight, rank score) are always `tabular-nums` so a live update never reflows the layout around it.

### Tag / Filter Chip
**Role:** Tag chips on app cards, filter pills on Discover/Explore, the active-tab indicator

9999px radius, two states: active = Plasma Blue border + 15% fill + Plasma Blue text; inactive = hairline border + Steel text. Press feedback: `scale(0.96)` on `--ease-spring`. An active chip carrying live stake data gets a small `pulse-live` dot rather than a static number alone, so "this tag has stake actively behind it" reads at a glance.

### Constellation / Force-Directed Map
**Role:** The product's signature visual — `ForceMap` (apps/tags), `GroupMap` (circle-packing), and the decorative `NebulaField`/`ConstellationField` shader backdrops

Deep-space canvas (Abyss/Singularity), nodes tinted along the Nebula Gradient by depth/type, edges tapered thicker near their endpoint nodes. Fully reactive: drag to pan, scroll/pinch or +/−/reset buttons to zoom, click a node to zoom in and select it — camera movements use `--duration-slow`/`--ease-out-smooth`, not a snap-cut. This is the reference implementation for "dynamic" in this system; new interactive surfaces should feel like a scaled-down version of this, not the other way around.

### Live Reward / Stat Ticker
**Role:** `MetricTrendCard`'s headline figure, `ClaimRewards`' pending-amount column, any accumulator-driven number

Always `tabular-nums`. A value that just changed (a claim landed, a vote posted) gets a one-shot 250ms color flash from Aurora Mint (gain) or Amber (pending/decaying) back to Lunar White, on `--ease-out-smooth` — a lightweight, non-intrusive way to say "this number is real and just moved" without a full toast for every tick.

### Navigation Bar
**Role:** Top-level site navigation

Sticky, translucent (`backdrop-blur-md` over Void Canvas at 75% opacity), hairline bottom border. The active route's pill background transitions on `--ease-spring` rather than snapping, and carries a small `pulse-live` dot when the page has something actively updating (an open position, a pending claim) — a live-status indicator, not just a highlighted label.

## Do's and Don'ts

### Do
- Use 9999px radius for all interactive elements (buttons, tabs, badges, chips)
- Keep the primary CTA inverted (Lunar White background, Void Canvas text) — the signature action pattern, unchanged
- Use the Nebula Gradient for hero atmospheric backdrops, constellation map node/edge tinting, and live/active accents — never as a large flat fill or button background
- Give every hover-capable surface (buttons, cards, chips) the same reactive language: a 1-2px lift + a tinted `--glow-*` shadow + `scale(0.96)` on press, all on `--ease-spring`/`--duration-fast` — consistency here is what makes the whole UI read as "alive," not just the canvases
- Use `tabular-nums` on every number that can change at runtime (stake, rewards, rank score, vote weight) — a reflowing digit reads as broken, not dynamic
- Reserve `pulse-live` for things that are genuinely live/accruing right now — a connected wallet, an unclaimed reward, an in-flight transaction. Applying it to static content cheapens the signal
- Maintain 4px base unit for all spacing; camera-style map movements use `--duration-slow` (480ms), UI feedback uses `--duration-fast` (150ms) — don't blur the two

### Don't
- Don't use drop shadows for elevation at rest — depth still comes from a 1px hairline border and a surface one shade darker than its parent. The new `--glow-*` tokens are interaction feedback, not an elevation system, and only ever appear on hover/focus/active
- Don't apply the Nebula Gradient to body text — it destroys legibility against the dark canvas
- Don't use chromatic colors for large background fills — they break the void atmosphere that makes the accent colors read as accents
- Don't set body text below 14px or above 18px
- Don't use Obviously above weight 700 for headlines
- Don't add a `pulse-live` or glow treatment to anything that isn't actually live — reactive motion is a promise about the data, not a decoration
- Don't animate camera/map movements (pan, zoom, click-to-focus) faster than `--duration-base` (250ms) — a snap-cut reads as a bug, not speed

## Surfaces

| Level | Name        | Value     | Purpose                                               |
| ----- | ----------- | --------- | ------------------------------------------------------ |
| 1     | Void Canvas | `#10121a` | Page background — the deep space floor                 |
| 2     | Carbon      | `#0d0f16` | Card and panel surfaces                                 |
| 3     | Abyss       | `#080911` | Inset wells, decorative canvas backdrops                |
| 4     | Singularity | `#040509` | Deepest surface for maximum-contrast containers         |

## Imagery

No photographic content anywhere in the product. The hero and map backdrops are procedural WebGL2 shaders (`NebulaField`, `ConstellationField`) — a domain-warped nebula wash, tinted along the brand gradient, with no image assets. App icons (user-submitted) are the only bitmap imagery in the product and always get a subtle white-outline-at-10%-opacity treatment (never a shadow) so they read consistently against the dark canvas regardless of their own color. Decorative iconography is flat, single-color, geometric — no gradients or 3D renders on icons themselves; the Nebula Gradient is reserved for backdrops and live-state accents only.

## Layout

Full-width dark canvas, content constrained to a 1200-1280px max-width depending on page density (grids get more room than prose pages). Data-dense pages (Discover, Explore) use full-width grids with 16-24px gaps; the About page is the one prose-first, centered-column page in the product and is where the scroll-driven reveal animations live. Vertical rhythm: 80px between major sections on marketing-style pages (About, Rewards), tighter 16-24px stacks on data pages where density matters more than breathing room.

## Similar Brands

- **Uniswap / dashboard-style DeFi products** — dark canvas, live numeric tickers, reactive card hover states over static marketing chrome
- **Linear** — near-black background, hairline-border elevation strategy, geometric sans-serif headlines
- **Obsidian's graph view / any force-directed graph tool** — the constellation maps' actual interaction model (drag, zoom, click-to-focus a node)

## Quick Start

### CSS Custom Properties

```css
:root {
  /* Colors */
  --color-void-canvas: #10121a;
  --color-carbon: #0d0f16;
  --color-abyss: #080911;
  --color-singularity: #040509;
  --color-lunar-white: #f2f6fa;
  --color-platinum: #e5e7eb;
  --color-mist: #bfc1c9;
  --color-steel: #9aa0ac;
  --color-gunmetal: #666c7a;
  --gradient-nebula-gradient: linear-gradient(83.21deg, rgb(47, 61, 255), rgb(201, 63, 242));
  --gradient-plasma-gradient: linear-gradient(66.77deg, rgb(255, 59, 59), rgb(255, 53, 250));
  --color-aurora-mint: #2ef7c6;
  --color-plasma-blue: #3aa8ff;
  --color-ultraviolet: #9a9dff;
  --color-electric-cyan: #00daef;
  --color-amber: #ffc670;
  --color-signal-blue: #61dafb;

  /* Motion */
  --ease-spring: cubic-bezier(0.34, 1.56, 0.64, 1);
  --ease-out-smooth: cubic-bezier(0.16, 1, 0.3, 1);
  --duration-fast: 150ms;
  --duration-base: 250ms;
  --duration-slow: 480ms;
  --glow-plasma: 0 0 0 1px rgba(58, 168, 255, 0.4), 0 0 24px rgba(58, 168, 255, 0.25);
  --glow-nebula: 0 0 0 1px rgba(154, 157, 255, 0.4), 0 0 24px rgba(184, 69, 237, 0.25);
  --glow-mint: 0 0 0 1px rgba(46, 247, 198, 0.4), 0 0 24px rgba(46, 247, 198, 0.2);

  /* Typography — Font Families */
  --font-ui-sans-serif: 'ui-sans-serif', ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  --font-obviously: 'Obviously', ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  --font-ui-monospace: 'ui-monospace', ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  --font-mdio: 'MDIO', ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;

  /* Typography — Scale */
  --text-caption: 12px; --leading-caption: 1.5; --tracking-caption: 0.3px;
  --text-body-sm: 14px; --leading-body-sm: 1.65;
  --text-body: 16px; --leading-body: 1.5;
  --text-subheading: 20px; --leading-subheading: 1.4;
  --text-heading-sm: 30px; --leading-heading-sm: 1.2;
  --text-heading: 36px; --leading-heading: 1.11;
  --text-display: 48px; --leading-display: 1.1;

  /* Spacing */
  --spacing-unit: 4px;
  --spacing-4: 4px; --spacing-8: 8px; --spacing-12: 12px; --spacing-16: 16px;
  --spacing-20: 20px; --spacing-24: 24px; --spacing-32: 32px; --spacing-40: 40px;
  --spacing-48: 48px; --spacing-68: 68px; --spacing-80: 80px; --spacing-144: 144px;
  --spacing-160: 160px; --spacing-224: 224px;

  /* Border Radius */
  --radius-nav: 8px;
  --radius-cards: 16px;
  --radius-chips: 9999px;
  --radius-images: 12px;
  --radius-buttons: 9999px;
}
```

### Tailwind v4

```css
@theme {
  --color-void-canvas: #10121a;
  --color-carbon: #0d0f16;
  --color-abyss: #080911;
  --color-singularity: #040509;
  --color-lunar-white: #f2f6fa;
  --color-platinum: #e5e7eb;
  --color-mist: #bfc1c9;
  --color-steel: #9aa0ac;
  --color-gunmetal: #666c7a;
  --color-aurora-mint: #2ef7c6;
  --color-plasma-blue: #3aa8ff;
  --color-ultraviolet: #9a9dff;
  --color-electric-cyan: #00daef;
  --color-amber: #ffc670;
  --color-signal-blue: #61dafb;

  --ease-spring: cubic-bezier(0.34, 1.56, 0.64, 1);
  --ease-out-smooth: cubic-bezier(0.16, 1, 0.3, 1);

  --font-ui-sans-serif: 'ui-sans-serif', ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  --font-obviously: 'Obviously', ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  --font-ui-monospace: 'ui-monospace', ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  --font-mdio: 'MDIO', ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;

  --text-caption: 12px; --leading-caption: 1.5; --tracking-caption: 0.3px;
  --text-body-sm: 14px; --leading-body-sm: 1.65;
  --text-body: 16px; --leading-body: 1.5;
  --text-subheading: 20px; --leading-subheading: 1.4;
  --text-heading-sm: 30px; --leading-heading-sm: 1.2;
  --text-heading: 36px; --leading-heading: 1.11;
  --text-display: 48px; --leading-display: 1.1;

  --spacing-4: 4px; --spacing-8: 8px; --spacing-12: 12px; --spacing-16: 16px;
  --spacing-20: 20px; --spacing-24: 24px; --spacing-32: 32px; --spacing-40: 40px;
  --spacing-48: 48px; --spacing-68: 68px; --spacing-80: 80px; --spacing-144: 144px;
  --spacing-160: 160px; --spacing-224: 224px;

  --radius-nav: 8px;
  --radius-cards: 16px;
  --radius-chips: 9999px;
  --radius-images: 12px;
  --radius-buttons: 9999px;
}
```
