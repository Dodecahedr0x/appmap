import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    env: {
      DATABASE_URL:
        process.env.TEST_DATABASE_URL ?? "postgresql://postgres:postgres@localhost:5432/nebulous_world_test",
    },
    // Test files share one Postgres database (no per-file schema/
    // transaction isolation) and several files unconditionally wipe shared
    // tables like `app` in beforeEach/setup — running files in parallel
    // worker threads races those wipes against other files' inserts,
    // surfacing as intermittent foreign-key-constraint failures once enough
    // files touch the same tables (as adding snapshot.test.ts did).
    fileParallelism: false,
  },
});
