import { describe, it, expect, beforeEach } from "vitest";
import { prisma } from "./prisma";
import { buildAppGraph } from "./appGraph";

async function makeTag(slug: string) {
  return prisma.tag.create({ data: { slug, name: slug } });
}
async function makeApp(slug: string, overrides: Partial<{ stakeTotal: number; viewCount: number; voteWeight: number }> = {}) {
  return prisma.app.create({
    data: { slug, name: slug, url: "https://example.com", status: "approved", ...overrides },
  });
}

describe("buildAppGraph", () => {
  beforeEach(async () => {
    await prisma.appTag.deleteMany();
    await prisma.tag.deleteMany();
    await prisma.app.deleteMany();
  });

  it("connects two apps that share a tag and reports their node metrics", async () => {
    const a = await makeApp("app-a", { stakeTotal: 100, viewCount: 50, voteWeight: 10 });
    const b = await makeApp("app-b", { stakeTotal: 40, viewCount: 20, voteWeight: 5 });
    const tag = await makeTag("defi");
    await prisma.appTag.create({ data: { appId: a.id, tagId: tag.id, stakeTotal: 100 } });
    await prisma.appTag.create({ data: { appId: b.id, tagId: tag.id, stakeTotal: 40 } });

    const graph = await buildAppGraph();

    expect(graph.nodes).toEqual(
      expect.arrayContaining([
        { id: "app-a", name: "app-a", stake: 100, views: 50, votes: 10 },
        { id: "app-b", name: "app-b", stake: 40, views: 20, votes: 5 },
      ]),
    );
    expect(graph.edges).toHaveLength(1);
    expect(graph.edges[0].shared).toBe(1); // one shared tag out of one tag each -> union 1
  });

  it("does not connect apps with no shared tags", async () => {
    const a = await makeApp("app-a");
    const b = await makeApp("app-b");
    const tagA = await makeTag("defi");
    const tagB = await makeTag("nft");
    await prisma.appTag.create({ data: { appId: a.id, tagId: tagA.id } });
    await prisma.appTag.create({ data: { appId: b.id, tagId: tagB.id } });

    const graph = await buildAppGraph();

    expect(graph.edges).toHaveLength(0);
    // Isolated apps carry no relational insight for this map, so they're dropped.
    expect(graph.nodes).toHaveLength(0);
  });

  it("excludes apps with no tags entirely", async () => {
    const a = await makeApp("app-a");
    const b = await makeApp("app-b");
    const untagged = await makeApp("app-c");
    const tag = await makeTag("defi");
    await prisma.appTag.create({ data: { appId: a.id, tagId: tag.id } });
    await prisma.appTag.create({ data: { appId: b.id, tagId: tag.id } });
    void untagged;

    const graph = await buildAppGraph();

    expect(graph.nodes.map((n) => n.id).sort()).toEqual(["app-a", "app-b"]);
  });

  it("weights shared-tag similarity by stake, favoring heavily-staked overlap", async () => {
    // app-a carries both tags; app-b only shares the heavily-staked one,
    // app-c only shares the barely-staked one. Plain tag overlap (`shared`)
    // is identical for both pairs (1 tag in common out of 2), but the
    // stake-weighted metric should clearly favor the app-a/app-b pair.
    const a = await makeApp("app-a", { stakeTotal: 1001 });
    const b = await makeApp("app-b", { stakeTotal: 1000 });
    const c = await makeApp("app-c", { stakeTotal: 1 });
    const hot = await makeTag("hot"); // heavily staked shared tag
    const cold = await makeTag("cold"); // barely staked shared tag

    await prisma.appTag.create({ data: { appId: a.id, tagId: hot.id, stakeTotal: 1000 } });
    await prisma.appTag.create({ data: { appId: b.id, tagId: hot.id, stakeTotal: 1000 } });

    await prisma.appTag.create({ data: { appId: a.id, tagId: cold.id, stakeTotal: 1 } });
    await prisma.appTag.create({ data: { appId: c.id, tagId: cold.id, stakeTotal: 1 } });

    const graph = await buildAppGraph();

    const abEdge = graph.edges.find(
      (e) => (e.source === "app-a" && e.target === "app-b") || (e.source === "app-b" && e.target === "app-a"),
    );
    const acEdge = graph.edges.find(
      (e) => (e.source === "app-a" && e.target === "app-c") || (e.source === "app-c" && e.target === "app-a"),
    );

    // Both pairs share exactly one tag out of one tag each, so `shared` (plain
    // Jaccard) is identical — but `weighted` should favor the heavily-staked
    // overlap, since it's a weighted Jaccard (Ruzicka similarity) over stake.
    expect(abEdge?.shared).toBe(acEdge?.shared);
    expect(abEdge!.weighted).toBeGreaterThan(acEdge!.weighted);
  });
});
