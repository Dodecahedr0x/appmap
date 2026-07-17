# Remove wallet sign-in, replace with captcha-based anti-abuse

## Goal

The wallet is only used to **sign transactions** for staking, voting, buying,
and claiming rewards — never for authentication. Remove the SIWS
(Sign-In-With-Solana) session/login flow entirely. Off-chain writes that
today require a signed-in session (submitting an app, suggesting a tag,
recording a vote/stake/withdraw, listing "my" positions) switch to being
identified by the connected wallet's public key plus a verified captcha
token, using the same Cloudflare Turnstile mechanism already used for
pageview anti-bot checks (`app/src/lib/turnstile.ts`).

`User.wallet` stays as the identity key for `Vote`/`Stake`/`App.submittedBy`/
`AppTag.suggestedBy` rows — only the *login/session* mechanism built on top of
it is removed. No database migration needed.

## Step 1: Add wallet-identity + captcha verification scaffolding (server)
- Move `isValidWallet` out of `app/src/lib/solana-auth.ts` into a new
  `app/src/lib/wallet.ts` (pure pubkey-format check only — no signing/session
  code, since `solana-auth.ts` is deleted in Step 9).
- Add `requireCaptchaWallet(input: { wallet: string; captchaToken?: string | null })`
  to `app/src/lib/api.ts`:
  1. `isValidWallet(input.wallet)` — throw `ApiError("Invalid wallet address", 400)` if not.
  2. `verifyTurnstileToken(input.captchaToken ?? null)` — throw
     `ApiError("Captcha verification failed", 403)` if it returns false.
  3. `prisma.user.upsert({ where: { wallet: input.wallet }, create: { wallet: input.wallet }, update: {} })`, return the user.
  This is the direct replacement for `requireUser()` on write routes.
- Add `wallet: pubkeyString` and `captchaToken: z.string().min(1)` fields to
  `voteSchema`, `stakeSchema`, `submitAppSchema`, `suggestTagSchema`,
  `unstakeSchema`, `unvoteSchema` in `app/src/lib/validation.ts` (reuse the
  existing `pubkeyString` regex already defined there).
- Purely additive — nothing wired up yet. Build/tests stay green.

## Step 2: Add client-side captcha hook
- Add `app/src/hooks/useWriteCaptcha.ts`: renders/manages an invisible
  Cloudflare Turnstile widget (same pattern as
  `app/src/components/app/TrafficBeacon.tsx`) and exposes
  `getToken(): Promise<string | null>`, resolving `null` when
  `NEXT_PUBLIC_TURNSTILE_SITE_KEY` isn't configured — matching
  `TrafficBeacon`'s "not configured → no token" convention and the server's
  fail-closed `verifyTurnstileToken`.
- Not wired into any component yet. Build stays green.

## Step 3: Migrate app submission
- `app/src/app/api/apps/route.ts` (`POST`): replace `requireUser()` with
  `requireCaptchaWallet({ wallet: body.wallet, captchaToken: body.captchaToken })`.
- `app/src/components/discover/CreateAppForm.tsx`: replace `useAuth()` gating
  with `useWallet()` (`connected`/`publicKey`); wire in `useWriteCaptcha()`;
  send `wallet`/`captchaToken` in the POST body.

## Step 4: Migrate tag suggestion
- `app/src/app/api/tags/suggest/route.ts` (`POST`): same
  `requireCaptchaWallet` swap.
- `app/src/components/app/TagStakePanel.tsx`'s "suggest a tag" input: same
  client-side pattern as Step 3.

## Step 5: Migrate voting
- `app/src/app/api/vote/route.ts` (`POST`): swap to `requireCaptchaWallet`.
- `app/src/app/api/vote/withdraw/route.ts` (`POST`): swap to
  `requireCaptchaWallet`; ownership check (`vote.userId !== user.id`)
  unchanged.
- `app/src/app/api/vote/route.ts` (`GET`): replace the session lookup with a
  `?wallet=` query param (`prisma.user.findUnique({ where: { wallet } })`),
  keeping the existing "empty result for unknown/missing wallet" convention.
- `app/src/components/app/VotePanel.tsx`: drop `useAuth()`, gate on
  `useWallet()`, wire captcha into `vote()`/`withdraw()`, pass `wallet`.

## Step 6: Migrate staking
- `app/src/app/api/stake/route.ts` (`POST`, `GET`) and
  `app/src/app/api/stake/withdraw/route.ts`: same pattern as Step 5.
- `app/src/components/app/TagStakePanel.tsx`'s stake/withdraw actions: same
  client-side pattern as Step 5.

## Step 7: Migrate rewards positions + simplify Buy/Claim gating
- `app/src/app/api/rewards/positions/route.ts` (`GET`): switch from session
  to `?wallet=` query param, same empty-result convention as Step 5's GET.
- `app/src/components/rewards/ClaimRewards.tsx`,
  `app/src/components/token/BuyPanel.tsx`: drop `useAuth()`, gate purely on
  `useWallet()` (`connected`/`publicKey`) — claiming/buying are wallet-tx
  actions with no off-chain write needing captcha.

## Step 8: Simplify ConnectButton, remove AuthProvider from the tree
- `app/src/components/ConnectButton.tsx`: drop the "Sign in"/"Sign out" step
  — just "Connect wallet" / connected-address chip + "Disconnect" (via
  `useWallet().disconnect()`).
- `app/src/app/layout.tsx`: remove the `<AuthProvider>` wrapper.
- Grep-confirm no remaining `useAuth`/`AuthProvider` imports anywhere.

## Step 9: Remove the auth feature itself
- Delete `app/src/lib/solana-auth.ts` (superseded by `wallet.ts` from Step 1),
  `app/src/lib/session.ts`,
  `app/src/app/api/auth/{challenge,verify,me,logout}/route.ts`,
  `app/src/components/providers/AuthProvider.tsx`.
- Remove `requireSession`/`requireUser`/`SessionPayload` import from
  `app/src/lib/api.ts`.
- Remove `authVerifySchema` from `app/src/lib/validation.ts`.
- Remove `tweetnacl`/`bs58` from `app/package.json` (grep-confirm no
  remaining references first) and run install.
- Update the `User` model doc-comment in `app/prisma/schema.prisma` to
  describe wallet-based identity for on-chain positions rather than
  "authentication is proof of wallet ownership."
