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
      fontFamily: {
        sans: ["var(--font-ui-sans-serif)", "ui-sans-serif", "system-ui", "sans-serif"],
        // No separate display face any more (see DESIGN.md) — `font-display`
        // stays defined (existing headings reference the class) but now
        // resolves to the same Inter stack as body text.
        display: ["var(--font-ui-sans-serif)", "ui-sans-serif", "system-ui", "sans-serif"],
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
        card: "10px",
        icon: "48px",
        pill: "6px",
        image: "8px",
        button: "8px",
        navitem: "6px",
      },
      backgroundImage: {},
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
    },
  },
  plugins: [],
};

export default config;
