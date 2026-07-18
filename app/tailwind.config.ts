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
        // Astro style reference — deep space mission control, purple nebula
        // glow (see DESIGN.md). Names kept from the old "Dock" palette where
        // the *role* carries over, so components that only ever reference
        // these Tailwind classes (bg-cream, text-ink, border-hairline, ...)
        // repaint for free — see globals.css for the few structural changes
        // (white-pill primary button, no shadows) that need their own edit.
        cream: "#1f232e", // was canvas cream → void canvas
        ivory: "#17191e", // was card surface → carbon (mid-elevation card)
        mist: "#0c0f19", // was decorative wash → abyss (deep well/backdrop)
        powder: "#545864", // was outline border → gunmetal
        ink: {
          DEFAULT: "#f2f6fa", // was near-black text → lunar white (now light-on-dark)
          deep: "#060913", // was dark surface fill → singularity
          graphite: "#0c0f19", // was dark surface fill → abyss
        },
        slate: {
          DEFAULT: "#858b98", // was secondary text → steel
          steel: "#bfc1c9", // was muted/placeholder text → mist
        },
        hairline: "#545864", // gunmetal — hairline borders on the dark canvas
        faint: "#e5e7eb", // was subdued icon strokes → platinum
        cobalt: {
          DEFAULT: "#54b9ff", // was primary interactive blue → plasma blue
          deep: "#acafff", // was hover/pressed → ultraviolet
        },
        cerulean: "#00daef", // electric cyan
        violet: "#acafff", // ultraviolet
        forest: "#4bf3c8", // aurora mint
        amber: "#ffd493",
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
          "radial-gradient(circle at 50% 0%, rgba(50, 69, 255, 0.3) 0%, rgba(31, 35, 46, 0) 60%)",
        "cta-gradient": "linear-gradient(83.21deg, #3245ff 0%, #b845ed 100%)",
        "nebula-gradient": "linear-gradient(83.21deg, #3245ff 0%, #b845ed 100%)",
        "plasma-gradient": "linear-gradient(66.77deg, #d83333 0%, #f041ff 100%)",
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
      },
      animation: {
        "fade-in": "fade-in 0.25s ease-out",
        "fade-in-fast": "fade-in-fast 0.15s ease-out",
        "toast-glow-pulse": "toast-glow-pulse 3.5s ease-in-out infinite",
      },
    },
  },
  plugins: [],
};

export default config;
