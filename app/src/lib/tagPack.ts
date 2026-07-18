import type { TagPack } from "./indexerClient";

// Turns the flat { tags, apps } shape from /api/tags/pack into a nested
// tree for the Explore page's Group (circle-packing) tab. `Tag` has no
// parentId in the schema, so the hierarchy is synthesized: every tag is
// globally ranked by how many apps carry it, and each app's own tags are
// walked in that same order — most-common tag outermost, one tag deeper per
// level, terminating in the app itself once its tags run out. Two apps
// sharing a tag prefix (in that global order) end up nested under the same
// shared node instead of duplicating it, which is what makes "inner circle
// = all of its parent's tags plus one" fall out for free.

export interface PackAppNode {
  type: "app";
  id: string; // app slug
  name: string;
  stake: number;
}

export interface PackTagNode {
  type: "tag";
  id: string; // tag slug ("untagged" for the synthetic no-tags bucket)
  name: string;
  children: PackNode[];
}

export type PackNode = PackTagNode | PackAppNode;

export interface PackRoot {
  children: PackNode[];
}

const UNTAGGED_ID = "untagged";
const UNTAGGED_NAME = "Untagged";

/** Builds the trie described above, sorted (biggest tag groups first) for a deterministic, sensible default layout order. */
export function buildTagPackTree(pack: TagPack): PackRoot {
  const tagMeta = new Map(pack.tags.map((t) => [t.slug, t]));
  // Most globally-common tag first; ties broken by name so the order (and
  // therefore the resulting tree shape) is stable across requests.
  const globalOrder = [...pack.tags].sort(
    (a, b) => b.appCount - a.appCount || a.name.localeCompare(b.name),
  );
  const orderIndex = new Map(globalOrder.map((t, i) => [t.slug, i]));

  const root: PackTagNode = { type: "tag", id: "__root__", name: "", children: [] };
  const childrenByParent = new Map<PackTagNode, Map<string, PackTagNode>>();

  function tagChild(parent: PackTagNode, slug: string): PackTagNode {
    let byId = childrenByParent.get(parent);
    if (!byId) {
      byId = new Map();
      childrenByParent.set(parent, byId);
    }
    let node = byId.get(slug);
    if (!node) {
      const name = slug === UNTAGGED_ID ? UNTAGGED_NAME : (tagMeta.get(slug)?.name ?? slug);
      node = { type: "tag", id: slug, name, children: [] };
      byId.set(slug, node);
      parent.children.push(node);
    }
    return node;
  }

  for (const app of pack.apps) {
    const path =
      app.tagSlugs.length === 0
        ? [UNTAGGED_ID]
        : [...app.tagSlugs].sort(
            (a, b) => (orderIndex.get(a) ?? Infinity) - (orderIndex.get(b) ?? Infinity) || a.localeCompare(b),
          );
    let node = root;
    for (const slug of path) node = tagChild(node, slug);
    node.children.push({ type: "app", id: app.slug, name: app.name, stake: app.stake });
  }

  sortChildren(root);
  return { children: root.children };
}

// Tag groups (bigger first) before individual apps (higher-staked first) —
// purely a default reading order; d3.pack() itself lays out by area, not
// array position.
function sortChildren(node: PackTagNode) {
  for (const child of node.children) {
    if (child.type === "tag") sortChildren(child);
  }
  node.children.sort((a, b) => {
    if (a.type !== b.type) return a.type === "tag" ? -1 : 1;
    if (a.type === "tag" && b.type === "tag") {
      return countApps(b) - countApps(a) || a.name.localeCompare(b.name);
    }
    return (b as PackAppNode).stake - (a as PackAppNode).stake || a.name.localeCompare(b.name);
  });
}

function countApps(node: PackNode): number {
  if (node.type === "app") return 1;
  return node.children.reduce((sum, c) => sum + countApps(c), 0);
}
