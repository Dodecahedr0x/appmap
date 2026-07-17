import { describe, it, expect, beforeEach } from "vitest";
import { prisma } from "./prisma";
import { buildTagGraph } from "./tagGraph";

describe("buildTagGraph", () => {
  beforeEach(async () => {
    await prisma.appTag.deleteMany();
    await prisma.tag.deleteMany();
    await prisma.app.deleteMany();
  });

  it("only includes tags used by an approved app", async () => {
    const approved = await prisma.app.create({
      data: { slug: "approved-app", name: "Approved", url: "https://example.com", status: "approved" },
    });
    const pending = await prisma.app.create({
      data: { slug: "pending-app", name: "Pending", url: "https://example.com", status: "pending" },
    });
    const used = await prisma.tag.create({ data: { slug: "used", name: "used" } });
    const orphan = await prisma.tag.create({ data: { slug: "orphan", name: "orphan" } });
    await prisma.appTag.create({ data: { appId: approved.id, tagId: used.id, stakeTotal: 10 } });
    await prisma.appTag.create({ data: { appId: pending.id, tagId: orphan.id, stakeTotal: 10 } });

    const graph = await buildTagGraph();

    expect(graph.nodes.map((n) => n.id)).toEqual(["used"]);
  });

  it("sums stake and counts apps per tag", async () => {
    const appA = await prisma.app.create({ data: { slug: "a", name: "A", url: "https://example.com", status: "approved" } });
    const appB = await prisma.app.create({ data: { slug: "b", name: "B", url: "https://example.com", status: "approved" } });
    const tag = await prisma.tag.create({ data: { slug: "defi", name: "defi" } });
    await prisma.appTag.create({ data: { appId: appA.id, tagId: tag.id, stakeTotal: 30 } });
    await prisma.appTag.create({ data: { appId: appB.id, tagId: tag.id, stakeTotal: 20 } });

    const graph = await buildTagGraph();

    expect(graph.nodes).toEqual([{ id: "defi", name: "defi", stake: 50, appCount: 2 }]);
  });

  it("computes co-occurrence weight and Jaccard similarity between two tags", async () => {
    // defi + nft co-occur on app1 and app2; defi also stands alone on app3.
    const app1 = await prisma.app.create({ data: { slug: "app1", name: "App1", url: "https://example.com", status: "approved" } });
    const app2 = await prisma.app.create({ data: { slug: "app2", name: "App2", url: "https://example.com", status: "approved" } });
    const app3 = await prisma.app.create({ data: { slug: "app3", name: "App3", url: "https://example.com", status: "approved" } });
    const defi = await prisma.tag.create({ data: { slug: "defi", name: "defi" } });
    const nft = await prisma.tag.create({ data: { slug: "nft", name: "nft" } });
    await prisma.appTag.create({ data: { appId: app1.id, tagId: defi.id } });
    await prisma.appTag.create({ data: { appId: app1.id, tagId: nft.id } });
    await prisma.appTag.create({ data: { appId: app2.id, tagId: defi.id } });
    await prisma.appTag.create({ data: { appId: app2.id, tagId: nft.id } });
    await prisma.appTag.create({ data: { appId: app3.id, tagId: defi.id } });

    const graph = await buildTagGraph();

    const edge = graph.edges.find((e) => e.source === "defi" && e.target === "nft");
    expect(edge?.weight).toBe(2);
    // defi appears on 3 apps, nft on 2, they co-occur on 2 -> union = 3.
    expect(edge?.similarity).toBeCloseTo(2 / 3);
  });
});
