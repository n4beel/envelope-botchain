# Envelope

Send BOT sealed with a secret code.

## What it does
Envelope lets anyone seal native BOT inside a smart contract using a cryptographic secret code. Whoever possesses the code can claim the enclosed funds:
- **Time-Sealed Transfers:** Anyone can seal an amount of BOT for a duration between 1 hour and 365 days, with an optional 140-byte note.
- **Commit-Reveal Claim Protection:** Claiming requires a two-step commit-reveal sequence:
  1. The recipient commits `keccak256(abi.encode(id, secret, claimerAddress))`.
  2. In a later block (`block.number > commitBlock`), the recipient reveals `secret` to claim the funds.
  3. This ensures that mempool eavesdroppers, searchers, and block builders cannot steal the secret code from a pending transaction.
- **Strict URL Fragment Security:** Shareable links place the secret code strictly in the URL hash fragment (`/e/{id}#{CODE}`). Hash fragments are processed purely by client browsers and are never transmitted over HTTP or logged in web server access logs.
- **Local Pre-flight Hash Verification:** The frontend computes `keccak256(normalizeCode(code))` and compares it to the on-chain envelope hash before asking the wallet to sign the commit transaction, preventing any gas expenditure on invalid or mistyped codes.
- **Sender Refund Guarantee:** If an envelope expires without being claimed, the sender can retrieve their full principal via `refund(id)`.
- **Crockford Base32 Code Generation:** Automatically generates 26-character codes providing 130 bits of cryptographic entropy, resilient to mistyping (`I`/`L` mapped to `1`, `O` mapped to `0`, hyphens and whitespace stripped).

## What it deliberately cannot do
- **No Early Cancellation:** The sender cannot retrieve funds before the expiration timestamp has lapsed. Once sealed, the transfer is strictly committed to the secret holder.
- **No On-Chain Code Recovery:** The blockchain stores only the keccak256 hash. If the sender forgets the code and did not save it, the funds can only be recovered after the envelope expires.
- **No Admin, Backdoor, or Pause:** There is no protocol admin, no governance override, no emergency pause, and no upgrade proxy.
- **No Server-Side Custody:** Everything executes directly against BOT Chain. No intermediate custodial relays or off-chain servers exist.

## Gas consumption
- `lock`: **~158,171 gas** (ceiling: 175,000)
- `commit`: **~68,000 – 75,000 gas** (ceiling: 80,000)
- `redeem`: **~48,000 – 58,000 gas** (ceiling: 70,000)
- `refund`: **~38,000 – 45,000 gas** (ceiling: 55,000)

## Design Archetype
**Archetype M · Object**
- **Illustrated Physical Object:** The UI is dominated by an illustrated envelope resting on a textured kraft ground (`#C9A872`), with cream paper (`#F6EFE0`), subtle paper texture, and an embossed wax seal (`#7A1523`).
- **Physical Motion:**
  - The envelope flap physically opens (450ms smooth transition) when claim preparation completes.
  - The enclosed letter sheet slides up with the revealed note.
  - Reduced-motion accessibility fallback replaces animations with instant state updates.
- **Navigation via Luggage Tag:** No generic top navbars or standard cards. Secondary actions are hanging tags tied with string (`/mine`). Footer attribution is styled as a vintage postmark stamp along the bottom edge.
- **Offline QR Code:** Features an offline, zero-dependency SVG QR matrix generator.
- **Strict WCAG Contrast Compliance:**
  - Ink (`#2A1D0E`) on kraft (`#C9A872`): **7.3:1** (Passes AAA)
  - Muted text (`#4A3A1F`) on kraft (`#C9A872`): **4.9:1** (Passes AA)
  - Wax red (`#7A1523`) on kraft (`#C9A872`): **4.8:1** (Passes AA)
  - Cream paper (`#F6EFE0`) on wax red (`#7A1523`): **9.7:1** (Passes AAA)
  - Deep ink (`#2A1D0E`) on cream paper (`#F6EFE0`): **12.4:1** (Passes AAA)
