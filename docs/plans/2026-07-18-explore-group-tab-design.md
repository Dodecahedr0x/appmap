# Explore "Group" tab — circle-packing tag hierarchy

Set via `/goal` for autonomous, unattended execution — decisions below were
made directly against codebase conventions rather than through interactive
back-and-forth, per the goal hook's instruction not to block on the user.

## What

A third tab on the Explore page's maps panel (`ExploreMaps.tsx`, alongside
`Apps` and `Tags`), inspired by https://observablehq.com/@d3/pack/2: a
static D3 circle-packing layout where

- **outer circles** = each app's single most globally-common tag
- **inner circles** = the next-most-common tag among apps that already share
  every enclosing circle's tag (so a circle's tag set is always "all of its
  parent's tags plus one")
- **leaf/full nodes** = individual apps, nested inside the circle for the
  exact set of tags they carry

## Why a synthetic hierarchy

The `Tag` table is flat — no `parentId`/category field (confirmed against
`indexer/migrations/005_app_schema.sql`). The requested containment
hierarchy doesn't exist in the data model, so it's derived: sort all tags by
global `appCount` descending (ties broken by name for determinism), then for
each app, take its own tags in that same global order — that ordered list
*is* the app's path from outer circle to leaf. Building a trie over every
app's path naturally satisfies "each child has all its parent's tags plus
one," with no schema change and no new stored hierarchy to keep in sync.

Apps with zero tags fall into a synthetic `"untagged"` root bucket rather
than being dropped, so the visualization accounts for every approved app.

## Data source — new indexer endpoint

`tag_graph`/`app_graph` already precompute full, unpaginated graphs for
Explore's other two tabs (small-platform scale, same query shape). Reusing
`GET /api/apps` (search, capped at `pageSize<=50`) or `/api/apps/related`
isn't a fit — the pack needs *every* approved app's *full* tag list at once,
not a page of full `AppDTO` records.

New: `GET /tags/pack` on the indexer (`indexer/src/handlers/platform.rs`,
next to `tag_graph`), proxied at `app/src/app/api/tags/pack/route.ts`:

```ts
interface TagPack {
  tags: { slug: string; name: string; appCount: number; stake: number }[];
  apps: { slug: string; name: string; stake: number; tagSlugs: string[] }[];
}
```

Same underlying query as `tag_graph` (join `AppTag`/`Tag`/`App` where
`status = 'approved'`), grouped by app instead of collapsed into edges.

## Tree building — pure client-side function

`app/src/lib/tagPack.ts` — `buildTagPackTree(pack: TagPack): PackNode`, unit
tested (this repo uses colocated `*.test.ts` + vitest). No new runtime
dependency for the tree walk itself; `d3-hierarchy` (new dependency, next to
existing `d3-force`) turns the resulting nested object into `d3.pack()`
layout circles.

## Component — `GroupMap.tsx`

New file in `app/src/components/explore/`, siblings with `AppMap`/`TagMap`.
Unlike those, this is a **static SVG layout**, not a canvas force
simulation — circle packing has no physics step, so SVG (declarative,
simpler hit-testing, no rAF loop needed) is the better fit, not a reuse of
`ForceMap`.

- Fetch `/api/tags/pack`, build the tree, lay out with
  `d3.hierarchy(root).sum(leafValue).sort(...)` + `d3.pack()`.
- Depth-based fill using the existing dark-map palette
  (`#54b9ff` plasma blue → `#acafff` ultraviolet progression), same
  hover/selection visual language as `ForceMap` (glow ring, dim non-focus).
- Click a tag circle → reuse `MapSelection { kind: "tag", tagSlugs: [that
  tag's slug] }` — passing just that one slug to the existing
  `/api/apps/related?tagSlugs=` (OR-match) is exactly equivalent to "every
  app under this circle," because of how the trie was built (every app
  carrying that tag necessarily routes through this node).
- Click an app leaf → `MapSelection { kind: "app", slugs: [app, ...siblings
  under the same immediate parent circle] }` — mirrors `AppMap`'s
  "selected + neighbors" pattern using its pack-siblings as the neighbor set.
- Same loading/empty/fallback-sample-data conventions as `TagMap`/`AppMap`,
  same `role="img"`/sr-only-list accessibility fallback as `ForceMap` (no
  drag/zoom gestures to replicate here, just click-to-select).

## Wiring

`ExploreMaps.tsx`: `TabKey` gains `"group"`, `TABS` gains an entry, a third
`onSelect` handler builds `MapSelection` directly (GroupMap constructs it
itself, unlike `AppMap`/`TagMap` which hand back a raw `MapNode` +
neighbor-id list for the parent to interpret).
