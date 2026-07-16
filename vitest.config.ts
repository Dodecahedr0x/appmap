import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    env: {
      // Prisma resolves relative SQLite URLs relative to schema.prisma's
      // directory (prisma/), both for the CLI and for the generated Client
      // at runtime — so "./test.db" here lands at prisma/test.db, not
      // prisma/prisma/test.db. Verified empirically; see pretest script.
      DATABASE_URL: "file:./test.db",
    },
  },
});
