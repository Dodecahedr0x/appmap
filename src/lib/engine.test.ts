import { describe, it, expect, beforeEach } from "vitest";
import { prisma } from "./prisma";
import { refreshApp } from "./engine";

describe("refreshApp", () => {
  let appId: string;
  let userId: string;

  beforeEach(async () => {
    await prisma.vote.deleteMany();
    await prisma.app.deleteMany();
    await prisma.user.deleteMany();
    const user = await prisma.user.create({ data: { wallet: "test-wallet-1" } });
    const app = await prisma.app.create({
      data: { slug: "test-app", name: "Test App", url: "https://example.com" },
    });
    userId = user.id;
    appId = app.id;
  });

  it("excludes withdrawn votes from voteWeight", async () => {
    await prisma.vote.create({ data: { appId, userId, amount: 100, active: true } });
    await prisma.vote.create({ data: { appId, userId, amount: 50, active: false } });

    await refreshApp(appId);

    const app = await prisma.app.findUniqueOrThrow({ where: { id: appId } });
    expect(app.voteWeight).toBe(100);
    expect(app.voteCount).toBe(1);
  });
});
