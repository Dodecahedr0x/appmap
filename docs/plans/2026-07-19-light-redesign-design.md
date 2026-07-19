# nebulous.world — Light, Data-Forward Redesign

> From "control room in deep space" to a clean dashboard: information design
> carries the product's substance (transparent, stake-weighted rankings; real
> on-chain actions), not atmosphere.

**Theme:** light (light-only for now — no dark mode toggle)

## Why

The current design (`DESIGN.md`) is a dark, cosmic "living constellation"
theme — deep-void canvas, nebula gradients, glow-on-hover, spring-eased
motion, force-directed maps as the signature visual. Two problems drove this
rework:

1. **Visual theme feels off** — the dark/atmospheric direction isn't
   landing; a clean, light, product-analytics feel (Linear/Vercel/Stripe)
   fits the product better than sci-fi visualization.
2. **UX/IA problems** — Discover vs. Explore is a confusing split, core
   actions (vote/stake) are buried behind navigation into an app's detail
   page, and onboarding leans entirely on a separate About page that a new
   visitor may never open.

## Navigation & IA

Same shell, reorganized destinations:

- **Browse** (`/`, was Discover) — the searchable app grid. The unambiguous
  home page: find apps, act on them.
- **Rankings** (`/rankings`, replaces Explore) — stats-first: a metrics
  strip (trending, top movers, totals) and a sortable leaderboard table are
  the primary content. The force-directed constellation map (`ForceMap`/
  `GroupMap`) still exists but is demoted to a "Map view" tab within this
  page — same interaction model (drag/zoom/click-to-focus), restyled for
  light, no longer the reason the page exists.
- **Rewards** — unchanged in position and purpose.
- **About** — stays as a deeper reference page (Data API docs, tokenomics),
  linked from the footer and nav, no longer the sole onboarding surface.

**Onboarding:** a compact, dismissible explainer banner on Browse (three
lines: what this is / how ranking works / how to participate), gone after
first dismissal (localStorage flag) — no blocking modal. A first-time
visitor should be able to understand and act without leaving the home page.

## Colors

Light canvas, near-black text, one restrained accent. No gradients as
backgrounds, no glow-on-hover. Elevation comes from real (subtle) shadows.

| Name | Value | Role |
|---|---|---|
| Paper | `#ffffff` | Page background |
| Surface | `#f7f7f8` | Card/panel background — one step off white |
| Surface Raised | `#ffffff` | Cards that need to stand out (modals, popovers, hovered cards) — paired with a shadow |
| Ink | `#0d0e12` | Primary text, headings |
| Ink Muted | `#565a66` | Secondary text, captions, labels |
| Ink Faint | `#8a8f9c` | Placeholder text, disabled state |
| Border | `#e4e5e9` | Hairline borders, dividers |
| Border Strong | `#d1d3da` | Emphasized borders (focused inputs, active card) |
| Indigo | `#4338ca` | Primary accent — links, primary buttons, active nav, focus rings |
| Indigo Soft | `#eef0fd` | Indigo tint for active/selected backgrounds (chips, active nav pill) |
| Positive | `#15803d` | Gains, positive deltas |
| Warning | `#b45309` | Pending/decaying states |
| Negative | `#b91c1c` | Losses, errors |

Elevation (rest, on raised surfaces):
`0 1px 2px rgba(13,14,18,0.04), 0 1px 1px rgba(13,14,18,0.03)`, a slightly
stronger shadow on hover for interactive cards — replaces the old
`--glow-*` tokens entirely. Semantic colors (positive/warning/negative) are
the only saturated colors at any real size (deltas, badges); Indigo stays
reserved for interactive/brand elements, never a large fill.

## Typography

One typeface instead of the previous four-face stack (dropping the
"Obviously" display face and the "MDIO" instrument-panel label face — both
were built for a sci-fi control-room feel that no longer applies):

- **Inter** (system-ui fallback) for everything — body, UI, and headings.
  Weight does the work: 400 body, 500/600 UI labels and buttons, 600/700
  headings.
- **ui-monospace** (JetBrains Mono/SFMono fallback) stays, unchanged role —
  on-chain amounts, addresses, tabular numeric data. The one place a
  distinct face still earns its keep functionally.

Type scale stays close to current sizes (12/14/16/20/30/36/48px) — the
rhythm wasn't the problem, just applied through one family now.

## Shape

Less rounding across the board — a data-dense dashboard reads more
credible with tighter radii than the previous "everything is a pill" system:

| Element | Old | New |
|---|---|---|
| Buttons | 9999px (pill) | 8px |
| Cards | 16px | 10px |
| Chips/tags | 9999px (pill) | 6px |
| Nav active state | 9999px (pill) | 6px |
| Images/icons | 12px | 8px |

Borders stay 1px hairline throughout.

## Components

**Primary Button** — Indigo fill, white text, 8px radius, 14px/600 weight,
`12px 20px` padding. Hover: background darkens (`#372fb0`) and the
elevation shadow grows a step. Press: opacity dips slightly — no
scale/bounce. Secondary buttons: white background, `Border` outline, `Ink`
text, same hover/press logic with a lighter shadow.

**App Card** — `Surface` background, 10px radius, 1px `Border`. At rest: no
shadow. On hover: background lifts to `Surface Raised` (white) and gains
the rest-elevation shadow — no translate/lift, no glow.

The vote action lives directly on the card: a compact button in the stats
row showing a small upvote icon + the app's current vote weight. **Quick
vote:** one click casts a small predefined default amount immediately,
optimistic UI updates the count right away, confirmation happens in the
background. A "•••" affordance next to it opens a lightweight popover for a
custom amount. One click for the common case (agree with the vote), one
click further for the power-user case (stake meaningfully) — this is the
concrete fix for "core actions buried."

**Tag/Filter Chip** — 6px radius, hairline border. Active: `Indigo Soft`
background + `Indigo` text/border. Chips carrying live stake show the
numeric stake amount inline (tabular-nums) — in a calmer light system, the
number is the "this has activity" signal, not a pulsing dot.

**Nav Bar** — White, `Border` bottom hairline, no blur/translucency needed
against a flat white page. Active route: `Indigo Soft` background pill
(6px radius), no live-pulse dot. A connected wallet's status shows as one
small solid dot next to the Connect button, not repeated per nav item.

## Motion

Drops the "alive/reactive" language almost entirely — no spring-overshoot
easing, no ambient glow, no breathing pulses. A single flat `ease-out` at
two durations:

- **150ms** — hover/press feedback (color/background/shadow only, no
  transform-based lift or scale).
- **250ms** — content transitions (tab swaps, popovers entering/leaving).

One carryover: a value that just changed (a vote landed, a claim confirmed)
still gets a brief one-shot color flash (Positive green / Warning amber
back to Ink) on the number itself.

## Rankings page

Leads with a **stats strip** — trending apps, top movers (7d), total
staked, total votes — as compact metric tiles with sparklines, then a
**leaderboard table** below (rank, app, vote weight, stake, 7d trend),
sortable by column — the same underlying data as the Browse grid, in a
denser tabular form suited to comparison. A **"Map view"** tab sits
alongside the leaderboard (not the default), opening the existing
`ForceMap`/`GroupMap` visualization restyled for light (white/`Surface`
canvas, `Indigo`-tinted nodes, `Border`-colored edges) — same interaction
model, no longer the page's reason for existing.

This directly resolves the Discover/Explore confusion: Browse is
unambiguously for finding/acting on apps, Rankings is unambiguously for
comparing/analyzing them, and the map is one optional lens within Rankings
rather than a whole destination.

## Out of scope (this pass)

- Dark mode — light-only for now; a toggle can be added later without
  disrupting this token structure (tokens are already named semantically,
  not by literal color, e.g. `Surface` not `Gray100`).
- Any changes to the on-chain program, indexer, or ranking math — this is a
  presentation-layer rework only.
