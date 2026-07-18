import { describe, it, expect, beforeEach } from "vitest";
import { prisma } from "./prisma";
import { getPlatformStats } from "./explore";

describe("getPlatformStats", () => {
  beforeEach(async () => {
    await prisma.appTag.deleteMany();
    await prisma.tag.deleteMany();
    await prisma.app.deleteMany();
  });

  it("only counts approved apps in totalApps and the summed metrics", async () => {
    await prisma.app.create({
      data: {
        id: "approved-app", slug: "approved-app",
        name: "Approved",
        url: "https://example.com",
        status: "approved",
        voteWeight: 100,
        stakeTotal: 50,
        viewCount: 10,
      },
    });
    await prisma.app.create({
      data: {
        id: "pending-app", slug: "pending-app",
        name: "Pending",
        url: "https://example.com",
        status: "pending",
        voteWeight: 9999,
        stakeTotal: 9999,
        viewCount: 9999,
      },
    });

    const stats = await getPlatformStats();

    expect(stats.totalApps).toBe(1);
    expect(stats.totalVoteWeight).toBe(100);
    expect(stats.totalStake).toBe(50);
    expect(stats.totalViews).toBe(10);
  });

  it("only counts tags actually used by an approved app, not every suggested tag", async () => {
    const approved = await prisma.app.create({
      data: { id: "approved-app", slug: "approved-app", name: "Approved", url: "https://example.com", status: "approved" },
    });
    const pending = await prisma.app.create({
      data: { id: "pending-app", slug: "pending-app", name: "Pending", url: "https://example.com", status: "pending" },
    });
    const usedTag = await prisma.tag.create({ data: { id: "used", slug: "used", name: "Used" } });
    const orphanTag = await prisma.tag.create({ data: { id: "orphan", slug: "orphan", name: "Orphan" } });
    await prisma.appTag.create({ data: { appId: approved.id, tagId: usedTag.id } });
    // Suggested, but only ever attached to a non-approved app.
    await prisma.appTag.create({ data: { appId: pending.id, tagId: orphanTag.id } });

    const stats = await getPlatformStats();

    expect(stats.totalTags).toBe(1);
  });

  it("counts a tag once even if it's attached to multiple approved apps", async () => {
    const appA = await prisma.app.create({
      data: { id: "app-a", slug: "app-a", name: "App A", url: "https://example.com", status: "approved" },
    });
    const appB = await prisma.app.create({
      data: { id: "app-b", slug: "app-b", name: "App B", url: "https://example.com", status: "approved" },
    });
    const sharedTag = await prisma.tag.create({ data: { id: "shared", slug: "shared", name: "Shared" } });
    await prisma.appTag.create({ data: { appId: appA.id, tagId: sharedTag.id } });
    await prisma.appTag.create({ data: { appId: appB.id, tagId: sharedTag.id } });

    const stats = await getPlatformStats();

    expect(stats.totalTags).toBe(1);
  });
});
