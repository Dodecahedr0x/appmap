# AGENTS.md — `programs/nebulous_world`

The on-chain Anchor program: token-weighted app voting, tag staking, and
stake-proportional reward distribution (the "reward per share" accumulator
pattern, applied twice — once for votes, once for tag stakes — per app). See
the [repo-root AGENTS.md](../../AGENTS.md) for how this fits into the wider
product; the app never talks to it directly — see
[`indexer/README.md`](../../indexer/README.md) and
`app/src/lib/indexerClient.ts`.

## Instructions (`src/instructions/`, wired up in `src/lib.rs`)

| Instruction | File | What |
| --- | --- | --- |
| `initialize` | `initialize.rs` | One-time: create the program `Config` (authority, vote mint, protocol fee bps). |
| `init_app` | `init_app.rs` | Create an `AppAccount` for a crowd-submitted app. **Permissionless by design** — apps are crowd-submitted, so anyone may register any `app_id`. |
| `suggest_tag` | `suggest_tag.rs` | Create an `AppTagAccount` for an (app, tag) pair. **Also permissionless**, mirroring `init_app`. |
| `vote` / `withdraw_vote` | `vote.rs` / `withdraw_vote.rs` | Lock/unlock vote-stake principal in `AppAccount::vote_vault`; updates `VotePosition`'s reward checkpoint via `reward_math::settle_pending`. |
| `stake_tag` / `withdraw_tag_stake` | `stake_tag.rs` / `withdraw_tag_stake.rs` | Same, for tag-stake principal in `AppTagAccount::principal_vault`, checkpointed in `StakePosition`. |
| `fund_app_rewards` | `fund_app_rewards.rs` | Fund either the vote-reward pool or the shared tags-reward pool for an app (`RewardPool::Vote`/`Tags`), bumping that pool's accumulator. |
| `claim_vote_reward` / `claim_tag_reward` | `claim_vote_reward.rs` / `claim_tag_reward.rs` | Pay out a position's accrued reward without touching its principal. |

## State (`src/state.rs`)

| Account | Key fields | Notes |
| --- | --- | --- |
| `Config` | `authority`, `vote_mint`, `protocol_fee_bps` | Singleton, seed `CONFIG_SEED`. |
| `AppAccount` | `app_id`, three vaults (`vote_vault`, `vote_reward_vault`, `tags_reward_vault`), `total_vote_stake` + `vote_acc_reward_per_share`, `total_tag_stake` + `tags_acc_reward_per_share` | One per app, keyed by an off-chain (Prisma) `app_id` used directly as a PDA seed — see `MAX_APP_ID_LEN`. Holds **both** reward accumulators; the tags one is shared across all of an app's tags. |
| `AppTagAccount` | `app`, `tag_id`, `principal_vault`, `stake_amount` | One per (app, tag). Principal is tracked per-tag, but reward checkpointing for stakes on it uses `AppAccount`'s *shared* `tags_acc_reward_per_share`, not a per-tag accumulator. |
| `VotePosition` / `StakePosition` | `owner`, `amount`, `reward_debt` | One per (app, user) / (app_tag, user). `reward_debt` is the accumulator checkpoint `reward_math.rs` reads/writes. |
| `RewardPool` (enum) | `Vote \| Tags` | Selects which of `AppAccount`'s two pools `fund_app_rewards` operates on. |

Every PDA-owning account's doc comment spells out its exact seed list and,
where relevant, a **CPI-signing footgun**: some PDAs (`AppAccount`,
`AppTagAccount`) must sign transfers using their *derivation* seeds
(`app_id`/`tag_id` bytes), not `account.key()` — read the struct comments in
`state.rs` before touching any instruction that signs a CPI as one of these.

## Math (`src/reward_math.rs`)

Pool-agnostic "reward per share" helpers shared by both the vote and
tag-stake instruction pairs — `reward_debt_for`, `settle_pending`,
`bump_accumulator`, `transfer_from_vault`. Uses explicit checked arithmetic
throughout (not the build profile's `overflow-checks` flag — see the file's
top comment for why). Change this file, not the per-instruction handlers, if
you're touching the accrual formula itself.

## Errors (`src/error.rs`)

Standard Anchor `#[error_code] enum ErrorCode` — one variant per invariant
(`ZeroAmount`, `InsufficientStake`, `MathOverflow`, `TagAppMismatch`, …).

## Testing

Two separate suites, don't confuse them:

- **`tests/*.rs`** (this directory, one file per instruction, e.g.
  `test_vote.rs`) — fast, in-process tests against
  [LiteSVM](https://github.com/LiteSVM/litesvm) (a `dev-dependency` in this
  crate's `Cargo.toml`). Run with `cargo test` (from here or the repo root,
  via the `Cargo.toml` workspace). This is where most coverage lives.
- **`tests/nebulous_world.ts`** at the repo root — a thinner Anchor/TS
  integration test against a real local validator, run via `npm run
  test:anchor` / `anchor test` (which is what `Anchor.toml`'s `[scripts]
  test` line actually invokes — it does **not** run the Rust suite above).

## Building

`anchor build` from the repo root generates `target/idl/nebulous_world.json`
+ `target/types/nebulous_world.ts` — required by `app/src/lib/anchorClient.ts`,
`scripts/settleEpoch.ts`, and `app/scripts/launch-neb/`, but **not** by the
app's runtime (which never imports the program directly — see
`indexer/README.md`).
