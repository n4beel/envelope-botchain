"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { formatEther, type Hex } from "viem";
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
import { buildShareUrl, formatCode, normalizeCode, stateLabel } from "@/lib/envelope";
import { describeError } from "@/lib/errors";
import Button from "@/components/ui/Button";
import { useToast } from "@/components/ui/Toast";

interface StoredEnvelope {
  id: string;
  code: string;
  amount: string;
  note: string;
  createdAt: number;
}

interface EnvelopeRowProps {
  id: bigint;
  storedCode?: string;
  onRefundSuccess: () => void;
}

function EnvelopeRow({ id, storedCode, onRefundSuccess }: EnvelopeRowProps) {
  const chainId = useChainId();
  const deployment = useMemo(
    () => (isBotChainId(chainId) ? getDeployment(chainId) : null),
    [chainId]
  );
  const { toast } = useToast();
  const showToast = useCallback(
    (msg: string, type: "success" | "error" = "info" as any) => {
      toast(type, msg);
    },
    [toast]
  );

  const [refunding, setRefunding] = useState(false);
  const [refundTx, setRefundTx] = useState<Hex | null>(null);
  const [copiedLink, setCopiedLink] = useState(false);
  const [copiedCode, setCopiedCode] = useState(false);

  const settledRef = useRef<Set<string>>(new Set());

  const { data: envData, refetch } = useReadContract({
    address: deployment?.address,
    abi: envelopeAbi,
    functionName: "envelopeOf",
    args: [id],
    query: {
      enabled: Boolean(deployment?.address && id > 0n),
    },
  });

  const { writeContractAsync } = useWriteContract();

  const receipt = useWaitForTransactionReceipt({
    hash: refundTx ?? undefined,
  });

  const receiptIsSuccess = receipt.isSuccess;
  const receiptIsError = receipt.isError;

  useEffect(() => {
    if (!refundTx) return;
    if (settledRef.current.has(refundTx)) return;

    if (receiptIsSuccess) {
      settledRef.current.add(refundTx);
      setRefunding(false);
      refetch();
      onRefundSuccess();
      showToast(`Envelope #${id.toString()} refunded to your wallet!`, "success");
    } else if (receiptIsError) {
      settledRef.current.add(refundTx);
      setRefunding(false);
      showToast("Refund transaction failed.", "error");
    }
  }, [refundTx, receiptIsSuccess, receiptIsError, id, onRefundSuccess, refetch, showToast]);

  const handleRefund = useCallback(async () => {
    if (!deployment) return;
    try {
      setRefunding(true);
      const hash = await writeContractAsync({
        address: deployment.address,
        abi: envelopeAbi,
        functionName: "refund",
        args: [id],
      });
      setRefundTx(hash);
    } catch (err) {
      setRefunding(false);
      showToast(describeError(err), "error");
    }
  }, [deployment, id, writeContractAsync, showToast]);

  if (!envData) {
    return (
      <div className="p-4 bg-[#F6EFE0] border border-[#A88B55] rounded animate-pulse">
        <span className="text-[12px] font-mono text-[#5C4521]">Loading envelope #{id.toString()}…</span>
      </div>
    );
  }

  const amountDisplay = formatEther(envData.amount);
  const current = Math.floor(Date.now() / 1000);
  const isExpired = envData.state === 3 || current >= Number(envData.expiresAt);
  const isLocked = envData.state === 0 && !isExpired;
  const isRedeemed = envData.state === 1;
  const isRefunded = envData.state === 2;

  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const shareUrl = storedCode ? buildShareUrl(id, storedCode, origin) : "";

  const handleCopyLink = async () => {
    if (!shareUrl) return;
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopiedLink(true);
      showToast("Link copied!", "success");
      setTimeout(() => setCopiedLink(false), 2000);
    } catch {
      showToast("Failed to copy link", "error");
    }
  };

  const handleCopyCode = async () => {
    if (!storedCode) return;
    try {
      await navigator.clipboard.writeText(normalizeCode(storedCode));
      setCopiedCode(true);
      showToast("Code copied!", "success");
      setTimeout(() => setCopiedCode(false), 2000);
    } catch {
      showToast("Failed to copy code", "error");
    }
  };

  return (
    <div className="bg-[#FAF5EB] border border-[#A88B55] rounded-md p-4 sm:p-5 flex flex-col gap-3 shadow-sm text-[#2A1D0E]">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="font-serif font-black text-[16px] text-[#7A1523]">
            Envelope #{id.toString()}
          </span>
          <span
            className={[
              "text-[10px] font-mono uppercase px-2 py-0.5 rounded font-bold",
              isLocked
                ? "bg-amber-100 text-amber-900 border border-amber-300"
                : isRedeemed
                ? "bg-emerald-100 text-emerald-900 border border-emerald-300"
                : isRefunded
                ? "bg-stone-200 text-stone-800 border border-stone-400"
                : "bg-red-100 text-red-900 border border-red-300",
            ].join(" ")}
          >
            {stateLabel(envData.state, envData.expiresAt, current)}
          </span>
        </div>

        <span className="font-serif font-bold text-[16px] text-[#7A1523]">
          {amountDisplay} BOT
        </span>
      </div>

      <div className="text-[12px] text-[#4A3A1F] flex flex-col gap-1 border-t border-[#A88B55]/20 pt-2">
        <div className="flex justify-between">
          <span className="font-mono text-[11px]">Expires</span>
          <span>{new Date(Number(envData.expiresAt) * 1000).toLocaleString()}</span>
        </div>

        {storedCode ? (
          <div className="flex flex-col gap-1 mt-1">
            <div className="flex justify-between items-center">
              <span className="font-mono text-[11px]">Saved Code:</span>
              <span className="font-mono font-bold text-[#7A1523] text-[12px]">
                {formatCode(storedCode)}
              </span>
            </div>
            {isLocked && (
              <div className="flex gap-2 mt-1">
                <button
                  type="button"
                  onClick={handleCopyLink}
                  className="px-2 py-1 bg-[#F6EFE0] border border-[#A88B55] rounded text-[11px] font-serif font-bold hover:bg-[#FFFDF9] cursor-pointer"
                >
                  {copiedLink ? "✓ Copied" : "Copy Link"}
                </button>
                <button
                  type="button"
                  onClick={handleCopyCode}
                  className="px-2 py-1 bg-[#F6EFE0] border border-[#A88B55] rounded text-[11px] font-serif font-bold hover:bg-[#FFFDF9] cursor-pointer"
                >
                  {copiedCode ? "✓ Copied" : "Copy Code"}
                </button>
              </div>
            )}
          </div>
        ) : (
          <span className="text-[10px] text-[#5C4521] italic mt-1">
            Secret code not stored in this browser (only hashes exist on-chain).
          </span>
        )}
      </div>

      {/* Expiry / Refund Action */}
      <div className="flex items-center justify-between pt-2 border-t border-[#A88B55]/30">
        <Link
          href={`/e/${id.toString()}${storedCode ? `#${normalizeCode(storedCode)}` : ""}`}
          className="text-[12px] font-serif font-bold text-[#7A1523] hover:underline"
        >
          View Envelope →
        </Link>

        {isExpired && !isRedeemed && !isRefunded && (
          <Button
            variant="wax"
            size="sm"
            onClick={handleRefund}
            loading={refunding}
          >
            {refunding ? "Refunding…" : "Take it back"}
          </Button>
        )}
      </div>
    </div>
  );
}

export default function MyEnvelopesList() {
  const { address } = useAccount();
  const chainId = useChainId();
  const deployment = useMemo(
    () => (isBotChainId(chainId) ? getDeployment(chainId) : null),
    [chainId]
  );

  const [storedEnvelopes, setStoredEnvelopes] = useState<Record<string, string>>({});

  // Load stored codes from localStorage
  useEffect(() => {
    try {
      const raw = localStorage.getItem("envelope_sealed_items");
      if (raw) {
        const parsed: StoredEnvelope[] = JSON.parse(raw);
        const map: Record<string, string> = {};
        for (const item of parsed) {
          map[item.id] = item.code;
        }
        setStoredEnvelopes(map);
      }
    } catch {
      // LocalStorage access denied or quota
    }
  }, []);

  const {
    data: idList,
    isLoading,
    refetch,
  } = useReadContract({
    address: deployment?.address,
    abi: envelopeAbi,
    functionName: "envelopesBy",
    args: [address ?? "0x0000000000000000000000000000000000000000"],
    query: {
      enabled: Boolean(deployment?.address && address),
    },
  });

  const ids = useMemo(() => {
    if (!idList) return [];
    return [...idList].reverse(); // Most recent first
  }, [idList]);

  if (isLoading) {
    return (
      <div className="w-full text-center py-12 text-[#4A3A1F] font-serif">
        <div className="w-6 h-6 border-2 border-[#7A1523] border-t-transparent rounded-full animate-spin mx-auto mb-3" />
        Reading postal registry…
      </div>
    );
  }

  if (ids.length === 0) {
    return (
      <div className="w-full bg-[#FAF5EB] border-2 border-[#A88B55] rounded p-8 text-center text-[#2A1D0E] flex flex-col items-center gap-3">
        <span className="text-[28px]" aria-hidden="true">✉️</span>
        <h2 className="text-[20px] font-serif font-black text-[#7A1523]">
          No Envelopes Sealed Yet
        </h2>
        <p className="text-[13px] text-[#4A3A1F] max-w-[340px]">
          Envelopes sealed from this wallet will appear here with live state tracking and refund options.
        </p>
        <Link
          href="/"
          className="mt-2 px-4 py-2 bg-[#7A1523] text-[#FBF3E4] font-serif font-bold rounded shadow hover:brightness-110"
        >
          Seal your first envelope
        </Link>
      </div>
    );
  }

  return (
    <div className="w-full flex flex-col gap-4">
      <div className="flex items-center justify-between text-[#4A3A1F] text-[12px] font-mono px-1">
        <span>{ids.length} Envelope{ids.length === 1 ? "" : "s"} Sealed</span>
        <button
          type="button"
          onClick={() => refetch()}
          className="text-[#7A1523] hover:underline cursor-pointer"
        >
          Refresh list ↺
        </button>
      </div>

      <div className="flex flex-col gap-3">
        {ids.map((id) => (
          <EnvelopeRow
            key={id.toString()}
            id={id}
            storedCode={storedEnvelopes[id.toString()]}
            onRefundSuccess={() => refetch()}
          />
        ))}
      </div>
    </div>
  );
}
