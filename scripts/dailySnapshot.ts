import { writeDailySnapshot } from "../src/lib/snapshot";

writeDailySnapshot()
  .then((count) => {
    console.log(`Wrote ${count} snapshot rows.`);
    process.exit(0);
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
