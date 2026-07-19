# Nebulous — Style Reference
> A live leaderboard, not a control room — a clean, data-forward dashboard for a network that's actually transparent

**Theme:** light

nebulous.world is a crowd-sourced app directory: apps, tags, votes, and stake are real on-chain activity, and the job of the UI is to make that activity legible at a glance — not to dress it up as a sci-fi visualization. The previous pass at this doc described a dark "living constellation" system (deep-void canvas, nebula gradients, glow-on-hover, spring-eased motion, force-directed maps as the signature visual). That direction wasn't serving the product: the atmosphere competed with the data instead of carrying it, the Discover/Explore split confused what page did what, core actions (vote, stake) were buried behind navigation into an app's detail page, and onboarding leaned entirely on a separate About page a new visitor might never open. This pass replaces all of that with a light, near-white dashboard in the Linear/Vercel/Stripe mold: real (subtle) elevation instead of glow, one restrained accent color instead of a gradient, tighter geometric radii instead of pills everywhere, and net-new UI — an inline quick-vote action on every app card, a dismissible onboarding banner, a sortable leaderboard — that puts the product's actual substance (transparent, stake-weighted rankings) in front of the visitor immediately. The constellation map still exists — it's a genuinely useful way to see how apps and tags connect — but it's now one optional tab inside Rankings, not the reason the product exists.

## Tokens — Colors

| Name           | Value     | Token                                  | Role                                                                                                                    |
| -------------- | --------- | --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Paper          | `#ffffff` | `--color-cream`                        | Page background                                                                                                          |
| Surface        | `#f7f7f8` | `--color-ivory`                        | Card and panel background — one step off white, the base `.card` surface                                                |
| Surface Raised | `#ffffff` | `--color-cream` (via `.card-interactive` hover) | Cards that need to stand out on hover — popovers, the custom-vote-amount picker — paired with the `shadow-hover` token |
| Well           | `#eef0f3` | `--color-mist`                         | Input backgrounds, nested panels. Also the value of `ink.graphite` — see Surfaces below                                 |
| Ink            | `#0d0e12` | `--color-ink`                          | Primary text, headings. Also the value of `ink.deep` — see Surfaces below                                               |
| Ink Muted      | `#565a66` | `--color-slate`                        | Secondary text, captions, labels                                                                                        |
| Ink Faint      | `#8a8f9c` | `--color-slate-steel`                  | Placeholder text, disabled state                                                                                        |
| Border         | `#e4e5e9` | `--color-hairline`                     | Hairline borders and dividers — the default `.card`/`.chip`/`.input` border                                             |
| Border Strong  | `#d1d3da` | `--color-powder` / `--color-faint`     | Emphasized borders — focused inputs, hovered secondary buttons                                                          |
| Indigo         | `#4338ca` | `--color-cobalt` (also `--color-violet`) | Primary accent — links, primary buttons, active nav pill, focus rings, chip-active state, icon-fallback badges         |
| Indigo Deep    | `#372fb0` | `--color-cobalt-deep`                  | Hover/pressed state of Indigo (primary button hover, wallet-connect button hover)                                       |
| Indigo Soft    | `#eef0fd` | `--color-indigo-soft`                  | Indigo tint for active/selected backgrounds — active nav pill, active chip, the onboarding banner                       |
| Positive       | `#15803d` | `--color-forest`                       | Gains, positive deltas, the connected-wallet status dot                                                                 |
| Warning        | `#b45309` | `--color-amber`                        | Pending/decaying states                                                                                                 |
| Negative       | `#b91c1c` | `--color-negative`                     | Losses, errors, negative deltas                                                                                         |

Two legacy token names still exist in `tailwind.config.ts` purely as carryovers from the dark-theme naming — don't reach for them in new work:
- **`cerulean`** (`#4338ca`, same as Indigo) — unused anywhere in the app.
- **`signal-blue`** (`#15803d` — a green, despite the name) — unused anywhere in the app. Deliberately left out of the table above rather than documented as a recommended token.

Semantic colors (Positive/Warning/Negative) are the only saturated colors at any real size (deltas, badges, status dots). Indigo is reserved for interactive/brand elements — it never appears as a large background fill. There is no gradient token in this system; the old Nebula/Plasma gradients were removed outright (`backgroundImage` in `tailwind.config.ts` is now an empty object).

## Tokens — Typography

One typeface for the whole app now, in place of the previous four-face stack. The "Obviously" display face and the "MDIO" instrument-panel label face are both gone — they existed to carry a sci-fi control-room feel that no longer applies. `font-display` still exists as a Tailwind class (so any lingering usage keeps working) but now resolves to the same Inter stack as body text — there is no second `--font-obviously` CSS variable any more.

### ui-sans-serif — Body, UI, and headings — the only face in the system. Weight 400 for body copy, 500/600 for button labels and nav, 600/700 for headings. Line-height 1.65 at 14px keeps dense UI readable without feeling airy. · `--font-ui-sans-serif`
- **Substitute:** Inter, system-ui
- **Weights:** 300, 400, 500, 600, 700
- **Sizes:** 12px, 14px, 16px, 20px, 30px, 36px, 48px (full type scale, see below)
- **Letter spacing:** normal (0.3px on 12px captions only)
- **OpenType features:** `"calt", "zero"`

### ui-monospace — On-chain amounts, wallet addresses, code blocks. Fixed 14px, tabular numerals mandatory (see Motion/Do's) so a leaderboard rank or a vote count never reflows its neighbors. Unchanged role from the previous system — the one place a distinct face still earns its keep functionally. · `--font-ui-monospace`
- **Substitute:** JetBrains Mono, Fira Code, SFMono-Regular
- **Weights:** 300, 400
- **Sizes:** 14px
- **Line height:** 1.65
- **OpenType features:** `"calt", "zero"`

### Type Scale

Unchanged sizes from the previous pass — the rhythm wasn't the problem, only the number of faces applying it.

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

Less rounding across the board than the old system — a data-dense dashboard reads more credible with tighter radii than the previous "everything is a pill" language. Borders stay 1px hairline throughout, both old and new.

| Element               | Old (pill system) | New    | Token             |
| ---------------------- | ------------------ | ------ | ------------------ |
| Buttons                | 9999px (pill)      | 8px    | `--radius-button`  |
| Cards                  | 16px                | 10px   | `--radius-card`    |
| Chips / tags           | 9999px (pill)       | 6px    | `--radius-pill`    |
| Nav active-state pill  | 9999px (pill)       | 6px    | `--radius-navitem` |
| Images / app icons     | 12px                | 8px    | `--radius-image`   |
| Icon avatars (48px sq) | 48px (unchanged)    | 48px   | `--radius-icon`    |

## Tokens — Motion

Drops the "alive/reactive" language from the previous pass almost entirely — no spring-overshoot easing, no ambient glow, no breathing pulses. A single flat `ease-out` curve at two durations carries essentially all of this system's motion.

| Name  | Value          | Token              | Role                                                                                   |
| ----- | -------------- | -------------------- | ----------------------------------------------------------------------------------------- |
| Flat  | `ease-out` (Tailwind's built-in cubic-bezier) | — (components use the built-in `ease-out` utility directly) | The only easing curve used anywhere — hover/press feedback, content transitions alike |
| Fast  | `150ms`         | `duration-150`       | Hover/press feedback: color, background, border, and shadow changes only — no transform-based lift or scale |
| Base  | `250ms`         | `duration-250`       | Content transitions: tab swaps, popovers entering/leaving                             |

`tailwind.config.ts` still defines two named timing-function tokens, `--ease-spring` and `--ease-out-smooth`, both set to the same flat `cubic-bezier(0, 0, 0.2, 1)` curve — kept as named continuity from the old system in case something references the class names, but nothing in the app actually does; every component applies Tailwind's built-in `ease-out` utility directly. Treat both as legacy no-ops, not a spring system in disguise.

### Elevation (replaces the old glow tokens)

Depth now comes from a real, subtle shadow, not a colored ambient glow — the glow tokens (`--glow-plasma`, `--glow-nebula`, `--glow-mint`) are gone outright.

| Name  | Value                                                              | Token           | Role                                                                 |
| ----- | -------------------------------------------------------------------- | ----------------- | ----------------------------------------------------------------------- |
| Rest  | `0 1px 2px rgba(13, 14, 18, 0.04), 0 1px 1px rgba(13, 14, 18, 0.03)` | `--shadow-rest`  | Default elevation for any raised surface (`.card`, primary/secondary buttons) |
| Hover | `0 4px 12px rgba(13, 14, 18, 0.08), 0 2px 4px rgba(13, 14, 18, 0.05)` | `--shadow-hover` | Interactive surfaces on hover (`.card-interactive`, buttons) — one step stronger, still subtle |

### Value-flash (the one motion carryover)

A one-shot color flash for a number that just changed (a vote landed, a claim confirmed) — the single piece of the old "reactive" motion language kept in the new system, in place of the old pulsing/breathing treatments.

```css
@keyframes value-flash {
  0%   { color: var(--flash-color, #15803d); }
  100% { color: inherit; }
}
```

`animate-value-flash` (`value-flash 0.6s ease-out`) is defined in `tailwind.config.ts` and ready to use, but as of this pass isn't yet wired into a live component — no `Stat`/vote-count/leaderboard-cell in the codebase currently applies it. Treat it as the documented, intended pattern for "this number just moved," not evidence it's already visible somewhere today.

## Components

### Primary Button
**Role:** Main call-to-action (connect wallet, submit vote/stake, "Vote" in the custom-amount popover)

Indigo fill (`bg-cobalt`), white text, 8px radius, 14px/600 weight, `12px 20px` padding (`.btn-primary` in `globals.css`). `shadow-rest` at rest. On hover: background darkens to Indigo Deep (`#372fb0`) and the shadow steps up to `shadow-hover`, both on `duration-150`/`ease-out` — a color and shadow change only, no lift or scale. On press: opacity dips to 80% — no scale/bounce. **Secondary buttons** (`.btn-secondary`): white background, `Border` outline, `Ink` text, same hover/press logic, border brightens to `Border Strong` on hover. **Ghost buttons** (`.btn-ghost`, e.g. the onboarding banner's "Got it"): no border/fill at rest, `Surface` background and `Ink` text on hover.

### App Card (Data Card)
**Role:** The base unit of the Browse grid and the ad slot — `AppCard`, `AdCard`

`Surface` background, 10px radius, 1px `Border` (`.card`). No shadow-raising, no lift, no glow at rest. On hover (`.card-interactive`): the card's own chrome (background, shadow) is a color/shadow-only change — background lifts to `Surface Raised` (white) and the shadow steps from `shadow-rest` to `shadow-hover`, on `duration-150 ease-out`. The card's hero image is the one deliberate exception to that "no transform" rule: `AppCard.tsx`/`AdCard.tsx` apply `transition-transform duration-300 group-hover:scale-[1.03]` to the image itself, a subtle zoom-in on hover, on its own 300ms duration — distinct from the 150ms the rest of the card's chrome uses. Numeric fields (rank score, stake, view count) are always `tabular-nums` so a live update never reflows the layout around it. App icons carry a thin `ring-1 ring-inset ring-white/10` — a carryover from the dark theme's icon-separation treatment that this pass didn't revisit; it reads as a faint inset highlight on the light card background today rather than a real outline.

The vote action lives directly on the card, not behind a click into the app's detail page — the concrete fix for "core actions buried" (see `CardVoteButton.tsx`). A compact pill button in the card's footer shows a small upvote icon plus the app's current vote weight (tabular-nums). **Quick vote:** one click casts a small predefined default amount (10 tokens) immediately — optimistic UI updates the count right away, the on-chain confirmation and `/api/vote` write happen in the background, with a rollback if either fails. A "•••" affordance next to it opens a lightweight popover with the same preset amounts as the full `VotePanel` (10/50/100/500) plus a custom input, for anyone who wants to stake something meaningful. One click for the common case, one click further for the power-user case.

### Tag / Filter Chip
**Role:** Tag chips on app cards, filter pills on Browse/Rankings, the active-tab indicator

6px radius (`.chip`), hairline `Border`, `Ink Muted` text at rest. Active state (`.chip-active`): `Indigo` border at 60% opacity, `Indigo Soft` fill, `Indigo` text. Press feedback: opacity dips to 80% — no scale. A chip carrying live stake shows the numeric stake amount inline (tabular-nums) rather than a pulsing dot — in a calmer light system, the number itself is the "this has activity" signal.

### Constellation / Force-Directed Map
**Role:** `ForceMap` (apps/tags) and `GroupMap` (circle-packing) — now a secondary lens, not the product's signature visual

Restyled for the light canvas: `Surface`-colored (`#f7f7f8`) canvas background, Indigo (`#4338ca`) node fills, a muted gray-blue (`#a5a8b8`, its own value — not the `Border Strong` token, which is a lighter `#d1d3da`) edge stroke, `Ink` labels, `Indigo Deep` (`#372fb0`) selection ring. Same interaction model as before — drag to pan, scroll/pinch or +/−/reset to zoom, click a node to zoom in and select it. It's demoted structurally, too: it now lives inside Rankings as the "Map view" tab (`RankingsTabs`), alongside — not instead of — the Leaderboard, which is the tab shown by default.

### Live Reward / Stat Ticker
**Role:** `MetricTrendCard`'s headline figure, `PlatformMetrics`' stat tiles, `ClaimRewards`' pending-amount column, leaderboard cells — any accumulator-driven number

Always `tabular-nums`. The intended treatment for a value that just changed (a claim landed, a vote posted) is the one-shot `value-flash` color animation (Positive green / Warning amber back to Ink) described under Motion above — a lightweight, non-intrusive way to say "this number is real and just moved," without a full toast for every tick.

### Navigation Bar
**Role:** Top-level site navigation — `Navbar.tsx`

Flat and opaque: white (`bg-cream`) background, `Border` bottom hairline, no blur or translucency — that only made sense over a moving/glowing dark canvas, and a flat white bar over a flat white page needs none of it. The active route gets an `Indigo Soft` background pill at 6px radius; there's no per-item live-pulse dot any more. A single connected-wallet status dot (a small solid `Positive`-colored circle) sits once, next to the Connect button, instead of being repeated on whichever nav item happens to be active.

### Rankings Tabs
**Role:** The tab bar atop the Rankings page — `RankingsTabs.tsx`

A two-item segmented control (`Leaderboard` / `Map view`) in a `Well`-colored (`bg-mist`) pill container; the active tab gets a white background and `shadow-rest`. Leaderboard is the default/first tab — the map is opt-in, not the page's reason for existing.

### Leaderboard
**Role:** Rankings' primary content — `Leaderboard.tsx`

A dense, sortable table: app (name + hostname), rank, vote weight, stake, views, and a 7-day trend delta, all `tabular-nums`. Column headers are clickable to sort (client-side, over the already-fetched top-N apps); the active sort column highlights in `Indigo`. Row hover uses the `Well` background (`hover:bg-mist`). Deltas render in `Positive`/`Negative` depending on sign. Same underlying data as the Browse grid, in a comparison-friendly tabular form suited to scanning many apps at once rather than browsing a few.

### Onboarding Banner
**Role:** A compact, dismissible first-visit explainer above the Browse grid — `OnboardingBanner.tsx`

`Indigo Soft` background, `Indigo`-tinted border (`border-cobalt/30`), 10px card radius. Three short lines side by side on wide viewports (what this is / how ranking works / how to participate), with a "Got it" ghost button that sets a `localStorage` flag and never shows the banner again for that visitor. Replaces relying on a separate About page as the only onboarding surface — a first-time visitor can understand and act without leaving the home page.

## Do's and Don'ts

### Do
- Use the tighter radius scale consistently: 8px buttons, 10px cards, 6px chips/nav-pills, 8px images — no more 9999px pills anywhere in the interactive-element system
- Keep the primary CTA solid Indigo with white text — the one accent, reserved for interactive/brand elements
- Use real elevation (`shadow-rest` → `shadow-hover` on hover) for depth — a hairline border plus a subtle shadow, not a colored glow
- Use `tabular-nums` on every number that can change at runtime (stake, votes, rank score, view count) — a reflowing digit reads as broken, not dynamic
- Put core actions (vote) directly on the card that displays the data — a click into a detail page is friction, not a feature
- Reserve the `value-flash` treatment for numbers that genuinely just changed (a vote landed, a claim confirmed) — applying it to static content cheapens the signal
- Maintain the 4px base unit for spacing

### Don't
- Don't use drop shadows or glow for elevation beyond the two documented `shadow-rest`/`shadow-hover` steps — there's no third "big" shadow, and no colored/tinted glow of any kind
- Don't add a transform-based lift, scale, or bounce to card/button/chip chrome (borders, backgrounds, shadows) on hover/press — feedback there is color/background/border/shadow only, at `150ms`/`ease-out`. (The App Card's own hero-image zoom-on-hover, `group-hover:scale-[1.03]` at 300ms, is a distinct, intentional exception — a photographic-preview convention, not chrome feedback.)
- Don't use large gradient background fills anywhere in the product — the old Nebula/Plasma gradients are gone from the token set entirely, not just unused
- Don't set body text below 14px or above 18px
- Don't reach for `cerulean` or `signal-blue` in new work — both are unused legacy aliases left over from the dark-theme token names (see Tokens — Colors)
- Don't treat the constellation map as the product's primary surface — it's an optional tab inside Rankings, not a destination in its own right

## Surfaces

The old dark theme needed four distinct darkness levels (Void Canvas / Carbon / Abyss / Singularity) to carve out visual depth against near-black. A light theme doesn't need that many — most of what used to be a separate "deepest surface" level has collapsed into the same value as its neighbor. Documented honestly rather than pretending four meaningfully distinct levels still exist:

| Level | Name    | Value     | Purpose                                                                                   |
| ----- | ------- | --------- | -------------------------------------------------------------------------------------------- |
| 1     | Paper   | `#ffffff` | Page background — `ink.deep` in `tailwind.config.ts` is set to this same value as `ink.DEFAULT`, i.e. there's no separate "deepest text" tone any more |
| 2     | Surface | `#f7f7f8` | Card and panel background                                                                  |
| 3     | Well    | `#eef0f3` | Inset wells — input backgrounds, nested panels. `ink.graphite` is set to this same value as `mist`, for the same reason as above |

There is no level-4 "maximum contrast container" any more — the old Singularity surface had no light-theme equivalent that earned a distinct role, so it wasn't carried forward as a fourth level.

## Imagery

No photographic content anywhere in the product, unchanged from before. App icons (user-submitted) remain the only bitmap imagery in the product. The About page's hero and a second section still use a procedural WebGL2 shader background (`ConstellationField.tsx`, `#version 300 es`, a domain-warped nebula wash plus a GPU-computed orbiting-node layer) — no image assets, same as before — but its colors were deliberately **not** repainted for light as part of this pass; it still renders its original dark navy/indigo/magenta palette (`docs/plans/2026-07-19-light-redesign-implementation.md` calls this out explicitly as out of scope: "a full pixel-level restyle of the About page's WebGL constellation hero... is a bigger, separate effort than this token-repaint-plus-restructure pass"). Anyone revisiting the About page hero should treat it as a known, intentional exception rather than an oversight. Decorative iconography elsewhere is flat, single-color, geometric — no gradients or 3D renders on icons themselves.

## Layout

Full-width light canvas (the old copy's "full-width dark canvas" language, updated) — `AppShell` constrains content to `max-w-7xl` (1280px), with the Navbar and footer spanning the same width. Data-dense pages (Browse, Rankings) use full-width grids/tables with 16-24px gaps; the About page remains the one prose-first, centered-column page in the product and is where the scroll-driven reveal animations live. Vertical rhythm is otherwise unchanged: roomier stacks on marketing-style pages (About, Rewards), tighter 16-24px stacks on data pages where density matters more than breathing room.

## Similar Brands

- **Linear** — near-white dashboard chrome, hairline-border elevation strategy, geometric sans-serif — already the closest reference in the previous pass and still accurate here
- **Vercel** — light dashboard chrome, data-forward layout, restrained single-accent color use
- **Stripe** — dashboard-style fintech/DeFi data density, tabular numeric precision, calm use of color reserved for status/semantic meaning

(Replaces the old list's Uniswap and Obsidian's graph view — the constellation map is no longer the product's signature visual, so a force-directed-graph-tool reference no longer fits as a primary comparison.)

## Quick Start

The blocks below are a portable translation of these tokens for external consumers (a marketing microsite, a partner embed, a design tool) — they are not literal repo content. This app itself defines these values as Tailwind `colors`/`fontFamily`/`borderRadius`/etc. entries in `app/tailwind.config.ts`, not as CSS custom properties, so grepping this codebase for e.g. `--font-ui-monospace` won't find anything; grep `tailwind.config.ts` instead.

### CSS Custom Properties

```css
:root {
  /* Colors */
  --color-cream: #ffffff;
  --color-ivory: #f7f7f8;
  --color-mist: #eef0f3;
  --color-powder: #d1d3da;
  --color-faint: #d1d3da;
  --color-ink: #0d0e12;
  --color-ink-deep: #0d0e12;
  --color-ink-graphite: #eef0f3;
  --color-slate: #565a66;
  --color-slate-steel: #8a8f9c;
  --color-hairline: #e4e5e9;
  --color-cobalt: #4338ca;
  --color-cobalt-deep: #372fb0;
  --color-cerulean: #4338ca;
  --color-violet: #4338ca;
  --color-indigo-soft: #eef0fd;
  --color-forest: #15803d;
  --color-amber: #b45309;
  --color-negative: #b91c1c;
  --color-signal-blue: #15803d;

  /* Motion */
  --ease-spring: cubic-bezier(0, 0, 0.2, 1);
  --ease-out-smooth: cubic-bezier(0, 0, 0.2, 1);
  --duration-fast: 150ms;
  --duration-base: 250ms;
  --shadow-rest: 0 1px 2px rgba(13, 14, 18, 0.04), 0 1px 1px rgba(13, 14, 18, 0.03);
  --shadow-hover: 0 4px 12px rgba(13, 14, 18, 0.08), 0 2px 4px rgba(13, 14, 18, 0.05);

  /* Typography — Font Families */
  --font-ui-sans-serif: 'Inter', ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  --font-ui-monospace: 'ui-monospace', 'SFMono-Regular', 'Menlo', monospace;

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
  --spacing-48: 48px; --spacing-18: 72px; --spacing-68: 68px; --spacing-88: 88px;
  --spacing-144: 144px; --spacing-160: 160px; --spacing-224: 224px;

  /* Border Radius */
  --radius-button: 8px;
  --radius-card: 10px;
  --radius-pill: 6px;
  --radius-navitem: 6px;
  --radius-image: 8px;
  --radius-icon: 48px;
}
```

### Tailwind v4

```css
@theme {
  --color-cream: #ffffff;
  --color-ivory: #f7f7f8;
  --color-mist: #eef0f3;
  --color-powder: #d1d3da;
  --color-faint: #d1d3da;
  --color-ink: #0d0e12;
  --color-ink-deep: #0d0e12;
  --color-ink-graphite: #eef0f3;
  --color-slate: #565a66;
  --color-slate-steel: #8a8f9c;
  --color-hairline: #e4e5e9;
  --color-cobalt: #4338ca;
  --color-cobalt-deep: #372fb0;
  --color-cerulean: #4338ca;
  --color-violet: #4338ca;
  --color-indigo-soft: #eef0fd;
  --color-forest: #15803d;
  --color-amber: #b45309;
  --color-negative: #b91c1c;
  --color-signal-blue: #15803d;

  --ease-spring: cubic-bezier(0, 0, 0.2, 1);
  --ease-out-smooth: cubic-bezier(0, 0, 0.2, 1);

  --font-ui-sans-serif: 'Inter', ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  --font-ui-monospace: 'ui-monospace', 'SFMono-Regular', 'Menlo', monospace;

  --text-caption: 12px; --leading-caption: 1.5; --tracking-caption: 0.3px;
  --text-body-sm: 14px; --leading-body-sm: 1.65;
  --text-body: 16px; --leading-body: 1.5;
  --text-subheading: 20px; --leading-subheading: 1.4;
  --text-heading-sm: 30px; --leading-heading-sm: 1.2;
  --text-heading: 36px; --leading-heading: 1.11;
  --text-display: 48px; --leading-display: 1.1;

  --spacing-4: 4px; --spacing-8: 8px; --spacing-12: 12px; --spacing-16: 16px;
  --spacing-20: 20px; --spacing-24: 24px; --spacing-32: 32px; --spacing-40: 40px;
  --spacing-48: 48px; --spacing-18: 72px; --spacing-68: 68px; --spacing-88: 88px;
  --spacing-144: 144px; --spacing-160: 160px; --spacing-224: 224px;

  --radius-button: 8px;
  --radius-card: 10px;
  --radius-pill: 6px;
  --radius-navitem: 6px;
  --radius-image: 8px;
  --radius-icon: 48px;
}
```
