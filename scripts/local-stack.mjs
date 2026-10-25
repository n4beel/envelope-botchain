/**
 * Local stack runner and seeder for Envelope.
 *
 * Spawns anvil on port 8707 with chain id 968, deploys Envelope, and seeds
 * the 6 scenarios from 07-envelope.md §5:
 * (1) locked, code known, 5 BOT
 * (2) redeemed by account 2
 * (3) expired and unrefunded, sender = account 0 (refundable)
 * (4) refunded
 * (5) locked with a commitment already made by account 1 (interrupted state)
 * (6) locked with a 140-byte note
 *
 * Usage:
 *   node scripts/local-stack.mjs
 */

import { spawn, execSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import {
  createPublicClient,
  createWalletClient,
  defineChain,
  encodeAbiParameters,
  http,
  keccak256,
  parseEther,
  toHex,
} from "viem";
import { mnemonicToAccount } from "viem/accounts";

const PORT = 8707;
const RPC = `http://127.0.0.1:${PORT}`;
const CHAIN_ID = 968;

const MNEMONIC = "test test test test test test test test test test test junk";

const local = defineChain({
  id: CHAIN_ID,
  name: "anvil",
  nativeCurrency: { name: "Test BOT", symbol: "tBOT", decimals: 18 },
  rpcUrls: { default: { http: [RPC] } },
});

try {
  execSync(`fuser -k ${PORT}/tcp 2>/dev/null || true`);
} catch {}

const realNow = Math.floor(Date.now() / 1000);
const TOTAL_WARP = 3605;
const startTimestamp = realNow - TOTAL_WARP;

console.log(`Starting anvil on port ${PORT} (timestamp: ${startTimestamp})...`);
spawn(
  "anvil",
  [
    "--port",
    String(PORT),
    "--chain-id",
    String(CHAIN_ID),
    "--accounts",
    "10",
    "--timestamp",
    String(startTimestamp),
    "--block-time",
    "1",
    "--silent",
  ],
  {
    detached: true,
    stdio: "ignore",
  }
).unref();

const pub = createPublicClient({ chain: local, transport: http() });

const accounts = Array.from({ length: 10 }, (_, i) =>
  mnemonicToAccount(MNEMONIC, { addressIndex: i })
);
const wallets = accounts.map((acc) =>
  createWalletClient({ account: acc, chain: local, transport: http() })
);

// Wait for anvil to answer
for (let i = 0; ; i++) {
  try {
    await pub.getBlockNumber();
    break;
  } catch {
    if (i > 100) throw new Error(`anvil never answered on ${RPC}`);
    await new Promise((r) => setTimeout(r, 100));
  }
}

const envelopeArtifact = JSON.parse(
  readFileSync("contracts/out/Envelope.sol/Envelope.json", "utf8")
);
const envelopeAbi = envelopeArtifact.abi;

function normalizeCode(input) {
  return input
    .toUpperCase()
    .replace(/[\s-]+/g, "")
    .replace(/[IL]/g, "1")
    .replace(/O/g, "0");
}

function secretBytes(code) {
  return toHex(new TextEncoder().encode(normalizeCode(code)));
}

function hashOf(code) {
  return keccak256(secretBytes(code));
}

function commitmentFor(id, code, claimer) {
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

console.log("Deploying Envelope contract...");
const deployHash = await wallets[0].deployContract({
  abi: envelopeAbi,
  bytecode: envelopeArtifact.bytecode.object,
  args: [],
  chain: local,
  account: accounts[0],
});
const deployReceipt = await pub.waitForTransactionReceipt({ hash: deployHash });
const envelopeAddress = deployReceipt.contractAddress;
const deployBlock = deployReceipt.blockNumber;
console.log(`Envelope deployed to ${envelopeAddress} at block ${deployBlock}`);

// Scenario 1: Locked, code known, 5 BOT
const code1 = "ENV1-5BOT-GIFT-LOCK-2026-AAAA";
console.log(`Seeding Scenario 1: Locked, 5 BOT... Code: ${code1}`);
const h1 = await wallets[0].writeContract({
  address: envelopeAddress,
  abi: envelopeAbi,
  functionName: "lock",
  args: [hashOf(code1), 2592000n, "Enjoy the 5 BOT gift!"],
  value: parseEther("5"),
  chain: local,
  account: accounts[0],
});
await pub.waitForTransactionReceipt({ hash: h1 });

// Scenario 2: Redeemed by account 2 (1 BOT)
const code2 = "ENV2-REED-TAKN-PASS-2026-BBBB";
console.log(`Seeding Scenario 2: Redeemed by Account 2... Code: ${code2}`);
const h2 = await wallets[0].writeContract({
  address: envelopeAddress,
  abi: envelopeAbi,
  functionName: "lock",
  args: [hashOf(code2), 604800n, "Redeemed by Account 2"],
  value: parseEther("1"),
  chain: local,
  account: accounts[0],
});
await pub.waitForTransactionReceipt({ hash: h2 });

const c2 = await wallets[2].writeContract({
  address: envelopeAddress,
  abi: envelopeAbi,
  functionName: "commit",
  args: [2n, commitmentFor(2n, code2, accounts[2].address)],
  chain: local,
  account: accounts[2],
});
await pub.waitForTransactionReceipt({ hash: c2 });
await pub.request({ method: "evm_mine", params: [] });

const r2 = await wallets[2].writeContract({
  address: envelopeAddress,
  abi: envelopeAbi,
  functionName: "redeem",
  args: [2n, secretBytes(code2)],
  chain: local,
  account: accounts[2],
});
await pub.waitForTransactionReceipt({ hash: r2 });

// Scenario 3: Expired and unrefunded, sender = account 0 (refundable)
const code3 = "ENV3-EXPD-UNRF-PASS-2026-CCCC";
console.log(`Seeding Scenario 3: Expired and unrefunded (refundable)... Code: ${code3}`);
const h3 = await wallets[0].writeContract({
  address: envelopeAddress,
  abi: envelopeAbi,
  functionName: "lock",
  args: [hashOf(code3), 3600n, "Expired and refundable"],
  value: parseEther("1"),
  chain: local,
  account: accounts[0],
});
await pub.waitForTransactionReceipt({ hash: h3 });

// Scenario 4: Refunded (1.5 BOT)
const code4 = "ENV4-RFND-DONE-PASS-2026-DDDD";
console.log(`Seeding Scenario 4: Refunded to Account 0... Code: ${code4}`);
const h4 = await wallets[0].writeContract({
  address: envelopeAddress,
  abi: envelopeAbi,
  functionName: "lock",
  args: [hashOf(code4), 3600n, "Refunded note"],
  value: parseEther("1.5"),
  chain: local,
  account: accounts[0],
});
await pub.waitForTransactionReceipt({ hash: h4 });

// Advance time past 1 hour (3605 seconds) so #3 and #4 expire
await pub.request({ method: "evm_increaseTime", params: [3605] });
await pub.request({ method: "evm_mine", params: [] });

// Account 0 refunds envelope 4
const ref4 = await wallets[0].writeContract({
  address: envelopeAddress,
  abi: envelopeAbi,
  functionName: "refund",
  args: [4n],
  chain: local,
  account: accounts[0],
});
await pub.waitForTransactionReceipt({ hash: ref4 });

// Scenario 5: Locked with a commitment already made by account 1 (interrupted state, 2 BOT)
const code5 = "ENV5-COMM-INTR-PASS-2026-EEEE";
console.log(`Seeding Scenario 5: Commitment made by Account 1 (interrupted)... Code: ${code5}`);
const h5 = await wallets[0].writeContract({
  address: envelopeAddress,
  abi: envelopeAbi,
  functionName: "lock",
  args: [hashOf(code5), 604800n, "Commitment already made"],
  value: parseEther("2"),
  chain: local,
  account: accounts[0],
});
await pub.waitForTransactionReceipt({ hash: h5 });

const c5 = await wallets[1].writeContract({
  address: envelopeAddress,
  abi: envelopeAbi,
  functionName: "commit",
  args: [5n, commitmentFor(5n, code5, accounts[1].address)],
  chain: local,
  account: accounts[1],
});
await pub.waitForTransactionReceipt({ hash: c5 });
await pub.request({ method: "evm_mine", params: [] });

// Scenario 6: Locked with a 140-byte note (0.5 BOT)
const code6 = "ENV6-NOTE-140B-PASS-2026-FFFF";
const note6 = "This is a full one hundred and forty byte note sealed in this digital envelope on the botchain network. Safe, decentralized, and private.".slice(0, 140).padEnd(140, ".");
console.log(`Seeding Scenario 6: 140-byte note (length ${new TextEncoder().encode(note6).length} bytes)... Code: ${code6}`);
const h6 = await wallets[0].writeContract({
  address: envelopeAddress,
  abi: envelopeAbi,
  functionName: "lock",
  args: [hashOf(code6), 1209600n, note6],
  value: parseEther("0.5"),
  chain: local,
  account: accounts[0],
});
await pub.waitForTransactionReceipt({ hash: h6 });

// Assert final chain time is within 2 minutes of real time
const finalBlock = await pub.getBlock();
const finalTime = Number(finalBlock.timestamp);
const nowSec = Math.floor(Date.now() / 1000);
const diffSec = Math.abs(finalTime - nowSec);
console.log(`Final chain timestamp: ${finalTime} (real: ${nowSec}, diff: ${diffSec}s)`);
if (diffSec > 120) {
  throw new Error(`Chain time ${finalTime} differs from real time by ${diffSec}s (max 120s allowed)`);
}

console.log("Writing .env.local...");
const envContent = [
  "# Written by scripts/local-stack.mjs for Envelope",
  "NEXT_PUBLIC_BOTCHAIN_NETWORK=testnet",
  `NEXT_PUBLIC_BOHR_RPC=${RPC}`,
  `NEXT_PUBLIC_CHAIN_ID=${CHAIN_ID}`,
  `NEXT_PUBLIC_RPC_URL_968=${RPC}`,
  `NEXT_PUBLIC_CONTRACT_968=${envelopeAddress}`,
  `NEXT_PUBLIC_DEPLOY_BLOCK_968=${deployBlock > 1n ? deployBlock - 1n : 1n}`,
  "",
].join("\n");
writeFileSync(".env.local", envContent);

console.log("\n========================================================");
console.log(`Envelope Local Stack Running on ${RPC}`);
console.log("========================================================");
console.log("Account Role Table:");
console.log("--------------------------------------------------------");
console.log(`Acc 0: ${accounts[0].address} (Sender of all 6 envelopes; refunded #4)`);
console.log(`Acc 1: ${accounts[1].address} (Committed to #5 - interrupted claimer)`);
console.log(`Acc 2: ${accounts[2].address} (Redeemed envelope #2)`);
console.log(`Acc 3..9: Available test claimers / recipients`);
console.log("--------------------------------------------------------");
console.log(`Scenario 1 (Locked, 5 BOT):      /e/1#${code1}`);
console.log(`Scenario 2 (Redeemed):           /e/2#${code2}`);
console.log(`Scenario 3 (Expired, unrefunded):/e/3#${code3}`);
console.log(`Scenario 4 (Refunded):           /e/4#${code4}`);
console.log(`Scenario 5 (Interrupted commit): /e/5#${code5}`);
console.log(`Scenario 6 (140-byte note):      /e/6#${code6}`);
console.log("========================================================\n");

