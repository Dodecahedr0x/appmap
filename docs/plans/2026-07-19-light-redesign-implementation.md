# Light, Data-Forward Redesign — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Rework nebulous.world's visual theme from a dark "cosmic" system to a
light, data-forward dashboard (Linear/Vercel-style), and restructure the
Discover/Explore split into Browse/Rankings to surface buried actions (vote),
resolve IA confusion, and add first-visit onboarding — per
`docs/plans/2026-07-19-light-redesign-design.md`.

**Architecture:** Nearly every component reads color via named Tailwind
tokens (`bg-cream`, `text-ink`, `border-hairline`, `text-cobalt`, ...)
defined once in `app/tailwind.config.ts`, not literal hex — so repointing
those token values is what repaints most of the app "for free," the same
technique the previous (dark) design pass used. On top of that token
repaint, a handful of components need direct edits: those with hardcoded hex
(canvas-rendered maps, chart colors, the wallet-adapter override block) or
motion/interaction language being removed entirely (spring-overshoot easing,
ambient glow, breathing pulses). Net-new UI (quick-vote on cards, the
onboarding banner, the Rankings page's stats strip + leaderboard) is real
new code, not a restyle.

**Tech Stack:** Next.js 14 (App Router), TypeScript, Tailwind CSS, Recharts,
d3-force (canvas-rendered constellation maps).

**Note on verification:** This is a presentation-layer rework — no ranking/
revenue/on-chain logic changes. The project's existing test suite
(`npm test`, vitest) only covers pure logic modules (`ranking.ts`,
`revenue.ts`, etc.) and has no component/visual tests, so there's nothing to
TDD here. Each task's verification step is `npm run typecheck`,
`npm run lint`, and a manual look in the dev server instead of a test run —
call this out explicitly rather than skipping verification.

---

## Color token mapping (reference for every task below)

Old token name kept, hex value changes — this table is the single source of
truth every task below refers back to.

| Tailwind key | Old value (role) | New value (role) |
|---|---|---|
| `cream` | `#10121a` (void canvas / page bg) | `#ffffff` (Paper / page bg) |
| `ivory` | `#0d0f16` (carbon / card bg) | `#f7f7f8` (Surface / card bg) |
| `mist` | `#080911` (abyss / well, input bg) | `#eef0f3` (Well — input bg, nested panels) |
| `powder` | `#666c7a` (gunmetal, unused) | `#d1d3da` (Border Strong) |
| `ink.DEFAULT` | `#f2f6fa` (lunar white / primary text) | `#0d0e12` (Ink / primary text) |
| `ink.deep` | `#040509` (singularity) | `#0d0e12` (Ink — same as DEFAULT, no separate deepest-surface role in a light theme) |
| `ink.graphite` | `#080911` (abyss, dup of mist) | `#eef0f3` (same as `mist`) |
| `slate.DEFAULT` | `#9aa0ac` (steel / secondary text) | `#565a66` (Ink Muted) |
| `slate.steel` | `#bfc1c9` (mist / captions, placeholders) | `#8a8f9c` (Ink Faint) |
| `hairline` | `#666c7a` (gunmetal / borders) | `#e4e5e9` (Border) |
| `faint` | `#e5e7eb` (platinum) | `#d1d3da` (Border Strong) |
| `cobalt.DEFAULT` | `#3aa8ff` (plasma blue / primary accent) | `#4338ca` (Indigo) |
| `cobalt.deep` | `#9a9dff` (ultraviolet / hover-pressed) | `#372fb0` (Indigo, darker — hover/pressed) |
| `cerulean` | `#00daef` (unused) | `#4338ca` (Indigo, unused but consistent) |
| `violet` | `#9a9dff` (ultraviolet, dup) | `#4338ca` (Indigo — was a second accent hue, now the one accent) |
| `forest` | `#2ef7c6` (aurora mint / success) | `#15803d` (Positive) |
| `amber` | `#ffc670` (warning/pending) | `#b45309` (Warning) |
| `signal-blue` | `#61dafb` (unused) | `#15803d` (Positive, unused but consistent) |

New tokens added (no old equivalent):
- `indigo-soft`: `#eef0fd` — Indigo tint for active/selected backgrounds (chips, active nav pill).
- `negative`: `#b91c1c` — errors, losses.

---

### Task 1: Repoint Tailwind tokens, radii, shadows, motion

**Files:**
- Modify: `app/tailwind.config.ts`

**Step 1: Edit the `colors` block**

Replace the entire `colors: { ... }` object (lines 11–45) with:

```ts
      colors: {
        // nebulous.world style reference — light, data-forward dashboard
        // (see DESIGN.md, docs/plans/2026-07-19-light-redesign-design.md).
        // Names kept stable from the previous dark system so every
        // component that only ever references these Tailwind classes
        // (bg-cream, text-ink, border-hairline, ...) repaints for free —
        // only the underlying hex values moved.
        cream: "#ffffff", // paper — page background
        ivory: "#f7f7f8", // surface — card background
        mist: "#eef0f3", // well — input backgrounds, nested panels
        powder: "#d1d3da", // border strong
        ink: {
          DEFAULT: "#0d0e12", // primary text
          deep: "#0d0e12",
          graphite: "#eef0f3",
        },
        slate: {
          DEFAULT: "#565a66", // ink muted — secondary text
          steel: "#8a8f9c", // ink faint — captions, placeholders
        },
        hairline: "#e4e5e9", // border — hairline borders/dividers
        faint: "#d1d3da",
        cobalt: {
          DEFAULT: "#4338ca", // indigo — primary accent
          deep: "#372fb0", // indigo hover/pressed
        },
        cerulean: "#4338ca",
        violet: "#4338ca",
        "indigo-soft": "#eef0fd",
        forest: "#15803d", // positive
        amber: "#b45309", // warning
        negative: "#b91c1c",
        "signal-blue": "#15803d",
      },
```

**Step 2: Edit `fontFamily`**

Replace:

```ts
      fontFamily: {
        sans: ["var(--font-ui-sans-serif)", "ui-sans-serif", "system-ui", "sans-serif"],
        display: ["var(--font-obviously)", "var(--font-ui-sans-serif)", "ui-sans-serif", "system-ui", "sans-serif"],
        mono: ["ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
      },
```

with:

```ts
      fontFamily: {
        sans: ["var(--font-ui-sans-serif)", "ui-sans-serif", "system-ui", "sans-serif"],
        // No separate display face any more (see DESIGN.md) — `font-display`
        // stays defined (existing headings reference the class) but now
        // resolves to the same Inter stack as body text.
        display: ["var(--font-ui-sans-serif)", "ui-sans-serif", "system-ui", "sans-serif"],
        mono: ["ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
      },
```

**Step 3: Edit `borderRadius`**

Replace:

```ts
      borderRadius: {
        card: "16px",
        icon: "48px",
        pill: "9999px",
        image: "12px",
        button: "9999px",
        navitem: "9999px",
      },
```

with:

```ts
      borderRadius: {
        card: "10px",
        icon: "48px",
        pill: "6px",
        image: "8px",
        button: "8px",
        navitem: "6px",
      },
```

**Step 4: Edit `backgroundImage`**

The nebula/plasma gradients are no longer used as backgrounds anywhere in
the new system (no atmospheric hero, no gradient CTAs). Replace:

```ts
      backgroundImage: {
        "hero-gradient":
          "radial-gradient(circle at 50% 0%, rgba(47, 61, 255, 0.32) 0%, rgba(16, 18, 26, 0) 60%)",
        "cta-gradient": "linear-gradient(83.21deg, #2f3dff 0%, #c93ff2 100%)",
        "nebula-gradient": "linear-gradient(83.21deg, #2f3dff 0%, #c93ff2 100%)",
        "plasma-gradient": "linear-gradient(66.77deg, #ff3b3b 0%, #ff35fa 100%)",
      },
```

with:

```ts
      backgroundImage: {},
```

Leave it as an empty object rather than deleting the key — Task 18's grep
check confirms nothing still references `bg-hero-gradient`/`bg-cta-gradient`/
`bg-nebula-gradient`/`bg-plasma-gradient` before this is safe to leave empty.

**Step 5: Edit `transitionTimingFunction`, `boxShadow`, `keyframes`, `animation`**

Replace the whole block from `transitionTimingFunction:` through the end of
`animation: { ... },` (i.e. everything between `backgroundImage` and the
closing of `extend`) with:

```ts
      // Motion — see DESIGN.md's "Motion" section. One flat ease-out, two
      // durations. No spring-overshoot, no ambient glow, no breathing
      // pulses — see the design doc's rationale for dropping the previous
      // "reactive/alive" language in favor of a calmer dashboard feel.
      transitionTimingFunction: {
        spring: "cubic-bezier(0, 0, 0.2, 1)",
        "out-smooth": "cubic-bezier(0, 0, 0.2, 1)",
      },
      // Real (subtle) elevation shadows, replacing the old glow-on-hover
      // tokens now that the canvas is light, not a dark void.
      boxShadow: {
        rest: "0 1px 2px rgba(13, 14, 18, 0.04), 0 1px 1px rgba(13, 14, 18, 0.03)",
        hover: "0 4px 12px rgba(13, 14, 18, 0.08), 0 2px 4px rgba(13, 14, 18, 0.05)",
      },
      keyframes: {
        "fade-in": {
          from: { opacity: "0", transform: "translateY(4px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
        "fade-in-fast": {
          from: { opacity: "0" },
          to: { opacity: "1" },
        },
        // One-shot value-changed flash (a vote landed, a claim confirmed) —
        // the one motion carryover from the old system, see DESIGN.md.
        "value-flash": {
          "0%": { color: "var(--flash-color, #15803d)" },
          "100%": { color: "inherit" },
        },
      },
      animation: {
        "fade-in": "fade-in 0.25s ease-out",
        "fade-in-fast": "fade-in-fast 0.15s ease-out",
        "value-flash": "value-flash 0.6s ease-out",
      },
```

**Step 6: Verify**

```bash
cd app && npm run typecheck && npm run lint
```

Expected: both pass (this file has no runtime logic, only config, so a
failure here means a syntax typo — fix before continuing).

**Step 7: Commit**

```bash
git add app/tailwind.config.ts
git commit -m "feat: repoint design tokens to a light, data-forward palette"
```

---

### Task 2: Rewrite `globals.css` component classes and base styles

**Files:**
- Modify: `app/src/app/globals.css`

**Step 1: Replace the top of the file (base styles)**

Replace lines 1–40 (`@tailwind base;` through the scrollbar `*` rule, up to
but not including `*::-webkit-scrollbar-thumb`) with:

```css
@tailwind base;
@tailwind components;
@tailwind utilities;

:root {
  color-scheme: light;
}

html,
body {
  background-color: #ffffff;
  color: #0d0e12;
}

body {
  min-height: 100vh;
  overflow-x: clip;
}

/* Thin custom scrollbars to match the light theme. */
* {
  scrollbar-width: thin;
  scrollbar-color: #d1d3da transparent;
}
*::-webkit-scrollbar {
  width: 8px;
  height: 8px;
}
```

**Step 2: Replace `*::-webkit-scrollbar-thumb`**

```css
*::-webkit-scrollbar-thumb {
  background: #d1d3da;
  border-radius: 8px;
}
```

**Step 3: Replace the `@layer components` block**

Replace the entire block from `@layer components {` through its closing
`}` (originally lines 42–85) with:

```css
@layer components {
  /* Elevation comes from a hairline border plus a real (subtle) shadow now
     — see DESIGN.md. `.card` is the static/at-rest surface; `.card-interactive`
     layers the hover feedback for genuinely clickable tiles (AppCard, AdCard). */
  .card {
    @apply rounded-card border border-hairline bg-ivory shadow-rest;
  }
  .card-interactive {
    @apply card transition-[background-color,box-shadow] duration-150 ease-out hover:bg-cream hover:shadow-hover;
  }
  .btn {
    @apply inline-flex items-center justify-center gap-2 rounded-button px-6 py-3 text-sm font-medium transition-[color,background-color,border-color,box-shadow,opacity] duration-150 ease-out active:opacity-80 disabled:cursor-not-allowed disabled:opacity-50 disabled:active:opacity-50;
  }
  /* Primary CTA: solid Indigo fill, white text — see DESIGN.md's "Primary
     Button" component. */
  .btn-primary {
    @apply btn bg-cobalt text-cream shadow-rest hover:bg-cobalt-deep hover:shadow-hover;
  }
  .btn-secondary {
    @apply btn border border-hairline bg-cream text-ink shadow-rest hover:border-powder hover:shadow-hover;
  }
  .btn-ghost {
    @apply btn text-slate hover:bg-ivory hover:text-ink;
  }
  .input {
    @apply w-full rounded-card border border-hairline bg-mist px-3 py-2 text-sm text-ink placeholder:text-slate-steel transition-[border-color,box-shadow] duration-150 focus:border-cobalt/60 focus:outline-none focus:ring-1 focus:ring-cobalt/40;
  }
  .chip {
    @apply inline-flex items-center gap-1 rounded-pill border border-hairline bg-ivory px-2.5 py-1 text-xs text-slate transition-[color,background-color,border-color,opacity] duration-150 ease-out active:opacity-80;
  }
  .chip-active {
    @apply border-cobalt/60 bg-indigo-soft text-cobalt;
  }
}
```

**Step 4: Delete the `prefers-reduced-transparency` block**

The navbar no longer uses translucency/backdrop-blur (flat white bar over a
flat white page — see Task 5), so this fallback no longer applies. Delete:

```css
@media (prefers-reduced-transparency: reduce) {
  .navbar-chrome {
    background-color: #10121a;
    backdrop-filter: none;
  }
}
```

**Step 5: Leave the `reveal-up`/`.reveal` scroll-driven-reveal block and the
`.animate-fade-in`/`fade-in-opacity-only` block untouched** — these are
generic entrance animations (About page reveals, toast/empty-state
entrances) that don't depend on the old glow/spring language and stay valid
in the new system.

**Step 6: Leave the `.chip-pop`/`.chip-leaving` block (CreateAppForm tag
chips) untouched** — same reasoning, it's a plain opacity/scale transition
already, no spring easing or glow involved.

**Step 7: Replace the wallet-adapter override block**

Replace the final block (from `/* Wallet-adapter modal restyle... */` to
end of file) with:

```css
/* Wallet-adapter modal restyle to fit the light theme. */
.wallet-adapter-button {
  height: auto !important;
  font-family: inherit !important;
}
.wallet-adapter-button-trigger {
  background-color: #4338ca !important;
  border-radius: 8px !important;
  transition: background-color 150ms ease-out !important;
}
.wallet-adapter-button-trigger:hover {
  background-color: #372fb0 !important;
}
.wallet-adapter-modal-wrapper {
  background: #ffffff !important;
  color: #0d0e12 !important;
}
.wallet-adapter-modal-button-close {
  background: #f7f7f8 !important;
}
.wallet-adapter-modal-title {
  color: #0d0e12 !important;
}
.wallet-adapter-modal-list .wallet-adapter-button {
  background-color: #f7f7f8 !important;
  color: #0d0e12 !important;
}
.wallet-adapter-modal-list .wallet-adapter-button:hover {
  background-color: #eef0f3 !important;
}
```

**Step 8: Verify**

```bash
cd app && npm run typecheck && npm run lint
```

**Step 9: Commit**

```bash
git add app/src/app/globals.css
git commit -m "feat: rewrite base styles and component classes for the light theme"
```

---

### Task 3: Update fonts and theme-color in `layout.tsx`

**Files:**
- Modify: `app/src/app/layout.tsx`

**Step 1: Drop the `Space_Grotesk` display font**

Replace:

```ts
import { Inter, Space_Grotesk } from "next/font/google";
```

with:

```ts
import { Inter } from "next/font/google";
```

**Step 2: Replace the font declarations**

Replace:

```ts
// DESIGN.md's display face is the proprietary 'Obviously' — Space Grotesk is
// its own documented substitute ("No web-safe substitute captures the feel
// — Inter Black or Space Grotesk Bold approximate it").
const bodySans = Inter({
  subsets: ["latin"],
  variable: "--font-ui-sans-serif",
  weight: ["400", "500", "600", "700"],
});
const displaySans = Space_Grotesk({
  subsets: ["latin"],
  variable: "--font-obviously",
  weight: ["300", "400", "700"],
});
```

with:

```ts
// One typeface for the whole app now — see DESIGN.md. `--font-obviously`
// still gets set (to the same Inter instance) so any lingering
// `font-display` usage resolves correctly without hunting every callsite.
const bodySans = Inter({
  subsets: ["latin"],
  variable: "--font-ui-sans-serif",
  weight: ["300", "400", "500", "600", "700"],
});
```

**Step 3: Update the `<html>` className and viewport themeColor**

Replace:

```ts
    <html lang="en" className={`${bodySans.variable} ${displaySans.variable}`}>
```

with:

```ts
    <html lang="en" className={`${bodySans.variable} font-obviously-var`} style={{ "--font-obviously": "var(--font-ui-sans-serif)" } as React.CSSProperties}>
```

Actually — simpler and less error-prone: just point `--font-obviously` at
the same variable directly in the font declaration instead of via inline
style. Use this instead for Step 2/3 combined:

```ts
const bodySans = Inter({
  subsets: ["latin"],
  variable: "--font-ui-sans-serif",
  weight: ["300", "400", "500", "600", "700"],
});
```

and keep the `<html>` tag as:

```ts
    <html lang="en" className={bodySans.variable}>
```

Then in `app/tailwind.config.ts`'s `fontFamily.display` (already changed in
Task 1 Step 2), it references `var(--font-ui-sans-serif)` directly rather
than a separate `--font-obviously` variable — so no second CSS variable is
needed at all. Use this simpler version; ignore the inline-style approach
above.

**Step 4: Update `viewport.themeColor`**

Replace:

```ts
export const viewport: Viewport = {
  themeColor: "#1f232e",
};
```

with:

```ts
export const viewport: Viewport = {
  themeColor: "#ffffff",
};
```

**Step 5: Update `<body>` background** — no change needed, `bg-cream`
already resolves to `#ffffff` via Task 1.

**Step 6: Verify**

```bash
cd app && npm run typecheck && npm run lint && npm run build
```

Expected: all pass. The build step matters here specifically because a
`next/font` misconfiguration only surfaces at build time.

**Step 7: Commit**

```bash
git add app/src/app/layout.tsx
git commit -m "feat: drop the display typeface, use Inter site-wide"
```

---

### Task 4: Checkpoint — visual smoke test of the token repaint

**Files:** none (verification only)

**Step 1: Start the dev server**

```bash
cd app && npm run dev
```

**Step 2: Open `http://localhost:3000` in a browser** and confirm: white
page background, dark text, cards with hairline borders and a subtle
shadow on hover, indigo primary button and links, no glow effects, no
spring-overshoot bounce on hover. Some things will still look wrong at this
point (Navbar not yet renamed, no quick-vote, maps still using hardcoded
dark canvas colors) — that's expected, later tasks fix those.

**Step 3: Leave the dev server running in the background** for the rest of
this plan's manual-check steps.

---

### Task 5: Restyle Navbar — rename Explore → Rankings, remove live-pulse dot

**Files:**
- Modify: `app/src/components/Navbar.tsx`

**Step 1: Update the `NAV` array**

Replace:

```ts
const NAV = [
  { href: "/", label: "Discover" },
  { href: "/explore", label: "Explore" },
  { href: "/rewards", label: "Rewards" },
  { href: "/about", label: "About" },
];
```

with:

```ts
const NAV = [
  { href: "/", label: "Browse" },
  { href: "/rankings", label: "Rankings" },
  { href: "/rewards", label: "Rewards" },
  { href: "/about", label: "About" },
];
```

**Step 2: Remove the translucent chrome + per-item live-pulse dot**

Replace the `<header>` opening tag:

```tsx
    <header className="navbar-chrome sticky top-0 z-40 border-b border-hairline/70 bg-cream/75 backdrop-blur-md">
```

with:

```tsx
    <header className="sticky top-0 z-40 border-b border-hairline bg-cream">
```

**Step 3: Simplify the nav item — drop the pulse dot, use the new
`indigo-soft` active background**

Replace the nav item `<Link>` block:

```tsx
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    "flex items-center gap-1.5 rounded-navitem px-3 py-2 text-sm font-medium transition-[color,background-color] duration-150 ease-spring",
                    active
                      ? "bg-ivory text-ink"
                      : "text-slate hover:text-ink",
                  )}
                >
                  {item.label}
                  {/* A live-status pulse, not decoration — see DESIGN.md's
                      Navigation Bar component and its Don'ts ("reserve
                      pulse-live for things that are genuinely live"): the
                      active route only carries it once a wallet is
                      connected, i.e. there's actually something of yours
                      being tracked live on that page. */}
                  {active && connected && (
                    <span
                      className="h-1.5 w-1.5 animate-pulse-live rounded-full bg-forest"
                      aria-hidden="true"
                    />
                  )}
                </Link>
              );
```

with:

```tsx
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    "rounded-navitem px-3 py-2 text-sm font-medium transition-colors duration-150",
                    active
                      ? "bg-indigo-soft text-cobalt"
                      : "text-slate hover:text-ink",
                  )}
                >
                  {item.label}
                </Link>
              );
```

**Step 4: Remove the now-unused `connected` destructure** if nothing else
in the file uses it. Check the rest of the file — `connected` was only
read for the removed pulse dot, so change:

```ts
  const { connected } = useWallet();
```

to remove the line entirely, and remove the now-unused `useWallet` import
if nothing else in the file references it (check before deleting — the
`import { useWallet } from "@solana/wallet-adapter-react";` line and the
`useWallet()` call).

**Step 5: Add a single connected-wallet status dot next to `ConnectButton`**

Instead of one dot per active nav item, show one dot once, next to the
connect control. Replace:

```tsx
        <ConnectButton />
```

with:

```tsx
        <div className="flex items-center gap-2">
          {connected && (
            <span
              className="h-1.5 w-1.5 rounded-full bg-forest"
              aria-label="Wallet connected"
            />
          )}
          <ConnectButton />
        </div>
```

This means `connected` from `useWallet()` is still needed after all — keep
the `const { connected } = useWallet();` line from Step 4, just remove the
dead per-item logic, not the hook call.

**Step 6: Verify**

```bash
cd app && npm run typecheck && npm run lint
```

Then check the dev server: nav shows Browse / Rankings / Rewards / About,
active route gets a light indigo pill, no per-item dot, one status dot
appears next to Connect wallet once a wallet is connected.

**Step 7: Commit**

```bash
git add app/src/components/Navbar.tsx
git commit -m "feat: rename Explore to Rankings in nav, simplify live-status indicator"
```

---

### Task 6: Remove the breathing pulse from `ToastGlow`

**Files:**
- Modify: `app/src/components/ui/ToastGlow.tsx`

The design drops ambient glow and breathing pulses entirely (see
DESIGN.md's Motion section) — this component's whole premise (a slowly
pulsing radial glow) no longer fits. Replace it with a static, subtly
scaled accent glow (still a nice touch next to a toast icon, just not
breathing).

**Step 1: Replace the component**

```tsx
/**
 * A single soft glow anchored near the toast's icon — a quiet, static
 * accent, not a distraction from the message. Purely decorative
 * (`aria-hidden`).
 */
export function ToastGlow({ color }: { color: readonly [number, number, number] }) {
  const rgb = color.map((c) => Math.round(c * 255)).join(", ");
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute left-0 top-1/2 h-24 w-24 -translate-x-1/3 -translate-y-1/2 rounded-full blur-2xl"
      style={{ background: `radial-gradient(circle, rgba(${rgb}, 0.35) 0%, rgba(${rgb}, 0) 70%)` }}
    />
  );
}
```

**Step 2: Remove the now-unused `toast-glow-pulse` keyframe/animation**

These were already removed from `app/tailwind.config.ts` in Task 1 Step 5
(the whole `keyframes`/`animation` block was replaced) — confirm with:

```bash
grep -rn "toast-glow-pulse\|animate-pulse-live" app/src app/tailwind.config.ts
```

Expected: no matches. If `animate-pulse-live` still appears anywhere,
that's a leftover from a component this plan didn't touch — note it and
either remove the usage or leave a follow-up comment, don't silently strip
functionality from an unrelated feature without checking what it is first.

**Step 3: Verify**

```bash
cd app && npm run typecheck && npm run lint
```

**Step 4: Commit**

```bash
git add app/src/components/ui/ToastGlow.tsx
git commit -m "feat: replace ToastGlow's breathing pulse with a static glow"
```

---

### Task 7: Fix Modal's backdrop scrim (mist token changed roles)

**Files:**
- Modify: `app/src/components/ui/Modal.tsx`

`bg-mist/70` used to work as a dimming backdrop because `mist` was a near-
black well color. After Task 1, `mist` is a light "well" gray
(`#eef0f3`) — at 70% opacity it no longer dims the page behind the modal at
all. Modals need an explicit dark scrim regardless of page theme.

**Step 1: Replace the backdrop className**

Replace:

```tsx
        visible ? "bg-mist/70" : "bg-mist/0",
```

with:

```tsx
        visible ? "bg-ink/40" : "bg-ink/0",
```

**Step 2: Verify**

```bash
cd app && npm run typecheck && npm run lint
```

Then in the dev server: open the "Create app" modal from Browse (Task 9
wires this in, but it already works pre-existing) and confirm the page
behind it visibly dims.

**Step 3: Commit**

```bash
git add app/src/components/ui/Modal.tsx
git commit -m "fix: use a dark scrim for the modal backdrop, independent of the mist token"
```

---

### Task 8: Add a quick-vote button to `AppCard`

**Files:**
- Create: `app/src/components/app/CardVoteButton.tsx`
- Modify: `app/src/components/AppCard.tsx`

This is the concrete fix for "core actions buried" — voting no longer
requires opening an app's detail page. One click casts a small default
amount; a secondary affordance opens a popover for a custom amount, mirroring
`VotePanel`'s existing amount presets and `useVoteProgram` hook.

**Step 1: Read `VotePanel.tsx` and `useVoteProgram.ts` first** (already read
during planning — `castVote(appId, amount)` returns `{ txSig, simulated }`;
recording the vote is a `POST /api/vote` with `{ appId, amount, txSig }`).
`CardVoteButton` reuses the same two calls, just compressed into a
one-click default + a popover for a custom amount, instead of `VotePanel`'s
always-visible form.

**Step 2: Create `CardVoteButton.tsx`**

```tsx
"use client";

import { useState } from "react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { useAuth } from "@/components/providers/AuthProvider";
import { useToast } from "@/components/ui/Toaster";
import { useVoteProgram } from "@/hooks/useVoteProgram";
import { isSimulationMode } from "@/lib/config";
import { TOKEN_SYMBOL } from "@/lib/constants";
import { cn, formatToken } from "@/lib/utils";

// The one-click default — small enough to be a low-stakes "I agree" tap,
// distinct from VotePanel's larger PRESETS (10/50/100/500) which stay the
// destination for anyone who wants to stake something meaningful.
const QUICK_VOTE_AMOUNT = 10;
const CUSTOM_PRESETS = [10, 50, 100, 500];

/**
 * Compact vote action for AppCard's stats row: one click casts
 * QUICK_VOTE_AMOUNT immediately (optimistic UI, confirms in the
 * background); a "…" affordance next to it opens a small popover for a
 * custom amount. Stops propagation on every interaction so it works inside
 * AppCard's outer `<Link>` without navigating to the app page.
 */
export function CardVoteButton({
  appId,
  voteWeight,
}: {
  appId: string;
  voteWeight: number;
}) {
  const { user } = useAuth();
  const { setVisible } = useWalletModal();
  const toast = useToast();
  const { vote: castVote } = useVoteProgram();

  const [optimisticWeight, setOptimisticWeight] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [customAmount, setCustomAmount] = useState(QUICK_VOTE_AMOUNT);

  const displayWeight = optimisticWeight ?? voteWeight;

  async function submitVote(amount: number) {
    if (amount <= 0 || busy) return;
    setBusy(true);
    setPickerOpen(false);
    const prevOptimistic = optimisticWeight ?? voteWeight;
    setOptimisticWeight(prevOptimistic + amount);
    try {
      const { txSig, simulated } = await castVote(appId, amount);
      const res = await fetch("/api/vote", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ appId, amount, txSig: txSig ?? undefined }),
      });
      const json = await res.json();
      if (!json.ok) throw new Error(json.error || "Vote failed");
      toast.success(
        simulated
          ? `Voted ${amount} ${TOKEN_SYMBOL} (simulated)`
          : `Voted ${amount} ${TOKEN_SYMBOL} — tx confirmed`,
        txSig ? { txSig } : undefined,
      );
    } catch (err) {
      // Roll back the optimistic bump — the vote didn't actually land.
      setOptimisticWeight(voteWeight);
      toast.error(err instanceof Error ? err.message : "Vote failed");
    } finally {
      setBusy(false);
    }
  }

  function onQuickVote(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (!user) {
      setVisible(true);
      return;
    }
    void submitVote(QUICK_VOTE_AMOUNT);
  }

  function onOpenPicker(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (!user) {
      setVisible(true);
      return;
    }
    setPickerOpen((v) => !v);
  }

  return (
    <div className="relative flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
      <button
        type="button"
        onClick={onQuickVote}
        disabled={busy}
        className="flex items-center gap-1 rounded-pill border border-hairline bg-ivory px-2 py-1 text-xs font-semibold text-ink transition-colors duration-150 hover:border-cobalt/50 hover:text-cobalt disabled:opacity-50"
        aria-label={`Vote ${QUICK_VOTE_AMOUNT} ${TOKEN_SYMBOL} for this app`}
        title={isSimulationMode() ? "Simulated — no real tokens spent" : undefined}
      >
        <svg viewBox="0 0 20 20" fill="currentColor" className="h-3.5 w-3.5">
          <path d="M10 3l6 8h-4v6H8v-6H4l6-8z" />
        </svg>
        <span className="tabular-nums">{formatToken(displayWeight, "")}</span>
      </button>
      <button
        type="button"
        onClick={onOpenPicker}
        className="rounded-pill border border-hairline bg-ivory px-1.5 py-1 text-xs text-slate transition-colors duration-150 hover:text-ink"
        aria-label="Vote a custom amount"
        aria-expanded={pickerOpen}
      >
        •••
      </button>

      {pickerOpen && (
        <div
          role="dialog"
          aria-label="Custom vote amount"
          className="absolute bottom-full left-0 z-10 mb-2 w-48 rounded-card border border-hairline bg-cream p-3 shadow-hover"
        >
          <div className="flex flex-wrap gap-1.5">
            {CUSTOM_PRESETS.map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => setCustomAmount(p)}
                className={cn("chip", customAmount === p && "chip-active")}
              >
                {p}
              </button>
            ))}
          </div>
          <div className="mt-2 flex items-center gap-2">
            <input
              type="number"
              min={1}
              className="input px-2 py-1 text-xs"
              value={customAmount}
              onChange={(e) => setCustomAmount(Math.max(0, Number(e.target.value)))}
              aria-label="Custom vote amount"
              onClick={(e) => e.stopPropagation()}
            />
            <button
              type="button"
              className="btn-primary shrink-0 px-3 py-1.5 text-xs"
              disabled={busy || customAmount <= 0}
              onClick={() => submitVote(customAmount)}
            >
              Vote
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
```

**Step 3: Wire it into `AppCard.tsx`**

Add the import at the top of `AppCard.tsx`:

```ts
import { CardVoteButton } from "@/components/app/CardVoteButton";
```

In the stats row, replace the "Votes" `<Stat>` with the new button so it
sits inline with the other three stats but is interactive. Replace:

```tsx
      <div className="mt-auto grid grid-cols-4 gap-2 border-t border-hairline p-4">
        <Stat
          label="Rank"
          value={app.rankScore.toFixed(2)}
          deltaPct={app.trend?.rankScorePct}
          intervalDays={app.trend?.intervalDays}
        />
        <Stat
          label="Votes"
          value={formatToken(app.voteWeight, "")}
          deltaPct={app.trend?.voteWeightPct}
          intervalDays={app.trend?.intervalDays}
        />
        <Stat
          label="Staked"
          value={formatToken(app.stakeTotal, "")}
          deltaPct={app.trend?.stakeTotalPct}
          intervalDays={app.trend?.intervalDays}
        />
        <Stat
          label="Views"
          value={formatNumber(app.viewCount)}
          deltaPct={app.trend?.viewCountPct}
          intervalDays={app.trend?.intervalDays}
        />
      </div>
```

with:

```tsx
      <div className="mt-auto grid grid-cols-3 gap-2 border-t border-hairline p-4">
        <Stat
          label="Rank"
          value={app.rankScore.toFixed(2)}
          deltaPct={app.trend?.rankScorePct}
          intervalDays={app.trend?.intervalDays}
        />
        <Stat
          label="Staked"
          value={formatToken(app.stakeTotal, "")}
          deltaPct={app.trend?.stakeTotalPct}
          intervalDays={app.trend?.intervalDays}
        />
        <Stat
          label="Views"
          value={formatNumber(app.viewCount)}
          deltaPct={app.trend?.viewCountPct}
          intervalDays={app.trend?.intervalDays}
        />
      </div>
      {!preview && (
        <div className="border-t border-hairline p-4 pt-0">
          <div className="pt-3">
            <CardVoteButton appId={app.id} voteWeight={app.voteWeight} />
          </div>
        </div>
      )}
```

`preview` (the `CreateAppForm` live-preview mode) skips the vote button
since a preview app has no real `app.id` to vote against yet.

**Step 4: Verify**

```bash
cd app && npm run typecheck && npm run lint
```

Manual check in dev server: on Browse, each card shows a vote count button
+ "•••" custom-amount affordance; clicking the count (while a wallet is
connected in simulation mode) increments the shown count immediately and a
toast confirms; clicking without a connected wallet opens the wallet
picker instead of erroring.

**Step 5: Commit**

```bash
git add app/src/components/app/CardVoteButton.tsx app/src/components/AppCard.tsx
git commit -m "feat: add an inline quick-vote action to AppCard"
```

---

### Task 9: Add a dismissible onboarding banner to Browse

**Files:**
- Create: `app/src/components/discover/OnboardingBanner.tsx`
- Modify: `app/src/components/discover/Discover.tsx`

**Step 1: Create `OnboardingBanner.tsx`**

```tsx
"use client";

import { useEffect, useState } from "react";

const STORAGE_KEY = "nebulous-onboarding-dismissed";

/**
 * A compact, dismissible first-visit explainer shown above the Browse grid
 * — replaces relying on a separate About page for onboarding (see
 * docs/plans/2026-07-19-light-redesign-design.md). Renders nothing until
 * the localStorage check resolves client-side, so it never flashes for a
 * returning visitor.
 */
export function OnboardingBanner() {
  const [dismissed, setDismissed] = useState(true);

  useEffect(() => {
    setDismissed(window.localStorage.getItem(STORAGE_KEY) === "1");
  }, []);

  if (dismissed) return null;

  function dismiss() {
    window.localStorage.setItem(STORAGE_KEY, "1");
    setDismissed(true);
  }

  return (
    <div className="card flex flex-col gap-3 border-cobalt/30 bg-indigo-soft p-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="grid gap-3 text-sm text-ink sm:grid-cols-3 sm:gap-6">
        <p><strong className="font-semibold">What this is —</strong> crowd-sourced app discovery, ranked transparently.</p>
        <p><strong className="font-semibold">How ranking works —</strong> token-weighted votes, tag stake, and real traffic.</p>
        <p><strong className="font-semibold">How to join in —</strong> connect a wallet, then vote on any app card.</p>
      </div>
      <button
        type="button"
        onClick={dismiss}
        className="btn-ghost shrink-0 self-end px-3 py-1.5 text-xs sm:self-center"
      >
        Got it
      </button>
    </div>
  );
}
```

**Step 2: Wire it into `Discover.tsx`**

Add the import:

```ts
import { OnboardingBanner } from "@/components/discover/OnboardingBanner";
```

Insert it right after the `<PageHeader ... />` in the returned JSX:

```tsx
      <PageHeader
        title="Browse apps"
        description="Ranked by the crowd — token-weighted votes, tag stake, and real traffic."
      />

      <OnboardingBanner />
```

(Also updates the page title from "Discover the best apps" to "Browse
apps" — matching the renamed nav label, see Task 5.)

**Step 3: Verify**

```bash
cd app && npm run typecheck && npm run lint
```

Manual check: on first load (clear `localStorage` or use a private window),
the banner appears above the search bar; "Got it" dismisses it and a page
reload keeps it dismissed.

**Step 4: Commit**

```bash
git add app/src/components/discover/OnboardingBanner.tsx app/src/components/discover/Discover.tsx
git commit -m "feat: add a dismissible onboarding banner to Browse"
```

---

### Task 10: Restyle `ForceMap`'s canvas rendering for the light theme

**Files:**
- Modify: `app/src/components/explore/ForceMap.tsx`
- Check: `app/src/components/explore/GroupMap.tsx` (may share the same
  constants — verify during this task, don't assume)

**Step 1: Replace the color constants block**

Replace:

```ts
// DESIGN.md tokens (see globals.css/tailwind.config.ts): plasma blue for
// nodes/edges, ultraviolet for the selection ring, gunmetal/steel for
// dimmed/muted states — the map already sat on a dark backdrop before
// Astro formalized these as the app-wide palette.
const NODE_FILL = "#3aa8ff";
const NODE_FILL_DIM = "#666c7a";
const EDGE_STROKE = "#2f3dff";
const LABEL_INK = "#f2f6fa";
const LABEL_DIM = "#9aa0ac";
const SELECTED_RING = "#9a9dff";
// Local dark-glass chip styling for this component's own metric pickers —
// deliberately not the shared `.chip`/`.chip-active` classes, which read
// current-theme tokens but assume an opaque card surface behind them,
// unlike this canvas overlay's translucent glass panel.
const DARK_CHIP =
  "inline-flex items-center gap-1 rounded-pill border border-white/15 bg-white/5 px-2.5 py-1 text-xs text-white/70 transition-[color,background-color,border-color,transform] duration-150 hover:bg-white/10 active:scale-[0.96]";
const DARK_CHIP_ACTIVE = "border-[#3aa8ff]/60 bg-[#3aa8ff]/15 text-white";
```

with:

```ts
// DESIGN.md tokens (see globals.css/tailwind.config.ts): indigo for
// nodes/edges, a darker indigo for the selection ring, border/muted-ink for
// dimmed states — restyled for the light canvas, same values used
// elsewhere in the app rather than one-off hex.
const NODE_FILL = "#4338ca";
const NODE_FILL_DIM = "#d1d3da";
const EDGE_STROKE = "#a5a8b8";
const LABEL_INK = "#0d0e12";
const LABEL_DIM = "#565a66";
const SELECTED_RING = "#372fb0";
// Local light-glass chip styling for this component's own metric pickers —
// deliberately not the shared `.chip`/`.chip-active` classes, which assume
// an opaque card surface behind them, unlike this canvas overlay's
// translucent panel over the map background.
const DARK_CHIP =
  "inline-flex items-center gap-1 rounded-pill border border-hairline bg-cream/80 px-2.5 py-1 text-xs text-slate transition-colors duration-150 hover:bg-cream active:opacity-80";
const DARK_CHIP_ACTIVE = "border-cobalt/50 bg-indigo-soft text-cobalt";
```

(Variable names `NODE_FILL`, `DARK_CHIP`, etc. are kept as-is even though
"dark" is no longer accurate, to keep this diff minimal — renaming them is
optional cleanup, not required for the redesign. If you do rename them,
update every reference in this file consistently.)

**Step 2: Find and update the canvas background fill**

Search this file for wherever the canvas clears/fills its background before
drawing nodes (likely a `ctx.fillStyle = ...; ctx.fillRect(...)` near the
top of the draw/render function, or a CSS class on the `<canvas>`/wrapper
element itself, e.g. `bg-abyss` or a raw hex). Change it to `#f7f7f8`
(Surface) if it's a raw hex in the canvas drawing code, or to `bg-ivory` if
it's a Tailwind class on the wrapping element — inspect the actual code
before editing, don't guess blindly.

**Step 3: Check `GroupMap.tsx` for the same pattern**

```bash
grep -n "fillStyle\|strokeStyle\|#[0-9a-fA-F]\{6\}\|DARK_CHIP" app/src/components/explore/GroupMap.tsx
```

If it defines its own color constants (rather than importing from
`ForceMap.tsx`), apply the same old→new mapping from Step 1 to whatever it
finds there.

**Step 4: Verify**

```bash
cd app && npm run typecheck && npm run lint
```

Manual check in dev server: open Rankings (Task 13) → Map view tab (or
temporarily `/explore` if Task 13 isn't done yet) and confirm the canvas
now renders on a light background with indigo nodes/edges and legible dark
labels, not white text on a now-invisible-to-itself light background.

**Step 5: Commit**

```bash
git add app/src/components/explore/ForceMap.tsx app/src/components/explore/GroupMap.tsx
git commit -m "feat: restyle the constellation maps' canvas rendering for the light theme"
```

---

### Task 11: Update `MetricTrendCard` and `PlatformMetrics` chart colors

**Files:**
- Modify: `app/src/components/explore/MetricTrendCard.tsx`

**Step 1: Update the stale comment and `TICK_STYLE`**

Replace:

```ts
// DESIGN.md tokens (see tailwind.config.ts): ivory=carbon, hairline=gunmetal,
// slate=steel, ink=lunar white, forest=aurora mint — same values this card
// used under a component-scoped "astro-" prefix before the whole site
// adopted them.
```

```ts
const TICK_STYLE = { fontSize: 9, fill: "#9aa0ac" };
```

with:

```ts
// DESIGN.md tokens (see tailwind.config.ts): ivory=surface, hairline=border,
// slate=ink muted, ink=primary text, cobalt=indigo — the light-theme values
// of the same named tokens this card has always read from.
```

```ts
const TICK_STYLE = { fontSize: 9, fill: "#565a66" };
```

**Step 2: Update the chart's accent color**

The trend line used aurora mint (`#2ef7c6`) as a generic accent regardless
of whether the metric was a "gain" — replace with Indigo, the new system's
one accent, in both the gradient stops and the `Area`/cursor colors.
Replace every occurrence of `#2ef7c6` in this file (there are three: the
`linearGradient` stops and the `Area`'s `stroke`, plus the `Tooltip`
cursor's `stroke`) with `#4338ca`.

**Step 3: Leave `ChartTooltip` as-is** — its dark popover
(`bg-black/80`/white text) is a deliberately high-contrast micro-UI
independent of page theme, a common pattern even on light pages (like a
native OS tooltip). Not a redesign target.

**Step 4: Verify**

```bash
cd app && npm run typecheck && npm run lint
```

**Step 5: Commit**

```bash
git add app/src/components/explore/MetricTrendCard.tsx
git commit -m "feat: restyle MetricTrendCard's chart accent for the light theme"
```

---

### Task 12: Build the Leaderboard table

**Files:**
- Create: `app/src/components/rankings/Leaderboard.tsx`

**Step 1: Read `lib/types.ts`'s `AppDTO`/`SearchResult` and
`lib/indexerClient.ts`'s `searchApps`** (already read during planning —
`AppDTO` has `rankScore`, `voteWeight`, `stakeTotal`, `viewCount`, and an
optional `trend` with `*Pct`/`intervalDays`; `searchApps(input)` accepts a
`sort` of `"rank" | "votes" | "stake" | "traffic" | "new" | "trending_week"
| "trending_month"`).

**Step 2: Create `Leaderboard.tsx`**

A client component so column-sort clicks don't require a full navigation —
it takes the already-fetched top-N apps as a prop (the Rankings page fetches
them server-side) and only re-sorts client-side among that fixed set, same
data different order, rather than re-fetching per column click.

```tsx
"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import type { AppDTO } from "@/lib/types";
import { formatToken, formatNumber, hostname, cn, formatDelta } from "@/lib/utils";

type SortKey = "rank" | "voteWeight" | "stakeTotal" | "viewCount";

const COLUMNS: { key: SortKey; label: string }[] = [
  { key: "rank", label: "Rank" },
  { key: "voteWeight", label: "Votes" },
  { key: "stakeTotal", label: "Staked" },
  { key: "viewCount", label: "Views" },
];

function DeltaCell({ deltaPct, intervalDays }: { deltaPct?: number | null; intervalDays?: number }) {
  const delta = intervalDays != null ? formatDelta(deltaPct ?? null, intervalDays) : null;
  if (!delta) return <span className="text-slate-steel">—</span>;
  return (
    <span className={cn("tabular-nums", (deltaPct ?? 0) >= 0 ? "text-forest" : "text-negative")}>
      {delta}
    </span>
  );
}

/**
 * A dense, sortable leaderboard — the same underlying app data as the
 * Browse grid, in a comparison-friendly tabular form. Lives on the
 * Rankings page's default tab (see docs/plans/2026-07-19-light-redesign-design.md).
 */
export function Leaderboard({ apps }: { apps: AppDTO[] }) {
  const [sortKey, setSortKey] = useState<SortKey>("rank");
  const [sortDesc, setSortDesc] = useState(true);

  const sorted = useMemo(() => {
    const copy = [...apps];
    copy.sort((a, b) => {
      const av = sortKey === "rank" ? a.rankScore : a[sortKey];
      const bv = sortKey === "rank" ? b.rankScore : b[sortKey];
      return sortDesc ? bv - av : av - bv;
    });
    return copy;
  }, [apps, sortKey, sortDesc]);

  function onSort(key: SortKey) {
    if (key === sortKey) {
      setSortDesc((d) => !d);
    } else {
      setSortKey(key);
      setSortDesc(true);
    }
  }

  return (
    <div className="card overflow-x-auto p-0">
      <table className="w-full min-w-[640px] text-sm">
        <thead>
          <tr className="border-b border-hairline text-left text-caption uppercase tracking-wide text-slate-steel">
            <th className="px-4 py-3 font-semibold">App</th>
            {COLUMNS.map((c) => (
              <th key={c.key} className="px-4 py-3 font-semibold">
                <button
                  type="button"
                  onClick={() => onSort(c.key)}
                  className={cn(
                    "flex items-center gap-1 transition-colors duration-150 hover:text-ink",
                    sortKey === c.key && "text-cobalt",
                  )}
                >
                  {c.label}
                  {sortKey === c.key && (sortDesc ? "↓" : "↑")}
                </button>
              </th>
            ))}
            <th className="px-4 py-3 font-semibold">7d trend</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((app, i) => (
            <tr key={app.id} className="border-b border-hairline last:border-0 hover:bg-mist">
              <td className="px-4 py-3">
                <Link href={`/app/${app.slug}`} className="flex items-center gap-2 hover:text-cobalt">
                  <span className="w-5 shrink-0 tabular-nums text-slate-steel">{i + 1}</span>
                  <span className="min-w-0">
                    <span className="block truncate font-medium text-ink">{app.name}</span>
                    <span className="block truncate text-xs text-slate-steel">{hostname(app.url)}</span>
                  </span>
                </Link>
              </td>
              <td className="px-4 py-3 tabular-nums text-ink">{app.rankScore.toFixed(2)}</td>
              <td className="px-4 py-3 tabular-nums text-ink">{formatToken(app.voteWeight, "")}</td>
              <td className="px-4 py-3 tabular-nums text-ink">{formatToken(app.stakeTotal, "")}</td>
              <td className="px-4 py-3 tabular-nums text-ink">{formatNumber(app.viewCount)}</td>
              <td className="px-4 py-3">
                <DeltaCell deltaPct={app.trend?.rankScorePct} intervalDays={app.trend?.intervalDays} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
```

**Step 3: Verify**

```bash
cd app && npm run typecheck && npm run lint
```

(This component isn't wired into a page yet — Task 13 does that — so
typecheck/lint is the only check possible here; it'll be visually verified
once mounted.)

**Step 4: Commit**

```bash
git add app/src/components/rankings/Leaderboard.tsx
git commit -m "feat: add a sortable Leaderboard table for the Rankings page"
```

---

### Task 13: Build the Rankings page (replaces Explore)

**Files:**
- Create: `app/src/app/rankings/page.tsx`
- Create: `app/src/components/rankings/RankingsTabs.tsx`
- Modify: `app/src/app/explore/page.tsx` → becomes a redirect
- Modify: `app/src/components/explore/ExploreMaps.tsx` (drop its own
  `PageHeader`-adjacent framing so it composes as one tab's content, not a
  whole page)

**Step 1: Read `app/src/app/rewards/page.tsx` and
`lib/indexerClient.ts`'s `fetchPlatformStats`/trend-fetching pattern**
(already read during planning — `PlatformMetrics` takes `stats` +
five `TrendPoint[]` arrays; check `rewards/page.tsx` for exactly how those
trend arrays are fetched server-side before writing the Rankings page, so
the same fetch pattern is reused rather than invented fresh).

**Step 2: Create `RankingsTabs.tsx`** — the tab bar switching between
Leaderboard (default) and Map view, replacing `ExploreMaps`'s own internal
apps/tags/group tab bar as the page's primary navigation. `ExploreMaps`'s
existing apps/tags/group tabs move one level deeper, inside the "Map view"
tab.

```tsx
"use client";

import { useState } from "react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

type TabKey = "leaderboard" | "map";

const TABS: { key: TabKey; label: string }[] = [
  { key: "leaderboard", label: "Leaderboard" },
  { key: "map", label: "Map view" },
];

/**
 * Rankings' top-level tab bar: Leaderboard is the default/primary view
 * (comparison-friendly tabular data), Map view is the constellation map —
 * demoted from its old status as the whole Explore page to one optional
 * lens here. See docs/plans/2026-07-19-light-redesign-design.md.
 */
export function RankingsTabs({ leaderboard, map }: { leaderboard: ReactNode; map: ReactNode }) {
  const [tab, setTab] = useState<TabKey>("leaderboard");

  return (
    <div className="space-y-4">
      <div role="tablist" aria-label="Rankings view" className="inline-flex gap-1 rounded-navitem border border-hairline bg-mist p-1">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={tab === t.key}
            onClick={() => setTab(t.key)}
            className={cn(
              "rounded-navitem px-4 py-2 text-sm font-medium transition-colors duration-150",
              tab === t.key ? "bg-cream text-ink shadow-rest" : "text-slate hover:text-ink",
            )}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div>{tab === "leaderboard" ? leaderboard : map}</div>
    </div>
  );
}
```

**Step 3: Simplify `ExploreMaps.tsx` for its new role as one tab's content**

It no longer needs its own top-level framing since `RankingsTabs` now owns
the outer tab bar — but its internal apps/tags/group sub-tabs (for which
map to show) stay as-is; only remove anything that assumed it was the
whole page (there wasn't a `PageHeader` inside it per the earlier read, so
this step may be a no-op — confirm by re-reading the current file, don't
remove something that turns out to still be needed).

**Step 4: Create `app/src/app/rankings/page.tsx`**

Mirror `rewards/page.tsx`'s data-fetching pattern for the stats
strip (reuse `PlatformMetrics` — it already renders exactly the "trending/
totals with sparklines" stats strip the design calls for) plus fetch a
rank-sorted app list for the `Leaderboard`:

```tsx
import type { Metadata } from "next";
import { SITE_URL } from "@/lib/constants";
import { PageHeader } from "@/components/PageHeader";
import { PlatformMetrics } from "@/components/rewards/PlatformMetrics";
import { Leaderboard } from "@/components/rankings/Leaderboard";
import { RankingsTabs } from "@/components/rankings/RankingsTabs";
import { ExploreMaps } from "@/components/explore/ExploreMaps";
import { searchApps } from "@/lib/indexerClient";
import { searchSchema } from "@/lib/validation";
// Reuse whatever helper `rewards/page.tsx` uses to fetch fetchPlatformStats
// + the five TrendPoint[] arrays — import and call it exactly the same way
// here rather than duplicating that fetch logic. Check the actual export
// name in app/src/app/rewards/page.tsx before writing this import.

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Rankings",
  description: "See how nebulous.world ranks apps — a live leaderboard plus a map of how apps and tags connect.",
  alternates: { canonical: `${SITE_URL}/rankings` },
};

const LEADERBOARD_SIZE = 50;

export default async function RankingsPage() {
  // Mirror rewards/page.tsx's platform-stats + trend fetch here.
  const [{ apps }] = await Promise.all([
    searchApps(searchSchema.parse({ sort: "rank" })),
  ]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Rankings"
        description="A live leaderboard of every app on nebulous.world, plus a map of how apps and tags connect."
      />

      {/* Platform-wide stats strip — same data/component the Rewards page
          uses (see PlatformMetrics), fetched the same way. */}
      {/* <PlatformMetrics stats={stats} appsTrend={...} ... /> */}

      <RankingsTabs
        leaderboard={<Leaderboard apps={apps.slice(0, LEADERBOARD_SIZE)} />}
        map={<ExploreMaps />}
      />
    </div>
  );
}
```

The `PlatformMetrics` call is left as a commented placeholder with an
explicit instruction rather than guessed-at fetch code, because the exact
trend-fetch helper `rewards/page.tsx` uses wasn't read during planning —
**before implementing this task, open `app/src/app/rewards/page.tsx`,
copy its exact fetch pattern for `stats`/`appsTrend`/`tagsTrend`/
`votesTrend`/`stakeTrend`/`viewsTrend`, and use the same calls here**,
then uncomment and fill in the `<PlatformMetrics ... />` line with those
real values. Don't invent a different fetch path than what Rewards already
uses for the same data.

**Step 5: Turn `app/src/app/explore/page.tsx` into a redirect**

Replace its entire contents with:

```tsx
import { redirect, permanentRedirect } from "next/navigation";

// /explore is now /rankings — see docs/plans/2026-07-19-light-redesign-design.md.
// permanentRedirect (308) so search engines transfer ranking signal to the
// new URL instead of indexing both as separate pages.
export default function ExploreRedirect() {
  permanentRedirect("/rankings");
}
```

Check whether `redirect`/`permanentRedirect` needs the unused `redirect`
import removed — only import what's actually called (`permanentRedirect`).

**Step 6: Verify**

```bash
cd app && npm run typecheck && npm run lint && npm run build
```

The build step matters here specifically — Next.js needs to successfully
resolve the new `/rankings` route and the `/explore` redirect at build
time.

Manual check in dev server: `/explore` redirects to `/rankings`; `/rankings`
shows the page header, the platform stats strip, a Leaderboard tab (default,
sortable columns) and a Map view tab (the restyled constellation maps from
Task 10).

**Step 7: Commit**

```bash
git add app/src/app/rankings app/src/app/explore/page.tsx app/src/components/rankings app/src/components/explore/ExploreMaps.tsx
git commit -m "feat: replace Explore with Rankings — stats strip, leaderboard, demoted map tab"
```

---

### Task 14: Sweep remaining components for stale glow/spring/gradient references

**Files:** whatever `grep` in Step 1 turns up — likely candidates:
`app/src/components/discover/FilterPanel.tsx`,
`app/src/components/app/AppMetricsPanel.tsx`,
`app/src/components/app/TagStakePanel.tsx`,
`app/src/components/token/BuyPanel.tsx`,
`app/src/components/rewards/PoolAnalytics.tsx`,
`app/src/components/about/ConstellationField.tsx`,
`app/src/app/about/page.tsx`.

**Step 1: Grep for anything the earlier tasks didn't already cover**

```bash
cd app/src && grep -rn "glow-plasma\|glow-nebula\|glow-mint\|ease-spring\|hero-gradient\|cta-gradient\|nebula-gradient\|plasma-gradient\|translate-y-0\.5\|-translate-y-px\|scale-\[0\.96\]\|animate-pulse-live" .
```

**Step 2: For each match, apply the same principle used throughout this
plan** — drop the lift/scale/glow/spring language, replace with a plain
`transition-colors`/`transition-[background-color,box-shadow]` at
`duration-150 ease-out`, and swap any `shadow-glow-*` for `shadow-hover` (or
drop the shadow if it was hover-only decoration with no real affordance
behind it — use judgment per component, this isn't mechanical enough to
prescribe exact replacement text for files not read during planning).

**Step 3: For `about/page.tsx` specifically** — it's explicitly out of
primary scope (see the design doc's "Out of scope" section is silent on it,
but the brainstorming conversation scoped About as "a deeper reference page,
not a redesign target" beyond the nav rename in Task 5). Only fix outright
breakage (e.g. `bg-mist/60` badges that are now illegible, if any — check
visually, don't assume) — don't do a full restyle pass of this page as part
of this task.

**Step 4: Verify**

```bash
cd app && npm run typecheck && npm run lint
```

**Step 5: Commit**

```bash
git add -A
git commit -m "fix: sweep remaining components for stale glow/spring/gradient references"
```

---

### Task 15: Rewrite DESIGN.md

**Files:**
- Modify: `DESIGN.md` (repo root)

**Step 1: Replace the entire file** using
`docs/plans/2026-07-19-light-redesign-design.md` as content source, but
reformatted to match `DESIGN.md`'s original structure (Tokens — Colors /
Typography / Spacing & Shapes / Motion, Components, Do's and Don'ts,
Surfaces, Imagery, Layout, Similar Brands, Quick Start with CSS custom
properties + Tailwind v4 `@theme` blocks) — the same sections the current
file has, with the light-theme content from the design plan filling each
one in. Use the exact hex values from this implementation plan's "Color
token mapping" table (not the design doc's slightly different named
palette — the token mapping table above is what actually shipped in code,
keep `DESIGN.md` truthful to the real values).

**Step 2: Update the "Similar Brands" section** to Linear / Vercel / Stripe
dashboards (per the brainstorming conversation), replacing the old
Uniswap/Linear/Obsidian-graph-view references — Linear stays relevant,
Obsidian's graph view no longer does now that the map is a secondary tab,
not the product's signature visual.

**Step 3: Verify** — read the file back once written and confirm every hex
value matches what Task 1/2/3's actual code changes shipped (spot-check at
least the 5-6 most-used tokens: cream, ivory, ink, cobalt, hairline,
forest/positive).

**Step 4: Commit**

```bash
git add DESIGN.md
git commit -m "docs: rewrite DESIGN.md for the light, data-forward system"
```

---

### Task 16: Full verification pass

**Files:** none (verification only)

**Step 1: Full typecheck/lint/test/build**

```bash
cd app && npm run typecheck && npm run lint && npm run test && npm run build
```

Expected: all pass. `npm run test` isn't expected to have any new failures
from this plan (no pure-logic modules were touched) — a failure here means
something in this plan accidentally touched shared logic, investigate
before proceeding.

**Step 2: Grep for anything left over from the old system**

```bash
cd app/src && grep -rn "pulse-live\|glow-plasma\|glow-nebula\|glow-mint\|ease-spring\b" . | grep -v "cubic-bezier"
```

Expected: no matches (the `ease-spring`/`out-smooth` timing-function *keys*
still exist in `tailwind.config.ts` by design — Task 1 kept them defined
but flattened their values — so this grep should only flag literal
leftover class usages, not the config itself).

**Step 3: Manual walkthrough in the dev server**

```bash
cd app && npm run dev
```

Visit and check each of:
- `/` (Browse) — onboarding banner, search, filters, app grid with
  quick-vote buttons on cards, all light-themed.
- `/rankings` — stats strip, sortable Leaderboard, Map view tab with the
  restyled constellation map.
- `/explore` — redirects to `/rankings`.
- `/rewards` — still renders correctly (token repaint only, no direct
  edits this plan made here beyond the global token change).
- `/about` — still renders (no full restyle per Task 14 Step 3, but
  confirm nothing is actually broken/illegible).
- An individual `/app/[slug]` page — `VotePanel`'s existing form still
  works with the new tokens.
- Open the "Create app" modal from Browse — confirm the dark scrim (Task 7)
  actually dims the page behind it.

**Step 4: No commit for this task** — it's verification-only. If Step 1–3
turn up any issues, fix them as part of whichever earlier task they belong
to (or a small follow-up commit) rather than accumulating fixes here.

---

## Out of scope for this plan

Same as the design doc: no dark mode toggle, no changes to on-chain
program/indexer/ranking math. Additionally, out of scope for
*implementation* specifically: a full pixel-level restyle of the About
page's WebGL constellation hero (`ConstellationField.tsx`) — it's a
decorative background component with its own bespoke shader, not a
token-driven surface, and reworking it is a bigger, separate effort than
this token-repaint-plus-restructure pass.
