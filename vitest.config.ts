import { defineConfig, configDefaults } from "vitest/config";

export default defineConfig({
  test: {
    env: {
      // Prisma resolves relative SQLite URLs relative to schema.prisma's
      // directory (prisma/), both for the CLI and for the generated Client
      // at runtime — so "./test.db" here lands at prisma/test.db, not
      // prisma/prisma/test.db. Verified empirically; see pretest script.
      DATABASE_URL: "file:./test.db",
    },
    // Test files share one on-disk SQLite database (no per-file schema/
    // transaction isolation) and several files unconditionally wipe shared
    // tables like `app` in beforeEach/setup — running files in parallel
    // worker threads races those wipes against other files' inserts,
    // surfacing as intermittent foreign-key-constraint failures once enough
    // files touch the same tables (as adding snapshot.test.ts did).
    fileParallelism: false,
    // .worktrees holds sibling git worktrees of this same repo (see
    // .gitignore) — without this exclusion, running from the main
    // checkout picks up their *.test.ts files too and runs every test
    // twice.
    exclude: [...configDefaults.exclude, "**/.worktrees/**"],
  },
});
