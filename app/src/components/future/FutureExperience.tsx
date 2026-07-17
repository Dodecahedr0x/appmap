"use client";

import { useEffect } from "react";
import Link from "next/link";
import "./future.css";
import { ShaderHero } from "./ShaderHero";
import { RankingLab } from "./RankingLab";
import { ModeMorph } from "./ModeMorph";
import { Accordion } from "./Accordion";

const STEPS = [
  {
    title: "Discover",
    body: "Search apps by tag, category, and chain. Ranking blends votes, stake, traffic, and freshness into one transparent score — the formula is open, not a black box.",
  },
  {
    title: "Vote",
    body: "Commit an SPL token to an app you believe in. Votes are token-weighted and log-dampened, so a whale can tilt the order but never own it outright.",
  },
  {
    title: "Stake a tag",
    body: "Anyone can suggest a tag; stake tokens behind the tags you think fit. Stake boosts that app's rank and entitles you to a slice of its ad revenue.",
  },
  {
    title: "Earn",
    body: "Each settlement epoch, ad revenue from an app's traffic is split — 10% protocol fee, the rest paid out to stakers proportional to their stake.",
  },
];

const FAQ = [
  {
    q: "Why on-chain at all?",
    a: "Votes and stakes are financial signals — moving real value makes ranking manipulation costly. The Anchor program (programs/nebulous_world) enforces the vote/stake/withdraw rules directly, so the rules aren't just policy, they're code.",
  },
  {
    q: "Do I need a wallet to try it?",
    a: "No — leave NEXT_PUBLIC_VOTE_TOKEN_MINT unset and the product runs in simulation mode: identical flows, recorded off-chain. Set a real SPL mint and deploy the program to flip to on-chain mode.",
  },
  {
    q: "How is ad revenue actually split?",
    a: "Gross ad revenue for an app's page is reduced by a 10% protocol fee, then the remainder is divided pro-rata across everyone staked on that app — across all of its tags — by stake weight.",
  },
];

const BUILT_WITH = [
  "WebGL2 fragment shaders",
  "CSS scroll-driven animations",
  "@property + animated gradients",
  "CSS anchor positioning",
  "Houdini paint worklets",
  "View Transitions API",
  "color-mix()",
  "Subgrid",
  "Container queries",
  ":has() selector",
  "text-wrap: balance / pretty",
];

export function FutureExperience() {
  useEffect(() => {
    const withPaintWorklet = CSS as typeof CSS & {
      paintWorklet?: { addModule: (url: string) => Promise<void> };
    };
    if (withPaintWorklet.paintWorklet) {
      withPaintWorklet.paintWorklet.addModule("/future-paint-worklet.js").catch(() => {});
    }
  }, []);

  return (
    <div className="future-root space-y-16">
      <section className="reveal">
        <div
          className="hero-canvas-wrap relative overflow-hidden rounded-card border border-hairline"
          style={{ minHeight: "clamp(26rem, 60vw, 34rem)" }}
        >
          <ShaderHero />
          <div className="hero-content flex h-full min-h-[inherit] flex-col justify-center p-8 sm:p-14">
            <div className="future-eyebrow">nebulous.world · the future of app discovery</div>
            <h1 className="future-h1 mt-4">The app store, rebuilt in the open.</h1>
            <div className="gradient-rule my-6" />
            <p className="future-lede">
              No algorithm you can&apos;t see. Ranking is votes, stake, traffic, and freshness —
              in the open, in code, settled on Solana. This page is itself a small demo of where
              the web is headed: WebGL2 shaders, scroll-driven CSS, and live product data, no
              build step beyond what your browser already ships.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link href="/" className="btn-primary">
                Explore nebulous.world →
              </Link>
              <Link href="/explore" className="btn-secondary">
                Explore the data
              </Link>
            </div>
          </div>
        </div>
      </section>

      <div className="paint-divider" />

      <section className="reveal">
        <div className="future-eyebrow">The problem</div>
        <h2 className="future-h2 mt-3 max-w-[24ch]">
          Most app stores rank by who pays, not by who&apos;s good.
        </h2>
        <p className="future-lede mt-4">
          nebulous.world flips that: the ranking inputs are public, the weights are public
          (<code>src/lib/ranking.ts</code>), and anyone staking behind a tag is putting real value
          behind their judgment — and getting paid when they&apos;re right.
        </p>
      </section>

      <div className="paint-divider" />

      <section className="reveal">
        <div className="future-eyebrow">How it works</div>
        <h2 className="future-h2 mt-3">Four steps, one open loop.</h2>
        <div className="step-rail mt-10">
          {STEPS.map((s, i) => (
            <div key={s.title} className="step-card">
              <span className="step-index">{String(i + 1).padStart(2, "0")}</span>
              <span className="step-title">{s.title}</span>
              <span className="step-body">{s.body}</span>
            </div>
          ))}
        </div>
      </section>

      <div className="paint-divider" />

      <section className="reveal">
        <div className="future-eyebrow">Ranking lab</div>
        <h2 className="future-h2 mt-3">Move the real inputs. Watch the real score.</h2>
        <p className="future-lede mb-10 mt-3">
          This isn&apos;t a mock chart — it calls the exact <code>computeRankScore</code> function
          that ranks every app in production.
        </p>
        <RankingLab />
      </section>

      <div className="paint-divider" />

      <section className="reveal">
        <div className="future-eyebrow">Tag constellation</div>
        <h2 className="future-h2 mt-3">Apps don&apos;t live in one category.</h2>
        <p className="future-lede mt-3">
          A live d3-force simulation of every tag, sized by total stake and linked by how often
          two tags share an app — now a real part of{" "}
          <Link href="/explore" className="font-medium text-cobalt hover:underline">
            Explore
          </Link>
          , not just a demo here.
        </p>
      </section>

      <div className="paint-divider" />

      <section className="reveal">
        <div className="future-eyebrow">Two ways to run it</div>
        <h2 className="future-h2 mb-10 mt-3">Simulation today, on-chain whenever you&apos;re ready.</h2>
        <ModeMorph />
      </section>

      <div className="paint-divider" />

      <section className="reveal">
        <div className="future-eyebrow">Questions</div>
        <h2 className="future-h2 mb-6 mt-3">Why it&apos;s built this way.</h2>
        <Accordion items={FAQ} />
      </section>

      <div className="ticker-viewport">
        <div className="ticker-track">
          {[...BUILT_WITH, ...BUILT_WITH].map((t, i) => (
            <span key={`${t}-${i}`} className="ticker-item">
              {t}
            </span>
          ))}
        </div>
      </div>

      <section className="pb-8 text-center">
        <h2 className="future-h2 mx-auto">Go rank something.</h2>
        <Link href="/" className="btn-primary mt-8 inline-flex">
          Back to nebulous.world →
        </Link>
      </section>
    </div>
  );
}
