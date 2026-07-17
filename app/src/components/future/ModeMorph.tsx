"use client";

import { useState } from "react";

const MODES = {
  simulation: {
    label: "Simulation mode",
    tagline: "No wallet required — every flow runs off-chain in the database.",
    points: [
      "Votes and stakes are recorded directly in Postgres.",
      "No SPL token mint or Anchor program needed to try the product.",
      "Same ranking + revenue math as on-chain — just no signature.",
    ],
  },
  onchain: {
    label: "On-chain mode",
    tagline: "NEXT_PUBLIC_VOTE_TOKEN_MINT is set — votes are real token transfers.",
    points: [
      "Votes and stakes require a confirmed Solana transaction.",
      "Auth is Sign-In-With-Solana: an ed25519 signature, no password.",
      "The nebulous_world Anchor program enforces stake/vote/withdraw on-chain.",
    ],
  },
} as const;

type ModeKey = keyof typeof MODES;

/**
 * Demonstrates the View Transitions API: toggling between nebulous.world's two real
 * runtime modes (see src/lib/config.ts) morphs the card in place via
 * document.startViewTransition instead of a hard swap. Falls back to an
 * instant state change on browsers without the API.
 */
export function ModeMorph() {
  const [mode, setMode] = useState<ModeKey>("simulation");
  const active = MODES[mode];

  function toggle() {
    const next: ModeKey = mode === "simulation" ? "onchain" : "simulation";
    const apply = () => setMode(next);
    const doc = document as Document & {
      startViewTransition?: (cb: () => void) => void;
    };
    if (typeof doc.startViewTransition === "function") {
      doc.startViewTransition(apply);
    } else {
      apply();
    }
  }

  return (
    <div>
      <div
        className="mode-card"
        style={{
          border: "1px solid var(--edge)",
          borderRadius: 20,
          padding: "2rem",
          background: "color-mix(in oklch, var(--void-deep) 70%, transparent)",
        }}
      >
        <div className="future-eyebrow">{active.label}</div>
        <p style={{ marginTop: "0.5rem", fontSize: "1.0625rem" }}>{active.tagline}</p>
        <ul style={{ marginTop: "1rem", display: "grid", gap: "0.5rem", fontSize: "0.9375rem", opacity: 0.8 }}>
          {active.points.map((p) => (
            <li key={p}>· {p}</li>
          ))}
        </ul>
      </div>
      <button
        type="button"
        onClick={toggle}
        className="future-cta"
        style={{ marginTop: "1.5rem", background: "var(--glow)", color: "var(--void-deep)" }}
      >
        Switch to {mode === "simulation" ? "on-chain" : "simulation"} mode
      </button>
    </div>
  );
}
