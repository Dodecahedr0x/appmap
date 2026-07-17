"use client";

import { useMemo, useState } from "react";
import { computeRankScore, RANK_WEIGHTS } from "@/lib/ranking";

const SLIDERS = [
  {
    key: "voteWeight" as const,
    label: "Token-weighted votes",
    min: 0,
    max: 50000,
    step: 250,
    weight: RANK_WEIGHTS.vote,
  },
  {
    key: "stakeTotal" as const,
    label: "Total tag stake",
    min: 0,
    max: 50000,
    step: 250,
    weight: RANK_WEIGHTS.stake,
  },
  {
    key: "viewCount" as const,
    label: "Lifetime page views",
    min: 0,
    max: 200000,
    step: 1000,
    weight: RANK_WEIGHTS.traffic,
  },
  {
    key: "ageDays" as const,
    label: "App age (days)",
    min: 0,
    max: 120,
    step: 1,
    weight: null,
  },
];

/**
 * Live ranking calculator running the exact `computeRankScore` used in
 * production (src/lib/ranking.ts) — moving these sliders is moving the real
 * formula, not a mocked-up chart.
 */
export function RankingLab() {
  const [inputs, setInputs] = useState({
    voteWeight: 8000,
    stakeTotal: 4000,
    viewCount: 30000,
    ageDays: 5,
  });

  const score = useMemo(() => computeRankScore(inputs), [inputs]);
  const maxScore = useMemo(
    () =>
      computeRankScore({
        voteWeight: 50000,
        stakeTotal: 50000,
        viewCount: 200000,
        ageDays: 0,
      }),
    [],
  );
  const pct = Math.min(100, (score / maxScore) * 100);

  return (
    <div className="future-grid-2">
      <div>
        {SLIDERS.map((s) => (
          <div key={s.key} className="slider-row">
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.875rem" }}>
              <label htmlFor={`slider-${s.key}`}>{s.label}</label>
              <span style={{ opacity: 0.6, fontVariantNumeric: "tabular-nums" }}>
                {inputs[s.key].toLocaleString()}
                {s.weight !== null ? ` · ×${s.weight}` : " · half-life 14d"}
              </span>
            </div>
            <input
              id={`slider-${s.key}`}
              type="range"
              min={s.min}
              max={s.max}
              step={s.step}
              value={inputs[s.key]}
              onChange={(e) =>
                setInputs((prev) => ({ ...prev, [s.key]: Number(e.target.value) }))
              }
              style={{ width: "100%", accentColor: "var(--cobalt)" }}
            />
          </div>
        ))}
      </div>

      <div style={{ display: "flex", flexDirection: "column", justifyContent: "center", gap: "1rem" }}>
        <div className="rank-score-target">
          <div style={{ fontSize: "0.8125rem", opacity: 0.6, letterSpacing: "0.08em", textTransform: "uppercase" }}>
            Rank score
          </div>
          <div style={{ fontSize: "clamp(2.5rem, 6vw, 4rem)", fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>
            {score.toFixed(3)}
          </div>
        </div>
        <div
          aria-hidden="true"
          style={{
            height: "10px",
            borderRadius: "999px",
            background: "color-mix(in oklch, var(--paper) 12%, transparent)",
            overflow: "hidden",
          }}
        >
          <div
            style={{
              height: "100%",
              width: `${pct}%`,
              background: "linear-gradient(90deg, var(--cobalt), var(--violet))",
              transition: "width 0.25s ease",
            }}
          />
        </div>
        <p className="rank-annotation" style={{ fontSize: "0.8125rem", opacity: 0.65, maxWidth: "22ch" }}>
          log-dampened per signal, so no single whale vote or stake can dominate the order.
        </p>
      </div>
    </div>
  );
}
