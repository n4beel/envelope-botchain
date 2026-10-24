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
# Result: 2 passed test files, 17 passed tests (port 8607)

# 5. Production build
npm run build # (next build)
# Result: compiled successfully with static and dynamic routes

# 6. Distinctness check
python3 scripts/check-distinct.py envelope
# Result: 22 projects compared; 0 pair/file problem(s)
```
