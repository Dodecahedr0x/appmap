# Security review — `programs/nebulous_world`

Date: 2026-07-19
Scope: `programs/nebulous_world/src/**` (the on-chain Anchor program only — not
the indexer, the app, or off-chain scripts).

## Method

1. Automated scan: [`@jelleo/solana-security-standard`](https://github.com/Copenhagen0x/solana-security-standard)
   (SOL-0XX rule set), run against every file under `programs/nebulous_world/src`.
   46 findings across 4 rule IDs (SOL-016, SOL-010, SOL-011, SOL-006).
2. Manual review of every instruction handler, every state account, the two
   pure-math modules (`reward_math.rs`, `unstake_fee.rs`), `lib.rs`,
   `constants.rs`, and `error.rs` — cross-checked against the automated
   findings and against rule classes the scanner has no pattern for (fee/
   reward rounding direction, token-mint pinning, PDA seed self-consistency,
   front-running windows).
3. Cross-referenced against the existing LiteSVM integration test suite
   (`programs/nebulous_world/tests/*.rs`) to confirm which attack scenarios
   are already covered.

Every automated finding is triaged below with its specific exclusion
reasoning — a match means "look here," not "confirmed bug," and the standard
says so explicitly.

## Automated findings: triage

### SOL-016 · Bump seed unvalidated — 30 occurrences, all false positives

Every flagged `bump = x.bump` reads a bump that was itself set at that
account's own `init`/`init_if_needed` site via bare `bump` / `ctx.bumps.x` —
exactly the case the rule itself calls out as safe:

| Account | Bump set at | Site |
| --- | --- | --- |
| `app.bump` | `app.bump = ctx.bumps.app` | `init_app.rs` |
| `config.bump` | `config.bump = ctx.bumps.config` | `initialize.rs` |
| `position.bump` (Vote/Stake) | `position.bump = ctx.bumps.position` | `vote.rs`, `stake_tag.rs` |
| `tag.bump` | `tag.bump = ctx.bumps.tag` | `suggest_tag.rs` |
| `app_tag_stake.bump` | `app_tag_stake.bump = ctx.bumps.app_tag_stake` | `suggest_tag.rs` |

No instruction anywhere in this program accepts a caller-supplied
`#[instruction(bump)]` or calls `create_program_address` directly.

### SOL-010 · Reinitialization / account takeover — 10 occurrences, all false positives

Every `init_if_needed` in this program (`Vote::position`,
`StakeTag::position`, `SuggestTag::tag`) is on a PDA seeded by the caller's
own pubkey (or, for `tag`, a global identity with no mutable value to steal —
just a `tag_id`/`bump` re-write that's a no-op on a second call, since the
seeds already pin `tag_id`). No cross-user account substitution is possible,
and Anchor's actual `init_if_needed` semantics don't reset an existing
account's fields on a second call — this is the standard, safe
"create-or-top-up" pattern, not the "2nd call reinits and drops balances"
anti-pattern the rule targets. Confirmed via `vote.rs`'s own doc comment
explaining exactly why the idempotent field re-writes are safe.

### SOL-011 · Lamport drain via close — 2 occurrences, both false positives

`close_vote_position.rs` / `close_tag_stake_position.rs` satisfy all three
of the rule's exclusion criteria:

1. **Fully drained before close** — `require!(position.amount == 0, …)`,
   and `reward_debt` is provably 0 whenever `amount` is 0 (every path that
   changes `amount` re-checkpoints `reward_debt` against the same
   accumulator value in the same instruction).
2. **Controlled destination** — lamports go to `position.payer` (the
   account that originally paid rent, stored at creation), verified via
   `#[account(address = position.payer)]` — not whoever submits the close
   transaction.
3. **Data zeroed** — Anchor's `close = payer` constraint does this
   automatically (zeroes data, writes the closed-account discriminator).

### SOL-006 · Missing signer check — 1 occurrence, false positive

`reward_math.rs:79`'s `config_ai: &AccountInfo<'info>` is the `Config` PDA
used as a CPI *signing authority* (`CpiContext::new_with_signer` with
`config`'s own derivation seeds) for every vault payout in the program — not
an unchecked privileged caller. Every call site passes
`ctx.accounts.config.to_account_info()`, where `config` was already verified
by that instruction's own `#[account(seeds = …, bump = config.bump)]`
constraint. SOL-006 is about verifying a caller's `is_signer`; this is a
program-derived signer, which by definition can never be a wallet `Signer`.

## Manual-review findings

Two genuine, low-severity issues found. Each gets its own commit; this
checklist is ticked off as each lands.

- [ ] **1. Unstake fee rounds in the withdrawer's favor, not the protocol's**
      (`unstake_fee.rs`) — SOL-023-class. `unstake_fee()`'s integer division
      truncates the fee down, so `net_amount = amount - fee` is always
      *at least* the mathematically-exact payout, off by at most 1 raw token
      unit. Inconsistent with the rest of the program's rounding direction
      (`settle_pending`/`bump_accumulator` both round in the protocol's
      favor — stakers never accrue more than what was actually funded).
      Practically negligible (bounded by <1 raw unit per withdrawal) but a
      real, cheap-to-fix inconsistency. **Fix:** round the fee *up*
      (`div_ceil`), matching the rest of the codebase's protocol-favoring
      direction.
- [ ] **2. No mint pinned on caller-supplied token accounts** (`vote.rs`,
      `withdraw_vote.rs`, `stake_tag.rs`, `withdraw_tag_stake.rs`,
      `claim_vote_reward.rs`, `claim_tag_reward.rs`, `fund_app_rewards.rs`) —
      SOL-036-adjacent. `user_token_account`/`funder_token_account` have no
      `token::mint = config.vote_mint` constraint. **Not independently
      exploitable** — the SPL Token program's own `Transfer` instruction
      already rejects any cross-mint transfer at the runtime level, so a
      wrong-mint account can only ever fail closed, never move value
      incorrectly. This is defense-in-depth/UX hardening: a wrong-mint
      account currently fails with an opaque SPL-level error; pinning the
      constraint turns that into a clear, typed Anchor error instead.
      **Fix:** add `token::mint = config.vote_mint` to every caller-supplied
      token account across all 7 instructions.

## Non-findings (considered, ruled out)

- **SOL-013 / SOL-052 (Token-2022 confusion)** — every token account is a
  typed `Account<'info, TokenAccount>` under a typed `Program<'info, Token>`
  (classic SPL Token), everywhere in the program. A Token-2022 mint's token
  accounts are owned by a different program id and would fail Anchor's
  owner check before reaching any handler logic.
- **SOL-024 (oracle staleness)** — no oracle reads anywhere on-chain in this
  program (Pyth is indexer/off-chain only).
- **SOL-042/043 (unbounded iteration / storage griefing)** — no instruction
  loops over a caller-controlled collection or `remaining_accounts`; every
  instruction is O(1).
- **Cross-account substitution on `AppTagStake`** — `stake_tag.rs`,
  `withdraw_tag_stake.rs`, and `claim_tag_reward.rs` all correctly pin
  `app_tag_stake.app == app.key()`, closing the exact "attacker's own
  app_tag_stake against a victim's well-funded app" drain the accompanying
  doc comments describe. Already covered by
  `test_stake_tag_rejects_mismatched_app_and_app_tag_stake`.
- **`VotePosition`/`StakePosition` app-substitution** — unlike
  `AppTagStake`, these PDAs are seeded directly from `app.key()` (not
  self-referentially), so Anchor's own seeds constraint rejects a mismatched
  `app` account by construction; no extra `constraint =` needed.
- **`initialize()` front-running** — already closed via the
  `program_data.upgrade_authority_address == Some(authority.key())` check
  (see that file's doc comment); the only residual risk is a
  *deployment-ordering* footgun (finalizing the program before ever calling
  `initialize` permanently bricks it), which is a self-inflicted deploy
  mistake, not an attacker-exploitable vulnerability, and is already
  explicitly documented in the code.
- **Division-by-zero** — every division in `reward_math.rs`/`unstake_fee.rs`
  is either by a nonzero constant (`REWARD_PRECISION`, `10_000`) or
  explicitly guarded (`bump_accumulator`'s `total_stake > 0`,
  `weighted_avg_timestamp`'s `total == 0` check).
- **Integer overflow** — every arithmetic op in the program uses
  `checked_*`/`saturating_*` or is proven safe by a documented magnitude
  argument (`weighted_avg_timestamp`'s i128 headroom comment).

## Verification

Each fix commit runs `cargo test` (the full LiteSVM integration suite) and
`cargo build` before being considered done. See individual commit messages
for the exact verification output.
