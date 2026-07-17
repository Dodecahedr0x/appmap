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
            <div className="flex justify-between text-sm text-ink">
              <label htmlFor={`slider-${s.key}`}>{s.label}</label>
              <span className="tabular-nums text-slate">
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
              className="w-full accent-cobalt"
            />
          </div>
        ))}
      </div>

      <div className="card flex flex-col justify-center gap-4 p-6">
        <div className="rank-score-target">
          <div className="text-caption font-semibold uppercase tracking-wide text-slate">
            Rank score
          </div>
          <div className="text-heading-xl font-bold tabular-nums text-ink">{score.toFixed(3)}</div>
        </div>
        <div aria-hidden="true" className="h-2.5 overflow-hidden rounded-pill bg-hairline">
          <div
            className="h-full rounded-pill bg-cobalt transition-[width]"
            style={{ width: `${pct}%` }}
          />
        </div>
        <p className="rank-annotation max-w-[22ch] text-caption text-slate">
          log-dampened per signal, so no single whale vote or stake can dominate the order.
        </p>
      </div>
    </div>
  );
}
