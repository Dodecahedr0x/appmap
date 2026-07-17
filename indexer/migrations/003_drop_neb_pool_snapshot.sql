-- NEB's initial-supply sale moved off-chain-native: it's now bought by
-- swapping against a public Meteora DLMM pool (see app/scripts/launch-neb/)
-- rather than through a NebPool account this program owns. There's nothing
-- left to snapshot — the DLMM pool's own on-chain state (and Meteora's own
-- indexing) is the source of truth for its price/liquidity history now.
DROP TABLE IF EXISTS neb_pool_snapshot;
