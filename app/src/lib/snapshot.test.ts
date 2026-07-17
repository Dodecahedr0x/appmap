import { describe, it, expect, beforeEach } from "vitest";
import { prisma } from "./prisma";
import { writeDailySnapshot } from "./snapshot";

describe("writeDailySnapshot", () => {
  beforeEach(async () => {
    await prisma.appStatsSnapshot.deleteMany();
    await prisma.app.deleteMany();
  });

  it("writes one snapshot row per app for today", async () => {
    const app = await prisma.app.create({
      data: {
        slug: "snap-app",
        name: "Snap App",
        url: "https://example.com",
        voteWeight: 10,
        stakeTotal: 5,
        viewCount: 100,
        rankScore: 2.5,
      },
    });

    const count = await writeDailySnapshot();

    expect(count).toBe(1);
    const snapshot = await prisma.appStatsSnapshot.findFirst({ where: { appId: app.id } });
    expect(snapshot!.voteWeight).toBe(10);
  });

  it("is idempotent for the same day (upserts rather than duplicating)", async () => {
    await prisma.app.create({
      data: { slug: "snap-app-2", name: "Snap App 2", url: "https://example.com" },
    });
    await writeDailySnapshot();
    await writeDailySnapshot();
    const count = await prisma.appStatsSnapshot.count();
    expect(count).toBe(1);
  });
});
