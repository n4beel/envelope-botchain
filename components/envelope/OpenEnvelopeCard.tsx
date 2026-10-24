"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { formatEther, type Address, type Hex } from "viem";
import {
  useAccount,
  useChainId,
  usePublicClient,
  useReadContract,
  useWaitForTransactionReceipt,
  useWriteContract,
} from "wagmi";
import { envelopeAbi } from "@/lib/botchain/abi";
import { isBotChainId } from "@/lib/botchain/chain";
import { getDeployment, isDeployed } from "@/lib/botchain/deployment";
import {
  commitmentFor,
  hashOf,
  loadEnvelopeNote,
  normalizeCode,
  parseFragmentCode,
  secretBytes,
  stateLabel,
} from "@/lib/envelope";
import { describeError, shortAddress } from "@/lib/errors";
import Button from "@/components/ui/Button";
import { useToast } from "@/components/ui/Toast";
import EnvelopeIllustration from "./EnvelopeIllustration";

interface OpenEnvelopeCardProps {
  id: bigint;
}

type OpenStage =
  | "idle"
  | "committing"
  | "waiting_block"
  | "redeeming"
  | "confirmed"
  | "refunding"
  | "refunded"
  | "error";

export default function OpenEnvelopeCard({ id }: OpenEnvelopeCardProps) {
  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const publicClient = usePublicClient();
  const publicClientRef = useRef(publicClient);
  publicClientRef.current = publicClient;

  const { toast } = useToast();
  const showToast = useCallback(
    (msg: string, type: "success" | "error" = "info" as any) => {
      toast(type, msg);
    },
    [toast]
  );

  const [code, setCode] = useState("");
  const [stage, setStage] = useState<OpenStage>("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [note, setNote] = useState<string>("");
  const [activeTxHash, setActiveTxHash] = useState<Hex | null>(null);
  const [commitBlock, setCommitBlock] = useState<bigint | null>(null);

  const settledRef = useRef<Set<string>>(new Set());

  // 1. Read hash fragment from URL on mount
  useEffect(() => {
    if (typeof window !== "undefined" && window.location.hash) {
      const parsed = parseFragmentCode(window.location.hash);
      if (parsed) {
        setCode(parsed);
      }
    }
  }, []);

  const deployment = useMemo(() => {
    return isBotChainId(chainId) ? getDeployment(chainId) : null;
  }, [chainId]);

  // 2. Read on-chain envelope state
  const {
    data: envData,
    isLoading: isEnvLoading,
    isError: isEnvError,
    refetch: refetchEnvelope,
  } = useReadContract({
    address: deployment?.address,
    abi: envelopeAbi,
    functionName: "envelopeOf",
    args: [id],
    query: {
      enabled: Boolean(deployment?.address && id > 0n),
    },
  });

  // 3. Read prior commitment (interrupted state check)
  const { data: commitData, refetch: refetchCommit } = useReadContract({
    address: deployment?.address,
    abi: envelopeAbi,
    functionName: "commitOf",
    args: [id, address ?? "0x0000000000000000000000000000000000000000"],
    query: {
      enabled: Boolean(deployment?.address && address && id > 0n),
    },
  });

  // Load note if opened
  useEffect(() => {
    if (!envData || !deployment || !publicClientRef.current) return;
    if (envData.state === 1 && envData.createdBlock) {
      loadEnvelopeNote(
        publicClientRef.current,
        deployment.address,
        id,
        BigInt(envData.createdBlock)
      ).then((n) => {
        if (n) setNote(n);
      });
    }
  }, [envData, deployment, id]);

  // Wagmi contract write
  const { writeContractAsync } = useWriteContract();

  const receipt = useWaitForTransactionReceipt({
    hash: activeTxHash ?? undefined,
  });

  const receiptIsSuccess = receipt.isSuccess;
  const receiptIsError = receipt.isError;
  const receiptBlock = receipt.data?.blockNumber;

  // Track transaction confirmations
  useEffect(() => {
    if (!activeTxHash) return;
    if (settledRef.current.has(activeTxHash)) return;

    if (receiptIsSuccess) {
      settledRef.current.add(activeTxHash);

      if (stage === "committing") {
        const blk = receiptBlock ?? 0n;
        setCommitBlock(blk);
        setStage("waiting_block");
        showToast("Commit confirmed on-chain! Waiting 1 block…", "success");
      } else if (stage === "redeeming") {
        setStage("confirmed");
        refetchEnvelope();
        showToast("Envelope opened successfully! BOT received.", "success");
      } else if (stage === "refunding") {
        setStage("refunded");
        refetchEnvelope();
        showToast("Funds returned to your wallet.", "success");
      }
    } else if (receiptIsError) {
      settledRef.current.add(activeTxHash);
      setStage("error");
      setErrorMsg("Transaction failed on-chain.");
      showToast("Transaction failed.", "error");
    }
  }, [
    activeTxHash,
    receiptIsSuccess,
    receiptIsError,
    receiptBlock,
    stage,
    refetchEnvelope,
    showToast,
  ]);

  // Wait 1 block effect after commit
  useEffect(() => {
    if (stage !== "waiting_block" || !commitBlock || !publicClientRef.current) return;

    let cancelled = false;
    const checkBlock = async () => {
      try {
        const current = await publicClientRef.current!.getBlockNumber();
        if (current > commitBlock && !cancelled) {
          // Block advanced! Proceed to redeem
          triggerRedeem();
        } else if (!cancelled) {
          setTimeout(checkBlock, 1000);
        }
      } catch {
        if (!cancelled) setTimeout(checkBlock, 1500);
      }
    };

    const timer = setTimeout(checkBlock, 1000);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [stage, commitBlock]);

  // Local hash check: verify keccak256(secret) == env.hash
  const normalizedCode = useMemo(() => normalizeCode(code), [code]);
  const isHashMatching = useMemo(() => {
    if (!envData || !normalizedCode) return null;
    try {
      const computed = hashOf(normalizedCode);
      return computed.toLowerCase() === envData.hash.toLowerCase();
    } catch {
      return false;
    }
  }, [envData, normalizedCode]);

  // Check if prior commitment exists on reload
  const hasValidPriorCommit = useMemo(() => {
    if (!commitData || !address || !normalizedCode || !envData) return false;
    const [cHash, cBlock] = commitData;
    if (cBlock === 0n || cHash === "0x0000000000000000000000000000000000000000000000000000000000000000") {
      return false;
    }
    const expected = commitmentFor(id, normalizedCode, address);
    return cHash.toLowerCase() === expected.toLowerCase();
  }, [commitData, address, normalizedCode, envData, id]);

  // Trigger Redeem transaction (Step 3)
  const triggerRedeem = useCallback(async () => {
    if (!deployment || !normalizedCode) return;
    try {
      setStage("redeeming");
      setErrorMsg(null);

      const hash = await writeContractAsync({
        address: deployment.address,
        abi: envelopeAbi,
        functionName: "redeem",
        args: [id, secretBytes(normalizedCode)],
      });
      setActiveTxHash(hash);
    } catch (err) {
      setStage("error");
      const msg = describeError(err);
      setErrorMsg(msg);
      showToast(msg, "error");
    }
  }, [deployment, normalizedCode, id, writeContractAsync, showToast]);

  // Trigger Opening Flow (Step 1: Commit)
  const handleOpen = useCallback(async () => {
    if (!deployment || !address || !normalizedCode) return;
    if (isHashMatching === false) {
      setErrorMsg("That code doesn't open this envelope.");
      return;
    }

    // If already committed in earlier block, skip to redeem
    if (hasValidPriorCommit) {
      triggerRedeem();
      return;
    }

    try {
      setStage("committing");
      setErrorMsg(null);

      const commitment = commitmentFor(id, normalizedCode, address);
      const hash = await writeContractAsync({
        address: deployment.address,
        abi: envelopeAbi,
        functionName: "commit",
        args: [id, commitment],
      });
      setActiveTxHash(hash);
    } catch (err) {
      setStage("error");
      const msg = describeError(err);
      setErrorMsg(msg);
      showToast(msg, "error");
    }
  }, [
    deployment,
    address,
    normalizedCode,
    isHashMatching,
    hasValidPriorCommit,
    id,
    triggerRedeem,
    writeContractAsync,
    showToast,
  ]);

  // Trigger Refund (Sender only, after expiry)
  const handleRefund = useCallback(async () => {
    if (!deployment) return;
    try {
      setStage("refunding");
      setErrorMsg(null);

      const hash = await writeContractAsync({
        address: deployment.address,
        abi: envelopeAbi,
        functionName: "refund",
        args: [id],
      });
      setActiveTxHash(hash);
    } catch (err) {
      setStage("error");
      const msg = describeError(err);
      setErrorMsg(msg);
      showToast(msg, "error");
    }
  }, [deployment, id, writeContractAsync, showToast]);

  // Loading state
  if (isEnvLoading) {
    return (
      <div className="w-full max-w-[500px] text-center p-12 text-[#4A3A1F] font-serif">
        <div className="w-6 h-6 border-2 border-[#7A1523] border-t-transparent rounded-full animate-spin mx-auto mb-3" />
        Inspecting envelope #{id.toString()}…
      </div>
    );
  }

  // Error / Not found state
  if (isEnvError || !envData || envData.sender === "0x0000000000000000000000000000000000000000") {
    return (
      <div className="w-full max-w-[500px] bg-[#FAF5EB] border-2 border-[#A88B55] rounded p-8 text-center text-[#2A1D0E]">
        <h2 className="text-[20px] font-serif font-black text-[#7A1523]">
          Envelope Not Found
        </h2>
        <p className="mt-2 text-[13px] text-[#4A3A1F]">
          Envelope #{id.toString()} has not been recorded on BOT Chain.
        </p>
        <Link
          href="/"
          className="inline-block mt-4 text-[13px] font-serif font-bold text-[#7A1523] hover:underline"
        >
          ← Seal a new envelope
        </Link>
      </div>
    );
  }

  const amountDisplay = formatEther(envData.amount);
  const isSender = address && address.toLowerCase() === envData.sender.toLowerCase();
  const currentTimestamp = Math.floor(Date.now() / 1000);
  const isExpired = envData.state === 3 || currentTimestamp >= Number(envData.expiresAt);
  const isOpened = envData.state === 1 || stage === "confirmed";
  const isRefunded = envData.state === 2 || stage === "refunded";

  const expiresDateStr = new Date(Number(envData.expiresAt) * 1000).toLocaleString();

  // =========================================================================
  // RULE: stage === 'confirmed' FIRST
  // =========================================================================
  if (stage === "confirmed" || envData.state === 1) {
    return (
      <div className="w-full flex flex-col items-center gap-6">
        <EnvelopeIllustration
          state="opened"
          amountDisplay={amountDisplay}
          note={note}
        >
          <div className="flex flex-col items-center text-center py-2">
            <span className="text-[11px] font-mono uppercase tracking-widest text-emerald-800 font-bold bg-emerald-100 px-2.5 py-0.5 rounded">
              ✓ It's yours. {amountDisplay} BOT.
            </span>
            <h2 className="text-[22px] sm:text-[26px] font-serif font-black text-[#7A1523] mt-2">
              Envelope Opened
            </h2>
            <p className="text-[13px] text-[#4A3A1F] mt-1 max-w-[340px]">
              {envData.taker && envData.taker !== "0x0000000000000000000000000000000000000000"
                ? `Claimed by ${shortAddress(envData.taker)}.`
                : "Funds transferred to your wallet."}
            </p>
          </div>
        </EnvelopeIllustration>

        <div className="w-full max-w-[500px] bg-[#FAF5EB] border border-[#A88B55] rounded p-5 flex flex-col gap-3 text-[12px] text-[#4A3A1F]">
          <div className="flex justify-between">
            <span className="font-mono">Sender</span>
            <span className="font-mono font-bold text-[#2A1D0E]">{shortAddress(envData.sender)}</span>
          </div>
          <div className="flex justify-between">
            <span className="font-mono">Carrying Value</span>
            <span className="font-serif font-bold text-[#7A1523] text-[14px]">{amountDisplay} BOT</span>
          </div>
          <div className="pt-2 border-t border-[#A88B55]/30 text-center">
            <Link href="/" className="text-[#7A1523] font-serif font-bold hover:underline">
              ← Seal another envelope
            </Link>
          </div>
        </div>
      </div>
    );
  }

  // If Refunded
  if (isRefunded) {
    return (
      <div className="w-full flex flex-col items-center gap-6">
        <EnvelopeIllustration state="refunded" amountDisplay={amountDisplay}>
          <div className="text-center py-2">
            <span className="text-[11px] font-mono uppercase tracking-widest text-amber-800 font-bold bg-amber-100 px-2.5 py-0.5 rounded">
              Returned to Sender
            </span>
            <h2 className="text-[22px] font-serif font-black text-[#7A1523] mt-2">
              Envelope Reclaimed
            </h2>
            <p className="text-[13px] text-[#4A3A1F] mt-1">
              Expired without being claimed. The {amountDisplay} BOT was returned to {shortAddress(envData.sender)}.
            </p>
          </div>
        </EnvelopeIllustration>
      </div>
    );
  }

  // If Expired
  if (isExpired) {
    return (
      <div className="w-full flex flex-col items-center gap-6">
        <EnvelopeIllustration state="expired" amountDisplay={amountDisplay}>
          <div className="text-center py-2 flex flex-col items-center gap-2">
            <span className="text-[11px] font-mono uppercase tracking-widest text-red-800 font-bold bg-red-100 px-2.5 py-0.5 rounded">
              Past Its Date
            </span>
            <h2 className="text-[22px] font-serif font-black text-[#7A1523]">
              Envelope Expired
            </h2>
            <p className="text-[13px] text-[#4A3A1F] max-w-[340px]">
              This envelope expired on {expiresDateStr} and can no longer be opened with a code.
            </p>

            {/* Sender Refund Action */}
            {isSender ? (
              <div className="mt-3 w-full max-w-[300px]">
                <Button
                  variant="wax"
                  size="md"
                  onClick={handleRefund}
                  loading={stage === "refunding"}
                  className="w-full"
                >
                  {stage === "refunding" ? "Taking it back…" : `Take back ${amountDisplay} BOT`}
                </Button>
                <span className="text-[11px] text-[#5C4521] mt-1 block">
                  You are the sender. You can reclaim your funds.
                </span>
              </div>
            ) : (
              <p className="text-[11px] text-[#5C4521] italic mt-2">
                Only the sender ({shortAddress(envData.sender)}) can reclaim these funds.
              </p>
            )}
          </div>
        </EnvelopeIllustration>
      </div>
    );
  }

  // Active Sealed Envelope (Can be claimed)
  return (
    <div className="w-full flex flex-col items-center gap-6">
      <EnvelopeIllustration state={stage === "redeeming" ? "opening" : "sealed"} amountDisplay={amountDisplay}>
        <div className="flex flex-col gap-4">
          <div className="text-center">
            <span className="text-[11px] font-mono text-[#5C4521] uppercase tracking-wider">
              ENVELOPE NO. {id.toString()}
            </span>
            <h2 className="text-[20px] sm:text-[24px] font-serif font-black text-[#7A1523]">
              Claim {amountDisplay} BOT
            </h2>
            <p className="text-[12px] text-[#4A3A1F]">
              From {shortAddress(envData.sender)} • Expires {expiresDateStr}
            </p>
          </div>

          {/* Secret Code Input */}
          <div className="flex flex-col gap-1.5">
            <label htmlFor="code-input" className="text-[11px] font-mono uppercase tracking-wider text-[#4A3A1F]">
              Secret Code
            </label>
            <input
              id="code-input"
              type="text"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="ABCD-EFGH-JKMN-PQRS-TVWX-YZ"
              className="w-full bg-[#FFFDF9] border border-[#A88B55] rounded px-3 py-2 text-[15px] sm:text-[17px] font-mono font-bold text-[#7A1523] placeholder:text-[#A88B55]/50 outline-none focus:border-[#7A1523]"
            />

            {/* Live Local Validation Feedback */}
            {normalizedCode && isHashMatching === false && (
              <span className="text-[11px] font-mono text-red-700 font-semibold">
                ⚠ That code doesn't open this envelope.
              </span>
            )}
            {normalizedCode && isHashMatching === true && (
              <span className="text-[11px] font-mono text-emerald-800 font-semibold">
                ✓ Valid code verified locally. Ready to claim.
              </span>
            )}
          </div>

          {/* Opening Progress Sub-states */}
          {(stage === "committing" || stage === "waiting_block" || stage === "redeeming") && (
            <div
              aria-live="polite"
              className="p-3 bg-[#FAF5EB] border border-[#A88B55] rounded flex items-center gap-3 text-[13px] text-[#2A1D0E]"
            >
              <span className="w-4 h-4 border-2 border-[#7A1523] border-t-transparent rounded-full animate-spin shrink-0" />
              <div>
                <p className="font-serif font-bold text-[#7A1523]">
                  {stage === "committing"
                    ? "Step 1/3: Preparing your claim (commit tx)…"
                    : stage === "waiting_block"
                    ? "Step 2/3: Waiting one block on BOT Chain…"
                    : "Step 3/3: Opening envelope (redeem tx)…"}
                </p>
                <p className="text-[11px] text-[#4A3A1F]">
                  {stage === "waiting_block"
                    ? "Commitment confirmed. Waiting for block increment to ensure tamper protection."
                    : "Please confirm the transaction in your wallet."}
                </p>
              </div>
            </div>
          )}

          {/* Interrupted state detected */}
          {hasValidPriorCommit && stage === "idle" && (
            <div className="p-2.5 bg-amber-50 border border-amber-300 rounded text-[12px] text-amber-900 leading-snug">
              Prior commitment found! You can proceed directly to open.
            </div>
          )}

          {/* Error Message */}
          {errorMsg && (
            <div className="p-2.5 bg-red-50 border border-red-300 rounded text-[12px] text-red-900 leading-snug">
              {errorMsg}
            </div>
          )}

          {/* Primary Action Button */}
          {!isConnected ? (
            <p className="text-[12px] text-[#5C4521] text-center italic">
              Connect wallet to open this envelope.
            </p>
          ) : (
            <Button
              variant="wax"
              size="lg"
              disabled={
                !normalizedCode ||
                isHashMatching === false ||
                stage === "committing" ||
                stage === "waiting_block" ||
                stage === "redeeming"
              }
              loading={stage === "committing" || stage === "waiting_block" || stage === "redeeming"}
              onClick={handleOpen}
              className="w-full mt-1"
            >
              {stage === "committing"
                ? "Preparing Claim…"
                : stage === "waiting_block"
                ? "Waiting 1 Block…"
                : stage === "redeeming"
                ? "Opening Envelope…"
                : hasValidPriorCommit
                ? "Complete Opening"
                : "Open Envelope"}
            </Button>
          )}

          <p className="text-[10px] text-[#5C4521] text-center leading-tight">
            Code verified locally against on-chain hash before spending gas.
          </p>
        </div>
      </EnvelopeIllustration>
    </div>
  );
}
