import { writeDailySnapshot } from "../src/lib/indexerClient";

writeDailySnapshot()
  .then(({ written }) => {
    console.log(`Wrote ${written} snapshot rows.`);
    process.exit(0);
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
