import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import { readFileSync } from "node:fs";
import {
  BaseError,
  createPublicClient,
  createWalletClient,
  defineChain,
  http,
  keccak256,
  parseEther,
  parseEventLogs,
  toHex,
  type Address,
  type Hex,
  type PublicClient,
  type WalletClient,
} from "viem";
import { mnemonicToAccount } from "viem/accounts";
import { envelopeAbi } from "@/lib/botchain/abi";
import {
  commitmentFor,
  generateSecretCode,
  hashOf,
  loadEnvelopeNote,
  normalizeCode,
  secretBytes,
} from "@/lib/envelope";
import {
  MAX_DURATION,
  MAX_NOTE_BYTES,
  MAX_PAGE,
  MAX_SECRET_BYTES,
  MIN_DURATION,
} from "@/lib/limits";

const PORT = 8607;
const RPC = `http://127.0.0.1:${PORT}`;
const CHAIN_ID = 968 as const;

const MNEMONIC = "test test test test test test test test test test test junk";
const accounts = Array.from({ length: 8 }, (_, i) =>
  mnemonicToAccount(MNEMONIC, { addressIndex: i })
);

const local = defineChain({
  id: CHAIN_ID,
  name: "anvil",
  nativeCurrency: { name: "Test BOT", symbol: "tBOT", decimals: 18 },
  rpcUrls: { default: { http: [RPC] } },
});

let node: ChildProcess;
let publicClient: PublicClient;
let wallets: WalletClient[];
let envelopeAddress: Address;

function revertDetails(err: unknown): { errorName?: string; args?: readonly unknown[] } | undefined {
  if (!(err instanceof BaseError)) return undefined;
  const found = err.walk(
    (e) =>
      typeof e === "object" &&
      e !== null &&
      "data" in e &&
      Boolean((e as { data?: { errorName?: string } }).data?.errorName)
  ) as { data?: { errorName?: string; args?: readonly unknown[] } } | null;
  return found?.data;
}

async function mineBlock() {
  await (publicClient.request as any)({ method: "evm_mine" });
}

async function increaseTime(seconds: number) {
  await (publicClient.request as any)({ method: "evm_increaseTime", params: [seconds] });
}

beforeAll(async () => {
  node = spawn("anvil", ["--port", String(PORT), "--chain-id", String(CHAIN_ID), "--silent"], {
    stdio: ["ignore", "ignore", "inherit"],
  });

  publicClient = createPublicClient({ chain: local, transport: http() }) as PublicClient;
  wallets = accounts.map((acc) =>
    createWalletClient({ account: acc, chain: local, transport: http() })
  );

  for (let i = 0; ; i++) {
    try {
      await publicClient.getBlockNumber();
      break;
    } catch {
      if (i > 100) throw new Error(`anvil never answered on ${RPC}`);
      await new Promise((r) => setTimeout(r, 100));
    }
  }

  // Deploy Envelope contract
  const artifact = JSON.parse(
    readFileSync("contracts/out/Envelope.sol/Envelope.json", "utf8")
  ) as { abi: any; bytecode: { object: Hex } };

  const hash = await wallets[0].deployContract({
    abi: artifact.abi,
    bytecode: artifact.bytecode.object,
    args: [],
    chain: local,
    account: accounts[0],
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  envelopeAddress = receipt.contractAddress!;
});

afterAll(() => {
  if (node) {
    node.kill();
  }
});

describe("Envelope integration tests", () => {
  it("deploys Envelope contract", () => {
    expect(envelopeAddress).toMatch(/^0x[0-9a-fA-F]{40}$/);
  });

  it("verifies TS hashOf and commitmentFor test vectors match contract expectations", async () => {
    const code = "ABCD-EFGH-JKMN-PQRS";
    const norm = normalizeCode(code);
    const expectedSecretBytes = toHex(new TextEncoder().encode(norm));
    expect(secretBytes(code)).toBe(expectedSecretBytes);

    const expectedHash = keccak256(expectedSecretBytes);
    expect(hashOf(code)).toBe(expectedHash);

    const claimer = accounts[1].address;
    const commitment = commitmentFor(1n, code, claimer);
    expect(commitment).toMatch(/^0x[0-9a-fA-F]{64}$/);
  });

  it("executes full lock -> commit -> (same-block redeem reverts TooSoon) -> mine -> redeem", async () => {
    const code = generateSecretCode();
    const hash = hashOf(code);
    const amount = parseEther("1");

    // 1. Lock envelope
    const lockHash = await wallets[0].writeContract({
      address: envelopeAddress,
      abi: envelopeAbi,
      functionName: "lock",
      args: [hash, 86400n, "Secret gift"],
      value: amount,
      chain: local,
      account: accounts[0],
    });
    const lockReceipt = await publicClient.waitForTransactionReceipt({ hash: lockHash });
    expect(lockReceipt.status).toBe("success");

    // Find Locked event to get id
    const logs = await publicClient.getContractEvents({
      address: envelopeAddress,
      abi: envelopeAbi,
      eventName: "Locked",
      fromBlock: lockReceipt.blockNumber,
      toBlock: lockReceipt.blockNumber,
    });
    expect(logs.length).toBe(1);
    const id = logs[0].args.id!;

    // 2. Commit from Account 1
    const commitment = commitmentFor(id, code, accounts[1].address);
    const commitHash = await wallets[1].writeContract({
      address: envelopeAddress,
      abi: envelopeAbi,
      functionName: "commit",
      args: [id, commitment],
      chain: local,
      account: accounts[1],
    });
    const commitReceipt = await publicClient.waitForTransactionReceipt({ hash: commitHash });
    expect(commitReceipt.status).toBe("success");

    // 3. Same-block redeem attempt: should revert TooSoon
    try {
      await publicClient.simulateContract({
        address: envelopeAddress,
        abi: envelopeAbi,
        functionName: "redeem",
        args: [id, secretBytes(code)],
        account: accounts[1].address,
        blockNumber: commitReceipt.blockNumber,
      });
      expect.unreachable("expected TooSoon revert in same block");
    } catch (err) {
      const details = revertDetails(err);
      expect(details?.errorName).toBe("TooSoon");
    }

    // 4. Mine 1 block
    await mineBlock();

    // 5. Redeem from Account 1
    const balBefore = await publicClient.getBalance({ address: accounts[1].address });
    const redeemHash = await wallets[1].writeContract({
      address: envelopeAddress,
      abi: envelopeAbi,
      functionName: "redeem",
      args: [id, secretBytes(code)],
      chain: local,
      account: accounts[1],
    });
    const redeemReceipt = await publicClient.waitForTransactionReceipt({ hash: redeemHash });
    expect(redeemReceipt.status).toBe("success");

    const balAfter = await publicClient.getBalance({ address: accounts[1].address });
    const gasUsed = redeemReceipt.gasUsed * redeemReceipt.effectiveGasPrice;
    expect(balAfter + gasUsed - balBefore).toBe(amount);

    // 6. Verify state is Redeemed (1)
    const env = await publicClient.readContract({
      address: envelopeAddress,
      abi: envelopeAbi,
      functionName: "envelopeOf",
      args: [id],
    });
    expect(env.state).toBe(1);
    expect(env.taker.toLowerCase()).toBe(accounts[1].address.toLowerCase());
  });

  it("fails stolen-calldata attack (attacker lacks commit)", async () => {
    const code = generateSecretCode();
    const hash = hashOf(code);
    const amount = parseEther("0.5");

    // Account 0 locks
    const lockHash = await wallets[0].writeContract({
      address: envelopeAddress,
      abi: envelopeAbi,
      functionName: "lock",
      args: [hash, 86400n, "Attacker test"],
      value: amount,
      chain: local,
      account: accounts[0],
    });
    const lockReceipt = await publicClient.waitForTransactionReceipt({ hash: lockHash });
    const logs = await publicClient.getContractEvents({
      address: envelopeAddress,
      abi: envelopeAbi,
      eventName: "Locked",
      fromBlock: lockReceipt.blockNumber,
      toBlock: lockReceipt.blockNumber,
    });
    const id = logs[0].args.id!;

    // Account 1 commits
    const commitment = commitmentFor(id, code, accounts[1].address);
    const commitHash = await wallets[1].writeContract({
      address: envelopeAddress,
      abi: envelopeAbi,
      functionName: "commit",
      args: [id, commitment],
      chain: local,
      account: accounts[1],
    });
    await publicClient.waitForTransactionReceipt({ hash: commitHash });
    await mineBlock();

    // Attacker (Account 2) attempts to redeem using Account 1's secretBytes without prior commit
    try {
      await publicClient.simulateContract({
        address: envelopeAddress,
        abi: envelopeAbi,
        functionName: "redeem",
        args: [id, secretBytes(code)],
        account: accounts[2].address,
      });
      expect.unreachable("expected NotCommitted revert for attacker");
    } catch (err) {
      const details = revertDetails(err);
      expect(details?.errorName).toBe("NotCommitted");
    }
  });

  it("protects against attacker committing after seeing victim's secret", async () => {
    const code = generateSecretCode();
    const hash = hashOf(code);
    const amount = parseEther("0.2");

    // Account 0 locks
    const lockHash = await wallets[0].writeContract({
      address: envelopeAddress,
      abi: envelopeAbi,
      functionName: "lock",
      args: [hash, 86400n, "Front-run test"],
      value: amount,
      chain: local,
      account: accounts[0],
    });
    const lockReceipt = await publicClient.waitForTransactionReceipt({ hash: lockHash });
    const logs = await publicClient.getContractEvents({
      address: envelopeAddress,
      abi: envelopeAbi,
      eventName: "Locked",
      fromBlock: lockReceipt.blockNumber,
      toBlock: lockReceipt.blockNumber,
    });
    const id = logs[0].args.id!;

    // Victim (Account 1) commits
    const cVictim = commitmentFor(id, code, accounts[1].address);
    const cTx = await wallets[1].writeContract({
      address: envelopeAddress,
      abi: envelopeAbi,
      functionName: "commit",
      args: [id, cVictim],
      chain: local,
      account: accounts[1],
    });
    await publicClient.waitForTransactionReceipt({ hash: cTx });
    await mineBlock();

    // Victim redeems
    const rTx = await wallets[1].writeContract({
      address: envelopeAddress,
      abi: envelopeAbi,
      functionName: "redeem",
      args: [id, secretBytes(code)],
      chain: local,
      account: accounts[1],
    });
    await publicClient.waitForTransactionReceipt({ hash: rTx });

    // Attacker commits now
    const cAttacker = commitmentFor(id, code, accounts[2].address);
    // Attacker commit will revert Expired or NotLocked because envelope is already redeemed!
    try {
      await publicClient.simulateContract({
        address: envelopeAddress,
        abi: envelopeAbi,
        functionName: "commit",
        args: [id, cAttacker],
        account: accounts[2].address,
      });
      expect.unreachable("expected NotLocked revert when committing to already redeemed envelope");
    } catch (err) {
      const details = revertDetails(err);
      expect(details?.errorName).toBe("NotLocked");
    }
  });

  it("reverts WrongSecret if redeem is called with incorrect secret", async () => {
    const codeA = "SECRET-A-1234-5678-90AB-CDEF";
    const codeB = "SECRET-B-1234-5678-90AB-CDEF";
    const amount = parseEther("0.1");

    // Locked with codeA
    const lockHash = await wallets[0].writeContract({
      address: envelopeAddress,
      abi: envelopeAbi,
      functionName: "lock",
      args: [hashOf(codeA), 86400n, "Wrong secret test"],
      value: amount,
      chain: local,
      account: accounts[0],
    });
    const lockReceipt = await publicClient.waitForTransactionReceipt({ hash: lockHash });
    const logs = await publicClient.getContractEvents({
      address: envelopeAddress,
      abi: envelopeAbi,
      eventName: "Locked",
      fromBlock: lockReceipt.blockNumber,
      toBlock: lockReceipt.blockNumber,
    });
    const id = logs[0].args.id!;

    // Commit codeB (matches the secret we will reveal, but not the envelope hash)
    const cHash = await wallets[1].writeContract({
      address: envelopeAddress,
      abi: envelopeAbi,
      functionName: "commit",
      args: [id, commitmentFor(id, codeB, accounts[1].address)],
      chain: local,
      account: accounts[1],
    });
    await publicClient.waitForTransactionReceipt({ hash: cHash });
    await mineBlock();

    // Attempt redeem with codeB: commitment matches caller, but secret does not match envelope
    try {
      await publicClient.simulateContract({
        address: envelopeAddress,
        abi: envelopeAbi,
        functionName: "redeem",
        args: [id, secretBytes(codeB)],
        account: accounts[1].address,
      });
      expect.unreachable("expected WrongSecret revert");
    } catch (err) {
      const details = revertDetails(err);
      expect(details?.errorName).toBe("WrongSecret");
    }
  });

  it("reverts BadCommitment if commitment does not match caller or envelope id", async () => {
    const code = generateSecretCode();
    const amount = parseEther("0.1");

    const lockHash = await wallets[0].writeContract({
      address: envelopeAddress,
      abi: envelopeAbi,
      functionName: "lock",
      args: [hashOf(code), 86400n, "Bad commitment test"],
      value: amount,
      chain: local,
      account: accounts[0],
    });
    const lockReceipt = await publicClient.waitForTransactionReceipt({ hash: lockHash });
    const logs = await publicClient.getContractEvents({
      address: envelopeAddress,
      abi: envelopeAbi,
      eventName: "Locked",
      fromBlock: lockReceipt.blockNumber,
      toBlock: lockReceipt.blockNumber,
    });
    const id = logs[0].args.id!;

    // Account 1 commits with commitment for Account 2
    const badCommitment = commitmentFor(id, code, accounts[2].address);
    const cHash = await wallets[1].writeContract({
      address: envelopeAddress,
      abi: envelopeAbi,
      functionName: "commit",
      args: [id, badCommitment],
      chain: local,
      account: accounts[1],
    });
    await publicClient.waitForTransactionReceipt({ hash: cHash });
    await mineBlock();

    // Account 1 attempts redeem
    try {
      await publicClient.simulateContract({
        address: envelopeAddress,
        abi: envelopeAbi,
        functionName: "redeem",
        args: [id, secretBytes(code)],
        account: accounts[1].address,
      });
      expect.unreachable("expected BadCommitment revert");
    } catch (err) {
      const details = revertDetails(err);
      expect(details?.errorName).toBe("BadCommitment");
    }
  });

  it("handles expiry and refund flow cleanly", async () => {
    const code = generateSecretCode();
    const amount = parseEther("0.5");
    const duration = 3600n; // 1 hour minimum

    const lockHash = await wallets[0].writeContract({
      address: envelopeAddress,
      abi: envelopeAbi,
      functionName: "lock",
      args: [hashOf(code), duration, "Refund test"],
      value: amount,
      chain: local,
      account: accounts[0],
    });
    const lockReceipt = await publicClient.waitForTransactionReceipt({ hash: lockHash });
    const logs = await publicClient.getContractEvents({
      address: envelopeAddress,
      abi: envelopeAbi,
      eventName: "Locked",
      fromBlock: lockReceipt.blockNumber,
      toBlock: lockReceipt.blockNumber,
    });
    const id = logs[0].args.id!;

    // 1. Before expiry, refund from sender reverts NotExpired
    try {
      await publicClient.simulateContract({
        address: envelopeAddress,
        abi: envelopeAbi,
        functionName: "refund",
        args: [id],
        account: accounts[0].address,
      });
      expect.unreachable("expected NotExpired revert");
    } catch (err) {
      const details = revertDetails(err);
      expect(details?.errorName).toBe("NotExpired");
    }

    // 2. Before expiry, refund from non-sender reverts NotSender
    try {
      await publicClient.simulateContract({
        address: envelopeAddress,
        abi: envelopeAbi,
        functionName: "refund",
        args: [id],
        account: accounts[1].address,
      });
      expect.unreachable("expected NotSender revert");
    } catch (err) {
      const details = revertDetails(err);
      expect(details?.errorName).toBe("NotSender");
    }

    // 3. Fast-forward past expiry (3605 seconds)
    await increaseTime(3605);
    await mineBlock();

    // 4. Commit after expiry reverts Expired
    try {
      await publicClient.simulateContract({
        address: envelopeAddress,
        abi: envelopeAbi,
        functionName: "commit",
        args: [id, commitmentFor(id, code, accounts[1].address)],
        account: accounts[1].address,
      });
      expect.unreachable("expected Expired revert on commit");
    } catch (err) {
      const details = revertDetails(err);
      expect(details?.errorName).toBe("Expired");
    }

    // 5. Refund by sender succeeds and returns funds
    const balBefore = await publicClient.getBalance({ address: accounts[0].address });
    const refundHash = await wallets[0].writeContract({
      address: envelopeAddress,
      abi: envelopeAbi,
      functionName: "refund",
      args: [id],
      chain: local,
      account: accounts[0],
    });
    const refundReceipt = await publicClient.waitForTransactionReceipt({ hash: refundHash });
    expect(refundReceipt.status).toBe("success");

    const balAfter = await publicClient.getBalance({ address: accounts[0].address });
    const gasUsed = refundReceipt.gasUsed * refundReceipt.effectiveGasPrice;
    expect(balAfter + gasUsed - balBefore).toBe(amount);

    // 6. Envelope state is Refunded (2)
    const env = await publicClient.readContract({
      address: envelopeAddress,
      abi: envelopeAbi,
      functionName: "envelopeOf",
      args: [id],
    });
    expect(env.state).toBe(2);

    // 7. Calling refund again reverts NotLocked
    try {
      await publicClient.simulateContract({
        address: envelopeAddress,
        abi: envelopeAbi,
        functionName: "refund",
        args: [id],
        account: accounts[0].address,
      });
      expect.unreachable("expected NotLocked revert on double refund");
    } catch (err) {
      const details = revertDetails(err);
      expect(details?.errorName).toBe("NotLocked");
    }
  });

  it("handles Crockford Base32 normalization edge cases end-to-end", async () => {
    // Original secret with characters that can be mistyped:
    // 'O' (oh) -> '0' (zero), 'I'/'L' -> '1'
    const originalCode = "K7M9-2P4Q-8V3X-5Y10";
    const userTyped = "  k7m9 - 2p4q - 8v3x - 5ylo  "; // lowercase, spaces, 'l' and 'o'

    expect(normalizeCode(userTyped)).toBe(normalizeCode(originalCode));

    const hash = hashOf(originalCode);
    const amount = parseEther("0.05");

    const lockHash = await wallets[0].writeContract({
      address: envelopeAddress,
      abi: envelopeAbi,
      functionName: "lock",
      args: [hash, 86400n, "Normalization test"],
      value: amount,
      chain: local,
      account: accounts[0],
    });
    const lockReceipt = await publicClient.waitForTransactionReceipt({ hash: lockHash });
    const logs = await publicClient.getContractEvents({
      address: envelopeAddress,
      abi: envelopeAbi,
      eventName: "Locked",
      fromBlock: lockReceipt.blockNumber,
      toBlock: lockReceipt.blockNumber,
    });
    const id = logs[0].args.id!;

    // Commit using userTyped code
    const cHash = await wallets[3].writeContract({
      address: envelopeAddress,
      abi: envelopeAbi,
      functionName: "commit",
      args: [id, commitmentFor(id, userTyped, accounts[3].address)],
      chain: local,
      account: accounts[3],
    });
    await publicClient.waitForTransactionReceipt({ hash: cHash });
    await mineBlock();

    // Redeem using userTyped code
    const rHash = await wallets[3].writeContract({
      address: envelopeAddress,
      abi: envelopeAbi,
      functionName: "redeem",
      args: [id, secretBytes(userTyped)],
      chain: local,
      account: accounts[3],
    });
    const rReceipt = await publicClient.waitForTransactionReceipt({ hash: rHash });
    expect(rReceipt.status).toBe("success");

    const env = await publicClient.readContract({
      address: envelopeAddress,
      abi: envelopeAbi,
      functionName: "envelopeOf",
      args: [id],
    });
    expect(env.state).toBe(1);
    expect(env.taker.toLowerCase()).toBe(accounts[3].address.toLowerCase());
  });

  it("loads 140-byte note from event log using loadEnvelopeNote", async () => {
    const code = generateSecretCode();
    const note140 = "A".repeat(140);

    const lockHash = await wallets[0].writeContract({
      address: envelopeAddress,
      abi: envelopeAbi,
      functionName: "lock",
      args: [hashOf(code), 86400n, note140],
      value: parseEther("0.01"),
      chain: local,
      account: accounts[0],
    });
    const lockReceipt = await publicClient.waitForTransactionReceipt({ hash: lockHash });
    const logs = await publicClient.getContractEvents({
      address: envelopeAddress,
      abi: envelopeAbi,
      eventName: "Locked",
      fromBlock: lockReceipt.blockNumber,
      toBlock: lockReceipt.blockNumber,
    });
    const id = logs[0].args.id!;

    const loadedNote = await loadEnvelopeNote(
      publicClient,
      envelopeAddress,
      id,
      lockReceipt.blockNumber
    );
    expect(loadedNote).toBe(note140);
  });

  it("retrieves envelopes using envelopeCount and envelopesBy pagination", async () => {
    const count = await publicClient.readContract({
      address: envelopeAddress,
      abi: envelopeAbi,
      functionName: "envelopeCount",
    });
    expect(count).toBeGreaterThan(0n);

    const senderEnvelopes = await publicClient.readContract({
      address: envelopeAddress,
      abi: envelopeAbi,
      functionName: "envelopesBy",
      args: [accounts[0].address],
    });
    expect(senderEnvelopes.length).toBeGreaterThan(0);
  });

  it("verifies contract limits match lib/limits constants", async () => {
    const minDur = await publicClient.readContract({
      address: envelopeAddress,
      abi: envelopeAbi,
      functionName: "MIN_DURATION",
    });
    expect(minDur).toBe(MIN_DURATION);

    const maxDur = await publicClient.readContract({
      address: envelopeAddress,
      abi: envelopeAbi,
      functionName: "MAX_DURATION",
    });
    expect(maxDur).toBe(MAX_DURATION);

    const maxNote = await publicClient.readContract({
      address: envelopeAddress,
      abi: envelopeAbi,
      functionName: "MAX_NOTE_BYTES",
    });
    expect(Number(maxNote)).toBe(MAX_NOTE_BYTES);

    const maxSecret = await publicClient.readContract({
      address: envelopeAddress,
      abi: envelopeAbi,
      functionName: "MAX_SECRET_BYTES",
    });
    expect(Number(maxSecret)).toBe(MAX_SECRET_BYTES);

    const maxPage = await publicClient.readContract({
      address: envelopeAddress,
      abi: envelopeAbi,
      functionName: "MAX_PAGE",
    });
    expect(Number(maxPage)).toBe(MAX_PAGE);
  });

  it("measures gas against ceilings", async () => {
    const code = generateSecretCode();
    const hash = hashOf(code);
    const duration = 3600n;
    const amount = parseEther("0.1");

    // Lock gas
    const lockHash = await wallets[0].writeContract({
      address: envelopeAddress,
      abi: envelopeAbi,
      functionName: "lock",
      args: [hash, duration, "Gas measurement"],
      value: amount,
      chain: local,
      account: accounts[0],
    });
    const lockReceipt = await publicClient.waitForTransactionReceipt({ hash: lockHash });
    expect(lockReceipt.gasUsed).toBeLessThan(175_000n);

    const logs = await publicClient.getContractEvents({
      address: envelopeAddress,
      abi: envelopeAbi,
      eventName: "Locked",
      fromBlock: lockReceipt.blockNumber,
      toBlock: lockReceipt.blockNumber,
    });
    const id = logs[0].args.id!;

    // Commit gas
    const commitHash = await wallets[4].writeContract({
      address: envelopeAddress,
      abi: envelopeAbi,
      functionName: "commit",
      args: [id, commitmentFor(id, code, accounts[4].address)],
      chain: local,
      account: accounts[4],
    });
    const commitReceipt = await publicClient.waitForTransactionReceipt({ hash: commitHash });
    expect(commitReceipt.gasUsed).toBeLessThan(80_000n);

    // Mine 1 block
    await mineBlock();

    // Redeem gas
    const redeemHash = await wallets[4].writeContract({
      address: envelopeAddress,
      abi: envelopeAbi,
      functionName: "redeem",
      args: [id, secretBytes(code)],
      chain: local,
      account: accounts[4],
    });
    const redeemReceipt = await publicClient.waitForTransactionReceipt({ hash: redeemHash });
    expect(redeemReceipt.gasUsed).toBeLessThan(70_000n);
  });

  it("seals twice, decodes sequential IDs via parseEventLogs matching envelopeCount and hashOf", async () => {
    const codeA = generateSecretCode();
    const codeB = generateSecretCode();
    const duration = 7200n;
    const amountA = parseEther("0.25");
    const amountB = parseEther("0.75");

    // First seal
    const txA = await wallets[0].writeContract({
      address: envelopeAddress,
      abi: envelopeAbi,
      functionName: "lock",
      args: [hashOf(codeA), duration, "Envelope A"],
      value: amountA,
      chain: local,
      account: accounts[0],
    });
    const receiptA = await publicClient.waitForTransactionReceipt({ hash: txA });
    const parsedA = parseEventLogs({
      abi: envelopeAbi,
      logs: receiptA.logs,
      eventName: "Locked",
    });
    expect(parsedA.length).toBeGreaterThan(0);
    const idA = parsedA[0].args.id;

    // Second seal
    const txB = await wallets[0].writeContract({
      address: envelopeAddress,
      abi: envelopeAbi,
      functionName: "lock",
      args: [hashOf(codeB), duration, "Envelope B"],
      value: amountB,
      chain: local,
      account: accounts[0],
    });
    const receiptB = await publicClient.waitForTransactionReceipt({ hash: txB });
    const parsedB = parseEventLogs({
      abi: envelopeAbi,
      logs: receiptB.logs,
      eventName: "Locked",
    });
    expect(parsedB.length).toBeGreaterThan(0);
    const idB = parsedB[0].args.id;

    // Assert sequential IDs
    expect(idB).toBe(idA + 1n);

    // Assert idB equals current envelopeCount
    const count = await publicClient.readContract({
      address: envelopeAddress,
      abi: envelopeAbi,
      functionName: "envelopeCount",
    });
    expect(idB).toBe(count);

    // Assert envelopeOf(idB).hash equals hashOf(codeB)
    const envB = await publicClient.readContract({
      address: envelopeAddress,
      abi: envelopeAbi,
      functionName: "envelopeOf",
      args: [idB],
    });
    expect(envB.hash).toBe(hashOf(codeB));
    expect(envB.amount).toBe(amountB);
  });
});
