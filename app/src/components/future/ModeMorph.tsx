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
      <div className="mode-card card p-8">
        <div className="future-eyebrow">{active.label}</div>
        <p className="mt-2 text-subheading text-ink">{active.tagline}</p>
        <ul className="mt-4 grid gap-2 text-sm text-slate">
          {active.points.map((p) => (
            <li key={p}>· {p}</li>
          ))}
        </ul>
      </div>
      <button type="button" onClick={toggle} className="btn-primary mt-6">
        Switch to {mode === "simulation" ? "on-chain" : "simulation"} mode
      </button>
    </div>
  );
}
