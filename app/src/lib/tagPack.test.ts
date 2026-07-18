import { describe, it, expect } from "vitest";
import { buildTagPackTree, type PackTagNode } from "./tagPack";
import type { TagPack } from "./indexerClient";

function tagNode(root: ReturnType<typeof buildTagPackTree>, id: string): PackTagNode {
  const node = root.children.find((c) => c.id === id);
  if (!node || node.type !== "tag") throw new Error(`expected a tag node ${id}`);
  return node;
}

describe("buildTagPackTree", () => {
  it("nests a single-tag app one level under the root", () => {
    const pack: TagPack = {
      tags: [{ slug: "defi", name: "DeFi", appCount: 1, stake: 100 }],
      apps: [{ slug: "solend", name: "Solend", stake: 100, tagSlugs: ["defi"] }],
    };
    const root = buildTagPackTree(pack);
    expect(root.children).toHaveLength(1);
    const defi = tagNode(root, "defi");
    expect(defi).toMatchObject({ type: "tag", id: "defi", name: "DeFi" });
    expect(defi.children).toEqual([{ type: "app", id: "solend", name: "Solend", stake: 100 }]);
  });

  it("orders each app's path by global tag popularity, most-common tag outermost", () => {
    // "nft" appears on 2 apps, "gaming" on 1 — an app carrying both should
    // nest under nft (outer) then gaming (inner), regardless of the order
    // its own tagSlugs array lists them in.
    const pack: TagPack = {
      tags: [
        { slug: "nft", name: "NFT", appCount: 2, stake: 0 },
        { slug: "gaming", name: "Gaming", appCount: 1, stake: 0 },
      ],
      apps: [
        { slug: "market", name: "Market", stake: 0, tagSlugs: ["nft"] },
        { slug: "playgame", name: "PlayGame", stake: 0, tagSlugs: ["gaming", "nft"] },
      ],
    };
    const root = buildTagPackTree(pack);
    expect(root.children.map((c) => c.id)).toEqual(["nft"]);
    const nft = tagNode(root, "nft");
    // market (tags=[nft]) is a leaf right under nft; playgame descends one
    // more level into gaming — both coexist as children of the nft node.
    expect(nft.children).toHaveLength(2);
    const market = nft.children.find((c) => c.id === "market");
    expect(market).toMatchObject({ type: "app", id: "market" });
    const gaming = nft.children.find((c) => c.id === "gaming");
    if (!gaming || gaming.type !== "tag") throw new Error("expected gaming tag node");
    expect(gaming.children).toEqual([{ type: "app", id: "playgame", name: "PlayGame", stake: 0 }]);
  });

  it("groups apps that share the same tag prefix under the same node instead of duplicating it", () => {
    const pack: TagPack = {
      tags: [{ slug: "defi", name: "DeFi", appCount: 2, stake: 0 }],
      apps: [
        { slug: "a", name: "A", stake: 0, tagSlugs: ["defi"] },
        { slug: "b", name: "B", stake: 0, tagSlugs: ["defi"] },
      ],
    };
    const root = buildTagPackTree(pack);
    expect(root.children).toHaveLength(1);
    const defi = tagNode(root, "defi");
    expect(defi.children.map((c) => c.id).sort()).toEqual(["a", "b"]);
  });

  it("buckets apps with no tags under a synthetic untagged root node", () => {
    const pack: TagPack = {
      tags: [],
      apps: [{ slug: "mystery", name: "Mystery", stake: 5, tagSlugs: [] }],
    };
    const root = buildTagPackTree(pack);
    expect(root.children).toHaveLength(1);
    const untagged = tagNode(root, "untagged");
    expect(untagged.children).toEqual([{ type: "app", id: "mystery", name: "Mystery", stake: 5 }]);
  });

  it("returns an empty tree for an empty pack", () => {
    const root = buildTagPackTree({ tags: [], apps: [] });
    expect(root.children).toEqual([]);
  });
});
