// Server-only client for the indexer's HTTP API (indexer/src/api.rs) — the
// app's ONE gateway to on-chain state and transaction submission. Nothing
// in this codebase should construct a Solana `Connection` or talk to an
// RPC endpoint directly anymore; every read/build/submit goes through here
// instead, proxied to the actual indexer service (which does own an RPC
// connection — see indexer/README.md's architecture note). Only ever
// imported from `app/src/app/api/**` route handlers (server-side) — never
// from a "use client" component, since the indexer isn't reachable from
// the browser (see render.yaml: it's a private, internal-network-only
// service, same as it always was).
//
// u64/u128 on-chain values are passed through as decimal STRINGS end to
// end (indexer -> here -> the Next.js API route -> the browser), never as
// JS numbers or a BN class instance — BN has no JSON.stringify support
// (it would serialize its internal {negative, words, length} shape, not a
// number), and plain numbers lose precision above 2^53. Whichever piece
// of client code needs to actually do arithmetic on one of these (e.g.
// ClaimRewards.tsx's settlePendingRaw) wraps it in `new BN(str)` itself,
// right before use.

import { config } from "@/lib/config";

const INDEXER_API_URL = config.indexerApiUrl;

class IndexerNotFoundError extends Error {}

async function get(path: string): Promise<unknown> {
  const res = await fetch(`${INDEXER_API_URL}${path}`, { cache: "no-store" });
  if (res.status === 404) throw new IndexerNotFoundError(path);
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`indexer GET ${path} failed (${res.status}): ${body}`);
  }
  return res.json();
}

async function post(path: string, body: unknown): Promise<unknown> {
  const res = await fetch(`${INDEXER_API_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`indexer POST ${path} failed (${res.status}): ${text}`);
  }
  return res.json();
}

/** `null` on a 404 (the account genuinely doesn't exist yet), throws on any other failure. */
async function getOrNull(path: string): Promise<unknown | null> {
  try {
    return await get(path);
  } catch (err) {
    if (err instanceof IndexerNotFoundError) return null;
    throw err;
  }
}

export interface AppAccountData {
  pda: string;
  appId: string;
  totalVoteStake: string;
  voteAccRewardPerShare: string;
  totalTagStake: string;
  tagsAccRewardPerShare: string;
  bump: number;
}

export interface AppTagStakeData {
  pda: string;
  app: string;
  tag: string;
  tagId: string;
  stakeAmount: string;
  bump: number;
}

export interface PositionData {
  pda: string;
  owner: string;
  amount: string;
  rewardDebt: string;
  bump: number;
}

export async function fetchAppAccount(appId: string): Promise<AppAccountData | null> {
  return (await getOrNull(`/accounts/app/${encodeURIComponent(appId)}`)) as AppAccountData | null;
}

export async function fetchAppTagStake(
  appId: string,
  tagSlug: string,
): Promise<AppTagStakeData | null> {
  return (await getOrNull(
    `/accounts/app-tag/${encodeURIComponent(appId)}/${encodeURIComponent(tagSlug)}`,
  )) as AppTagStakeData | null;
}

export async function fetchVotePosition(
  appId: string,
  owner: string,
): Promise<PositionData | null> {
  return (await getOrNull(
    `/accounts/vote-position/${encodeURIComponent(appId)}/${owner}`,
  )) as PositionData | null;
}

export async function fetchStakePosition(
  appId: string,
  tagSlug: string,
  owner: string,
): Promise<PositionData | null> {
  return (await getOrNull(
    `/accounts/stake-position/${encodeURIComponent(appId)}/${encodeURIComponent(tagSlug)}/${owner}`,
  )) as PositionData | null;
}

export interface WalletBalance {
  amount: string;
  decimals: number;
  uiAmountString: string;
}

export async function fetchBalance(owner: string, mint: string): Promise<WalletBalance> {
  return (await get(`/balances/${owner}/${mint}`)) as WalletBalance;
}

export interface NebPoolStatus {
  poolAddress: string;
  price: number;
  nebReserve: number;
  usdcReserve: number;
  nebMint: string;
  usdcMint: string;
}

export async function fetchPoolStatus(): Promise<NebPoolStatus | null> {
  return (await getOrNull("/pool")) as NebPoolStatus | null;
}

export interface BuiltTx {
  transaction: string;
}

/** `amount` is a raw, already-decimals-scaled u64 as a decimal string (see lib/anchorClient.ts's toRawAmount). */
export async function buildVoteTx(appId: string, amount: string, user: string): Promise<BuiltTx> {
  return (await post("/tx/vote", { appId, amount, user })) as BuiltTx;
}

export async function buildWithdrawVoteTx(
  appId: string,
  amount: string,
  user: string,
): Promise<BuiltTx> {
  return (await post("/tx/withdraw-vote", { appId, amount, user })) as BuiltTx;
}

export async function buildStakeTagTx(
  appId: string,
  tagSlug: string,
  amount: string,
  user: string,
): Promise<BuiltTx> {
  return (await post("/tx/stake-tag", { appId, tagSlug, amount, user })) as BuiltTx;
}

export async function buildWithdrawTagStakeTx(
  appId: string,
  tagSlug: string,
  amount: string,
  user: string,
): Promise<BuiltTx> {
  return (await post("/tx/withdraw-tag-stake", { appId, tagSlug, amount, user })) as BuiltTx;
}

export async function buildClaimVoteRewardTx(appId: string, user: string): Promise<BuiltTx> {
  return (await post("/tx/claim-vote-reward", { appId, user })) as BuiltTx;
}

export async function buildClaimTagRewardTx(
  appId: string,
  tagSlug: string,
  user: string,
): Promise<BuiltTx> {
  return (await post("/tx/claim-tag-reward", { appId, tagSlug, user })) as BuiltTx;
}

export interface BuiltSwap extends BuiltTx {
  /** Expected NEB output at quote time, UI units. */
  nebOut: number;
}

export async function buildBuyNebTx(usdcAmount: number, user: string): Promise<BuiltSwap> {
  return (await post("/tx/buy-neb/build", { usdcAmount, user })) as BuiltSwap;
}

export interface SubmitResult {
  signature: string;
}

export async function submitSignedTx(signedTransaction: string): Promise<SubmitResult> {
  return (await post("/tx/submit", { signedTransaction })) as SubmitResult;
}
