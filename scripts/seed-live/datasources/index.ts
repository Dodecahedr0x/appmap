import type { DataSource } from "../types";
import { defiLlamaSource } from "./defillama";

// Registry of all live data sources. To add one: write a new file in this
// directory implementing DataSource, then add it here.
export const DATASOURCES: DataSource[] = [defiLlamaSource];
