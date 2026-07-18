import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        // nebulous.world style reference — a living constellation, not a
        // landing page (see DESIGN.md). Names kept stable across the
        // Astro-reference rework so every component that only ever
        // references these Tailwind classes (bg-cream, text-ink,
        // border-hairline, ...) repaints for free — only the underlying hex
        // values moved, deepened for higher contrast against the new
        // near-black void canvas. See globals.css for the reactive
        // hover/press treatment (lift + glow + spring easing) layered on
        // top of these on .btn/.card/.chip.
        cream: "#10121a", // void canvas — deepened from #1f232e
        ivory: "#0d0f16", // carbon — card surface, one step darker than canvas
        mist: "#080911", // abyss — deep well/backdrop
        powder: "#666c7a", // gunmetal — lightened from #545864 for crisper structure
        ink: {
          DEFAULT: "#f2f6fa", // lunar white — unchanged, already max contrast
          deep: "#040509", // singularity — deepest surface
          graphite: "#080911", // abyss
        },
        slate: {
          DEFAULT: "#9aa0ac", // steel — lightened from #858b98 (was borderline-AA)
          steel: "#bfc1c9", // mist — muted/placeholder text
        },
        hairline: "#666c7a", // gunmetal — hairline borders on the dark canvas
        faint: "#e5e7eb", // platinum — subdued icon strokes
        cobalt: {
          DEFAULT: "#3aa8ff", // plasma blue — deepened/more saturated
          deep: "#9a9dff", // ultraviolet — hover/pressed
        },
        cerulean: "#00daef", // electric cyan
        violet: "#9a9dff", // ultraviolet
        forest: "#2ef7c6", // aurora mint — more saturated
        amber: "#ffc670", // deeper amber
        "signal-blue": "#61dafb",
      },
      fontFamily: {
        sans: ["var(--font-ui-sans-serif)", "ui-sans-serif", "system-ui", "sans-serif"],
        display: ["var(--font-obviously)", "var(--font-ui-sans-serif)", "ui-sans-serif", "system-ui", "sans-serif"],
        mono: ["ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
      },
      fontSize: {
        caption: ["12px", { lineHeight: "1.5", letterSpacing: "0.3px" }],
        "body-sm": ["14px", { lineHeight: "1.65" }],
        body: ["16px", { lineHeight: "1.5" }],
        subheading: ["20px", { lineHeight: "1.4" }],
        "heading-sm": ["30px", { lineHeight: "1.2" }],
        heading: ["36px", { lineHeight: "1.11" }],
        "heading-lg": ["36px", { lineHeight: "1.11" }],
        "heading-xl": ["48px", { lineHeight: "1.1" }],
        display: ["48px", { lineHeight: "1.1" }],
        "display-lg": ["48px", { lineHeight: "1.1" }],
      },
      spacing: {
        18: "72px",
        68: "68px",
        88: "88px",
        144: "144px",
        160: "160px",
        224: "224px",
      },
      borderRadius: {
        card: "16px",
        icon: "48px",
        pill: "9999px",
        image: "12px",
        button: "9999px",
        navitem: "9999px",
      },
      backgroundImage: {
        "hero-gradient":
          "radial-gradient(circle at 50% 0%, rgba(47, 61, 255, 0.32) 0%, rgba(16, 18, 26, 0) 60%)",
        "cta-gradient": "linear-gradient(83.21deg, #2f3dff 0%, #c93ff2 100%)",
        "nebula-gradient": "linear-gradient(83.21deg, #2f3dff 0%, #c93ff2 100%)",
        "plasma-gradient": "linear-gradient(66.77deg, #ff3b3b 0%, #ff35fa 100%)",
      },
      // Motion tokens — see DESIGN.md's "Tokens — Motion" section. `spring`
      // is the signature reactive easing (a slight overshoot on settle),
      // used for hover/press feedback; `out-smooth` is for larger,
      // non-bouncy movements (panel entrances, tab swaps).
      transitionTimingFunction: {
        spring: "cubic-bezier(0.34, 1.56, 0.64, 1)",
        "out-smooth": "cubic-bezier(0.16, 1, 0.3, 1)",
      },
      // Tinted ambient glows — interaction FEEDBACK (hover/focus/active),
      // never elevation-at-rest (see DESIGN.md's Do's/Don'ts: this system
      // still has no drop-shadow elevation system). Paired with a lift via
      // `hover:-translate-y-px` on the elements that use these.
      boxShadow: {
        "glow-plasma": "0 0 0 1px rgba(58, 168, 255, 0.4), 0 0 24px rgba(58, 168, 255, 0.25)",
        "glow-nebula": "0 0 0 1px rgba(154, 157, 255, 0.4), 0 0 24px rgba(184, 69, 237, 0.25)",
        "glow-mint": "0 0 0 1px rgba(46, 247, 198, 0.4), 0 0 24px rgba(46, 247, 198, 0.2)",
      },
      keyframes: {
        "fade-in": {
          from: { opacity: "0", transform: "translateY(4px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
        // Opacity-only, no rise — for swapping content in place (e.g. a tab
        // panel) rather than content entering the page from below.
        "fade-in-fast": {
          from: { opacity: "0" },
          to: { opacity: "1" },
        },
        // A slow, quiet breathing pulse — ToastGlow's accent glow.
        "toast-glow-pulse": {
          "0%, 100%": { opacity: "0.5", transform: "scale(0.92)" },
          "50%": { opacity: "0.8", transform: "scale(1.05)" },
        },
        // The general-purpose live-status pulse (DESIGN.md's Motion
        // section) — same breathing shape as toast-glow-pulse, generalized
        // for any "this is actively live right now" dot (connected wallet,
        // unclaimed reward, in-flight transaction). Reserve it for things
        // that are genuinely live — see DESIGN.md's Don'ts.
        "pulse-live": {
          "0%, 100%": { opacity: "0.55", transform: "scale(0.92)" },
          "50%": { opacity: "1", transform: "scale(1.08)" },
        },
      },
      animation: {
        "fade-in": "fade-in 0.25s ease-out",
        "fade-in-fast": "fade-in-fast 0.15s ease-out",
        "toast-glow-pulse": "toast-glow-pulse 3.5s ease-in-out infinite",
        "pulse-live": "pulse-live 2s ease-in-out infinite",
      },
    },
  },
  plugins: [],
};

export default config;
