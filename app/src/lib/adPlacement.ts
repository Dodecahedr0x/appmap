import { AD_EVERY_N_APPS } from "./constants";

export type GridEntry<T> =
  // `index` is the app's position in the original (non-interleaved) list —
  // callers deriving a rank (e.g. Discover's "#N" badge) need this, and
  // re-deriving it with Array.indexOf at render time would be O(n) per item.
  | { kind: "app"; app: T; index: number }
  | { kind: "ad"; key: string; appId: string };

/**
 * Interleaves one sponsored ad slot after every `every` apps, for rendering
 * a grid of apps (Discover, RelatedApps, …) with periodic ads mixed in —
 * the "one banner every X row" placement. The ad slot after app N is
 * attributed (for revenue-sharing purposes — AdImpression always ties to
 * one app) to that same app N, since a grid has no single "current app" the
 * way an app detail page does.
 *
 * Pure so it's trivial to unit test independent of any rendering.
 */
export function interleaveAds<T extends { id: string }>(
  apps: T[],
  every: number = AD_EVERY_N_APPS,
): GridEntry<T>[] {
  if (every <= 0) return apps.map((app, index) => ({ kind: "app", app, index }));
  const out: GridEntry<T>[] = [];
  apps.forEach((app, i) => {
    out.push({ kind: "app", app, index: i });
    if ((i + 1) % every === 0) {
      out.push({ kind: "ad", key: `ad-${app.id}`, appId: app.id });
    }
  });
  return out;
}
