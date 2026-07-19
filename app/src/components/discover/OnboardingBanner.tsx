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
    try {
      setDismissed(window.localStorage.getItem(STORAGE_KEY) === "1");
    } catch {
      // localStorage can throw (Safari private browsing, storage-blocking
      // policies, sandboxed iframes) — fail safe by leaving the banner
      // hidden rather than crashing the route.
    }
  }, []);

  if (dismissed) return null;

  function dismiss() {
    try {
      window.localStorage.setItem(STORAGE_KEY, "1");
    } catch {
      // Non-critical: the dismissal just won't persist across visits.
    }
    setDismissed(true);
  }

  return (
    <div className="card flex flex-col gap-3 border-cobalt/30 bg-indigo-soft p-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="grid gap-3 text-sm text-ink sm:grid-cols-3 sm:gap-6">
        <p><strong className="font-semibold">What this is —</strong> crowd-sourced app discovery, ranked transparently.</p>
        <p><strong className="font-semibold">How ranking works —</strong> staking a tag boosts its apps and earns you a cut of ad revenue.</p>
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
