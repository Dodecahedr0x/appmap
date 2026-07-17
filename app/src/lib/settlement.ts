// Bridges real (aggregate, periodic) AdSense earnings to per-app gross
// revenue by allocating proportional to each app's CAPTCHA-verified,
// revenue-eligible traffic share. This is an allocation model, not exact
// per-impression truth — see docs/plans/2026-07-16-appmap-design.md §4.
//
// Deliberately distinct from ranking's viewCount: ranking counts ALL traffic
// (every visit should still boost visibility), while this only counts
// revenue-eligible (Turnstile-verified) views — only CAPTCHA-verified
// traffic should earn money. Callers must filter their PageView query by
// `revenueEligible: true` before building the `AppTraffic[]` input here.

export interface AppTraffic {
  appId: string;
  eligibleViews: number;
}

export interface AppAllocation {
  appId: string;
  gross: number;
}

export function allocateByTrafficShare(
  totalEarnings: number,
  traffic: AppTraffic[],
): AppAllocation[] {
  const totalViews = traffic.reduce((sum, t) => sum + Math.max(0, t.eligibleViews), 0);
  if (totalViews <= 0) {
    return traffic.map((t) => ({ appId: t.appId, gross: 0 }));
  }
  return traffic.map((t) => ({
    appId: t.appId,
    gross: Math.round(((totalEarnings * Math.max(0, t.eligibleViews)) / totalViews) * 1e9) / 1e9,
  }));
}
