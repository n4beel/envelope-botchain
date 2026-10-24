import {
  encodeAbiParameters,
  keccak256,
  toHex,
  type Address,
  type Hex,
  type PublicClient,
} from "viem";
import { envelopeAbi } from "./botchain/abi";

export const CROCKFORD_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

export interface EnvView {
  id: bigint;
  sender: Address;
  amount: bigint;
  expiresAt: bigint;
  createdBlock: number;
  hash: Hex;
  taker: Address;
  state: number; // 0: Locked, 1: Redeemed, 2: Refunded, 3: Expired
}

/**
 * Calculates UTF-8 byte length for note and secret limits.
 */
export function byteLength(str: string): number {
  return new TextEncoder().encode(str).length;
}

/**
 * Normalises a Crockford Base32 secret code:
 * - uppercase
 * - strips whitespace and hyphens
 * - maps 'I' and 'L' to '1'
 * - maps 'O' to '0'
 */
export function normalizeCode(input: string): string {
  return input
    .toUpperCase()
    .replace(/[\s-]+/g, "")
    .replace(/[IL]/g, "1")
    .replace(/O/g, "0");
}

/**
 * Formats a 26-char normalised code with hyphens: ABCD-EFGH-JKMN-PQRS-TVWX-YZ
 */
export function formatCode(code: string): string {
  const norm = normalizeCode(code);
  const parts: string[] = [];
  for (let i = 0; i < norm.length; i += 4) {
    parts.push(norm.slice(i, i + 4));
  }
  return parts.join("-");
}

/**
 * Generates a 26-character Crockford Base32 secret code providing 130 bits of entropy.
 */
export function generateSecretCode(): string {
  const randomBytes = new Uint8Array(26);
  if (typeof crypto !== "undefined" && crypto.getRandomValues) {
    crypto.getRandomValues(randomBytes);
  } else {
    // Fallback for node environments without global crypto
    const { randomBytes: nodeRandom } = require("node:crypto");
    const buf = nodeRandom(26);
    randomBytes.set(buf);
  }

  let result = "";
  for (let i = 0; i < 26; i++) {
    const idx = randomBytes[i] % CROCKFORD_ALPHABET.length;
    result += CROCKFORD_ALPHABET[idx];
  }
  return formatCode(result);
}

/**
 * Converts normalised code to UTF-8 hex bytes.
 */
export function secretBytes(code: string): Hex {
  const norm = normalizeCode(code);
  return toHex(new TextEncoder().encode(norm));
}

/**
 * Computes on-chain hash: keccak256(secretBytes)
 */
export function hashOf(code: string): Hex {
  return keccak256(secretBytes(code));
}

/**
 * Computes commitment: keccak256(abi.encode(id, secretBytes, claimer))
 */
export function commitmentFor(id: bigint | number, code: string, claimer: Address): Hex {
  const encoded = encodeAbiParameters(
    [
      { name: "id", type: "uint256" },
      { name: "secret", type: "bytes" },
      { name: "claimer", type: "address" },
    ],
    [BigInt(id), secretBytes(code), claimer]
  );
  return keccak256(encoded);
}

/**
 * Estimates entropy in bits for custom passphrases.
 */
export function entropyBits(passphrase: string): number {
  if (!passphrase) return 0;
  let pool = 0;
  if (/[a-z]/.test(passphrase)) pool += 26;
  if (/[A-Z]/.test(passphrase)) pool += 26;
  if (/[0-9]/.test(passphrase)) pool += 10;
  if (/[^a-zA-Z0-9]/.test(passphrase)) pool += 32;
  if (pool === 0) pool = 10;
  return Math.round(passphrase.length * Math.log2(pool));
}

/**
 * Formats state label for display.
 */
export function stateLabel(state: number, expiresAt?: bigint | number, now?: number): string {
  if (state === 1) return "Opened";
  if (state === 2) return "Returned to Sender";

  const current = now ?? Math.floor(Date.now() / 1000);
  if (state === 3 || (expiresAt && BigInt(current) >= BigInt(expiresAt))) {
    return "Expired";
  }
  return "Sealed";
}

/**
 * Builds share URL with the code in the hash fragment.
 * Never in query params or pathname.
 */
export function buildShareUrl(id: bigint | number, code: string, origin = ""): string {
  const cleanOrigin = origin.replace(/\/+$/, "");
  return `${cleanOrigin}/e/${id.toString()}#${normalizeCode(code)}`;
}

/**
 * Extracts code from hash fragment or input string.
 */
export function parseFragmentCode(fragment: string): string {
  const clean = fragment.replace(/^#/, "").trim();
  return normalizeCode(clean);
}

/**
 * Cache for envelope notes so we don't query logs repeatedly.
 */
const noteCache = new Map<string, string>();

/**
 * Loads note from single-block Locked log.
 */
export async function loadEnvelopeNote(
  client: PublicClient,
  contractAddress: Address,
  id: bigint | number,
  createdBlock: bigint | number
): Promise<string> {
  const cacheKey = `${contractAddress}:${id}`;
  const cached = noteCache.get(cacheKey);
  if (cached !== undefined) return cached;

  try {
    const blockNum = BigInt(createdBlock);
    if (blockNum <= 0n) return "";

    const eventDef = envelopeAbi.find((i) => i.type === "event" && i.name === "Locked") as any;
    const logs = await client.getLogs({
      address: contractAddress,
      event: eventDef,
      args: { id: BigInt(id) },
      fromBlock: blockNum,
      toBlock: blockNum,
    });

    if (logs.length > 0 && (logs[0] as any).args?.note) {
      const note = (logs[0] as any).args.note as string;
      noteCache.set(cacheKey, note);
      return note;
    }
  } catch {
    // Fall back to empty note on error
  }

  noteCache.set(cacheKey, "");
  return "";
}
