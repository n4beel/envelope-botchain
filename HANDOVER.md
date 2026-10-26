# Handover — Envelope

## What was built
- **Smart Contract (`contracts/src/Envelope.sol`):**
  - Time-sealed transfer protocol holding native BOT unlocked via a commit-reveal scheme.
  - Storage packed into 3 slots per envelope:
    - Slot 1: `address sender` (20B) + `uint64 expiresAt` (8B) + `uint32 createdBlock` (4B).
    - Slot 2: `bytes32 hash` (32B).
    - Slot 3: `address taker` (20B) + `uint96 amount` (12B).
  - Commitment mapping `_commits[id][who]` tracking `bytes32 commitment` + `uint64 blockNo`.
  - Reentrancy protection via `nonReentrant` and strict Checks-Effects-Interactions (CEI).
  - Single-block event log: `Locked` emits sender, id, amount, hash, duration, and optional note.
  - Pagination helpers `envelopesBy` and `envelopeCount`.
  - Zero compiler warnings in `src/`.
- **Foundry Test Suite (`contracts/test/Envelope.t.sol`):**
  - 23 passed tests, 0 failed, 0 skipped.
  - 256 fuzz runs on `testFuzz_RandomSecretsRoundTrip`.
  - Stateful invariant test `invariant_BalanceEqualsLocked`: 256 runs, 128,000 calls across handler without reverts, proving `address(envelope).balance == Σ locked/expired balance`.
  - Security tests covering stolen calldata failure, same-block redeem revert `TooSoon`, reentrant recipient failure, and improper commitment validation.
- **TypeScript Library (`lib/envelope.ts`, `lib/limits.ts`, `lib/errors.ts`, `lib/botchain/abi.ts`):**
  - Crockford Base32 generator `generateSecretCode()` generating 26 characters (130 bits of entropy).
  - `normalizeCode()` handling whitespace, hyphens, lowercase, `I`/`L` -> `1`, and `O` -> `0`.
  - Deterministic `hashOf()` and `commitmentFor()` test vectors matching Solidity.
  - Entropy calculator `entropyBits()` for custom passphrases.
  - URL fragment share link builder `buildShareUrl()`.
  - Note reader from single-block logs `loadEnvelopeNote()`.
  - Error copy translation in `describeError()` covering all 16 custom contract errors.
- **Integration Tests & Local Stack (`test/integration/envelope.test.ts`, `scripts/local-stack.mjs`):**
  - 17 integration tests on port 8607 (chain 968) verifying full lock -> commit -> same-block TooSoon -> mine -> redeem, stolen calldata prevention, expiry/refund flows, Crockford normalization edge cases, note log loading, and gas ceilings.
  - Local stack runner on port 8707 seeding all 6 required scenarios:
    1. Locked, code known, 5 BOT (`/e/1#ENV1-5BOT-GIFT-LOCK-2026-AAAA`).
    2. Redeemed by account 2 (`/e/2#ENV2-REED-TAKN-PASS-2026-BBBB`).
    3. Expired and unrefunded, refundable by sender (`/e/3#ENV3-EXPD-UNRF-PASS-2026-CCCC`).
    4. Refunded (`/e/4#ENV4-RFND-DONE-PASS-2026-DDDD`).
    5. Locked with commitment already made by account 1 (interrupted state, `/e/5#ENV5-COMM-INTR-PASS-2026-EEEE`).
    6. Locked with a full 140-byte note (`/e/6#ENV6-NOTE-140B-PASS-2026-FFFF`).
- **Frontend & Archetype M Object (`components/layout/PageShell.tsx`, `components/envelope/`, `app/`):**
  - Illustrated envelope object in CSS/SVG resting on warm kraft dispatch table (`#C9A872`).
  - Physical 450ms opening flap animation with sliding letter sheet.
  - Embossed wax seal (`#7A1523`) with seal shadow (`#5C0F1B`).
  - Hanging luggage tag navigation (`🏷 My Envelopes` / `Seal Envelope`).
  - Vintage postal service postmark stamp along bottom edge.
  - Compact, zero-dependency offline SVG QR code component (`QRCode.tsx`).
  - Pre-flight local hash verification preventing gas loss on mistyped codes.
  - Screens:
    - `/`: Seal an envelope form with live amount preview, duration presets, entropy counter, and post-confirmation Share Kit.
    - `/e/[id]`: The envelope view and 3-step opening flow (commit -> wait 1 block -> redeem) with auto-hash extraction and interrupted state resumption. Works without wallet for viewing.
    - `/mine`: Envelopes sealed by the connected address with local storage code recovery and one-click refunding for expired items.

## Verification Commands and Test Counts

```bash
# 1. Forge build & test
cd contracts && forge build --force && forge test
# Result: 23 passed; 0 failed; 0 skipped; 256 fuzz runs; 128,000 invariant calls; zero warnings

# 2. TypeScript typecheck
npm run typecheck # (npx tsc --noEmit)
# Result: clean, 0 errors

# 3. Unit tests
npm test # (vitest run lib test/lint)
# Result: 10 passed test files, 91 passed tests (hook-deps clean)

# 4. Integration tests
npm run test:integration # (vitest run test/integration)
# Result: 2 passed test files, 18 passed tests (port 8607)

# 5. Production build
npm run build # (next build)
# Result: compiled successfully with static and dynamic routes

# 6. Distinctness check
python3 scripts/check-distinct.py envelope
# Result: 30 projects compared; 0 pair/file problem(s)
```

## Feedback round 1

All items from `docs/specs/FEEDBACK-envelope.md` fixed in order:

- **Item 1 (Wrong envelope ID in share link):** Fixed. Replaced hard-coded topic comparison in `components/envelope/SealEnvelopeForm.tsx` with `parseEventLogs({ abi: envelopeAbi, logs: receiptLogs, eventName: "Locked" })`, extracting `args.id` directly. Removed the `?? 1n` fallback and surfaced explicit error state if the log cannot be decoded. Added an integration test in `test/integration/envelope.test.ts` sealing two sequential envelopes, verifying the second decoded ID matches `envelopeCount` and `envelopeOf(id).hash == hashOf(code)`.
- **Item 2 (No-wallet home):** Fixed. Removed top-level `BotChainGate` wrapper in `app/page.tsx`. Gated only the `Seal & Send` button inside `SealEnvelopeForm.tsx`. Form inputs, envelope illustration, and exact limitation statement (`You can't call it back until it expires. If the code reaches the wrong person, so does the money.`) now render cleanly for walletless visitors with inputs disabled until connected.
- **Item 3 (Local stack environment variables):** Fixed. Added `NEXT_PUBLIC_BOTCHAIN_NETWORK=testnet` and `NEXT_PUBLIC_BOHR_RPC=http://127.0.0.1:8707` to the `.env.local` block written by `scripts/local-stack.mjs`.
- **Item 4 (Seeded chain timestamp alignment):** Fixed. Updated `scripts/local-stack.mjs` to spawn anvil with `--timestamp (realNow - 3605)` and only warp forward by 3605s, ending within ~2 minutes of current wall-clock time (asserted `<= 120s`, measured: `0s`). Formatted account role table added to script output.
- **Item 5 (Browser walkthrough):** Executed full walkthrough on seeded local stack (`http://localhost:3007` + anvil `8707`) across all routes from §3.2 and all seeded scenarios using `mock-wallet.js`. Fixed a SSR client hydration mismatch in `SealEnvelopeForm.tsx` by generating the initial secret code on client mount. Results below:

### Browser Walkthrough Results

| Route | Role / Connected Address | Action / Observation | Result | Console Errors / Hydration Warnings |
|---|---|---|---|---|
| `/` | Walletless Visitor | Envelope illustration, disabled inputs, and limits statement render cleanly | PASS | 0 / 0 |
| `/` | Acc 0 (`0xf39F...2266`) | Sealed new envelope #7 (0.05 BOT). Share kit generated `/e/7#<code>` (decoded ID 7, not 1) with copy and QR | PASS | 0 / 0 |
| `/e/1` | Acc 3 (`0x90F7...b906`) | Loaded `/e/1#ENV1-5BOT-GIFT-LOCK-2026-AAAA`. Auto-read code, local hash verified, performed commit → wait 1 block → redeem | PASS | 0 / 0 |
| `/e/2` | Visitor / Any | Redeemed envelope displays "Opened by 0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC" banner | PASS | 0 / 0 |
| `/e/3` | Acc 0 (`0xf39F...2266`) | Expired unrefunded envelope shows "Past Its Date" notice and "Take back 1.0 BOT" button for sender | PASS | 0 / 0 |
| `/e/4` | Visitor / Any | Refunded envelope displays "Returned to Sender" banner | PASS | 0 / 0 |
| `/e/5` | Acc 1 (`0x7099...79C8`) | Interrupted state detected: "Prior commitment found! You can proceed directly to open." | PASS | 0 / 0 |
| `/e/6` | Visitor / Any | 140-byte note envelope renders cleanly without layout overflow | PASS | 0 / 0 |
| `/mine` | Acc 0 (`0xf39F...2266`) | My Envelopes displays all 7 sealed envelopes partitioned with status tags and refund action for #3 | PASS | 0 / 0 |

## Feedback round 2

- **Item 1 (Local-stack autonomous mining):** Added `"--block-time", "1"` to Anvil startup args in `scripts/local-stack.mjs`. Seeding continues to complete cleanly with the final timestamp difference within ~2 minutes of real time (`diff: 0s`).
  - Command run to confirm blocks advance on their own:
    ```bash
    b1=$(cast block-number --rpc-url http://127.0.0.1:8707); sleep 3; b2=$(cast block-number --rpc-url http://127.0.0.1:8707); echo "$b1 -> $b2"
    ```
    Output: `60 -> 63` (+3 blocks produced automatically in 3 seconds).
  - End-to-end autonomous test: On a fresh seeded local stack, sealed envelope #7 (0.25 BOT) from Account 0 (`0xf39F...2266`), committed from Account 2 (`0x3C44...93BC`) at block 84, observed block height advance autonomously to 87 without manual mining, and redeemed at block 88. Verified state transitioned to 1 (`Redeemed`) and Account 2 received funds with zero manual mining.
- **Item 3 (Housekeeping):**
  - Removed 0-byte `public/favicon.ico` via `git rm`.
  - Added dedicated 192x192 PNG `app/icon.png` in project brand styling.
  - Configured `icons: { icon: "/icon.png" }` in `metadata` in `app/layout.tsx` so browsers request `/icon.png` directly and never request `/favicon.ico`.




## Feedback round 3

- **Footer Three-Link Compliance & Helper:**
  - Added fixed constants `BOTCHAIN_SITE_URL = "https://botchain.ai"` and `BOTCHAIN_EXPLORER_URL = "https://scan.botchain.ai"` in `lib/botchain/chain.ts`.
  - Added exported `footerLinks(chainId?: number): FooterLinks` returning `{ contract, site, explorer }` where `contract` is `<explorer for that chain>/address/<address>` (or `null` when undeployed).
  - Updated `BuiltOnBotChain` to use `footerLinks(activeBotChain.id).contract`.
  - Corrected Envelope's postmark stamp footer in `components/layout/PageShell.tsx` to include `BuiltOnBotChain`, `botchain.ai`, and `Explorer` using `footerLinks()`.
  - Added `app/not-found.tsx` wrapped in `PageShell` ensuring footer renders on 404 and unrouted states.
  - Added unit test suite in `lib/botchain/__tests__/chain.test.ts` covering chain IDs 677 and 968 for both deployed and undeployed configurations.

- **Browser-Check with Local Stack (port 8707 / 3007):**
  - `/` (Home): Verified all three links present (`https://scan.bohr.life/address/0x5fbdb2315678afecb367f032d93f642f64180aa3`, `https://botchain.ai`, `https://scan.botchain.ai`).
  - `/e/1` (Detail): Verified all three links present.
  - `/nonexistent` (Not Found): Verified all three links present.

## Feedback round 4

- **Item 1 (Shared CSS Tokens & Contrast):**
  - Defined missing token `--text-secondary: #4A3A1F` in `app/globals.css`. Provides 9.5:1 contrast against elevated paper ground (`#FAF5EB`), exceeding WCAG AAA (≥ 7:1) and AA requirements.
  - Added unit test `test/lint/tokens.test.ts` scanning `app/` and `components/` for undefined CSS variables without fallback.
  - Verified `python3 scripts/check-tokens.py envelope` exits 0 with zero undefined tokens.

- **Item 3 (Real Optical QR Code):**
  - Replaced deterministic mock QR with standards-compliant encoder `qrcode-generator` (v1.4.4 pinned).
  - Configured error correction level **M**, **4-module quiet zone**, `#000` modules on `#FFF` background, and minimum 200px sizing.
  - Added optical decode unit test `lib/__tests__/qrcode.test.ts` using `jsqr` (v1.4.0), rasterising an SVG data URL to RGBA bitmap and asserting `jsQR` decodes the exact envelope claim link (`https://envelope.botchain-apps.dev/e/7#ENV7-TEST-CODE-2026-AAAA`).

- **Item 5 (Form Background & Wax Seal Simplification):**
  - Redesigned `components/envelope/EnvelopeIllustration.tsx` to provide a solid, uncluttered paper surface (`#FAF5EB`) behind inputs and form text.
  - Eliminated diagonal flap clip paths and lines from behind inputs/buttons.
  - Relocated the wax seal stamp into the top postal identity strip beside the envelope amount / seal status, guaranteeing zero visual overlap with headings, note inputs, or claim buttons at both 360px mobile and 1280px desktop viewports.

