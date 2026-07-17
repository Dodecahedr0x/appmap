import type { Category } from "../../src/lib/constants";

/** A single app/protocol as normalized from an external data source, before tagging. */
export interface RawApp {
  /** Which DataSource produced this record, e.g. "defillama". */
  sourceId: string;
  /** Stable id within the source, used for de-duplication across runs. */
  externalId: string;
  name: string;
  url: string;
  description: string;
  iconUrl?: string;
  category: Category;
}

/**
 * A pluggable source of real-world app data. To add a new source: implement
 * this interface in its own file under datasources/, then register it in
 * datasources/index.ts. Nothing else in the pipeline needs to change.
 */
export interface DataSource {
  id: string;
  fetch(): Promise<RawApp[]>;
}
