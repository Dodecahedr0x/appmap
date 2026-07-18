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
        // Dock style reference — sunlit cream paper, cobalt pulse.
        cream: "#faf9f7",
        ivory: "#fbfaf7",
        mist: "#f4f0ff",
        powder: "#d6e4f1",
        ink: {
          DEFAULT: "#121722",
          deep: "#1d1d1d",
          graphite: "#2d2d2d",
        },
        slate: {
          DEFAULT: "#777c86",
          steel: "#a5a5a5",
        },
        hairline: "#efefef",
        faint: "#cccccc",
        cobalt: {
          DEFAULT: "#0068f9",
          deep: "#024bb1",
        },
        cerulean: "#0074dd",
        violet: "#6736eb",
        forest: "#046645",
        // Astro style reference (DESIGN.md) — deep space, single mint accent.
        // Scoped to the Explore metric cards for now (the "astro-" prefix
        // keeps it from colliding with Dock's own `mist` token, a different
        // color under the same name), not a site-wide theme swap.
        astro: {
          abyss: "#0c0f19",
          gunmetal: "#545864",
          lunar: "#f2f6fa",
          steel: "#858b98",
          mint: "#4bf3c8",
        },
      },
      fontFamily: {
        sans: ["var(--font-roobert)", "ui-sans-serif", "system-ui", "sans-serif"],
        mono: ["ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
      },
      fontSize: {
        caption: ["13px", { lineHeight: "1.5", letterSpacing: "0.077px" }],
        body: ["16px", { lineHeight: "1.56" }],
        subheading: ["18px", { lineHeight: "1.5" }],
        "heading-sm": ["20px", { lineHeight: "1.38" }],
        heading: ["24px", { lineHeight: "1.33" }],
        "heading-lg": ["40px", { lineHeight: "1.25" }],
        "heading-xl": ["48px", { lineHeight: "1.2" }],
        display: ["57px", { lineHeight: "1.09" }],
        "display-lg": ["84px", { lineHeight: "1.06" }],
      },
      spacing: {
        18: "72px",
        88: "88px",
      },
      borderRadius: {
        card: "16px",
        icon: "60px",
        pill: "100px",
        image: "16px",
        button: "48px",
        navitem: "48px",
      },
      boxShadow: {
        subtle:
          "rgba(0, 0, 0, 0.07) 0px 1px 1px 0px, rgba(0, 0, 0, 0.04) 0px -1px 1px 0px inset, rgba(0, 0, 0, 0.14) 0px 0px 0px 0.5px inset",
        lg: "rgba(0, 0, 0, 0.04) 0px 20px 20px -8px",
      },
      backgroundImage: {
        "hero-gradient": "linear-gradient(180deg, #faf9f7 0%, #d5ecff 100%)",
        "cta-gradient":
          "linear-gradient(135deg, #faf9f7 0%, #c8dcf5 60%, #0068f9 100%)",
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
      },
      animation: {
        "fade-in": "fade-in 0.25s ease-out",
        "fade-in-fast": "fade-in-fast 0.15s ease-out",
      },
    },
  },
  plugins: [],
};

export default config;
