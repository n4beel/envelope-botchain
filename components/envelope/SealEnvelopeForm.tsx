"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  parseEther,
  parseEventLogs,
  type Address,
  type Hex,
} from "viem";
import {
  useAccount,
  useChainId,
  usePublicClient,
  useWaitForTransactionReceipt,
  useWriteContract,
} from "wagmi";
import { envelopeAbi } from "@/lib/botchain/abi";
import { isBotChainId } from "@/lib/botchain/chain";
import { getDeployment, isDeployed } from "@/lib/botchain/deployment";
import {
  byteLength,
  commitmentFor,
  entropyBits,
  formatCode,
  generateSecretCode,
  hashOf,
  normalizeCode,
} from "@/lib/envelope";
import { describeError } from "@/lib/errors";
import {
  DURATION_PRESETS,
  MAX_NOTE_BYTES,
  MIN_DURATION,
} from "@/lib/limits";
import Button from "@/components/ui/Button";
import BotChainGate from "@/components/botchain/BotChainGate";
import { useToast } from "@/components/ui/Toast";
import EnvelopeIllustration from "./EnvelopeIllustration";
import QRCode from "./QRCode";

type TxStage = "idle" | "awaiting_wallet" | "awaiting_receipt" | "confirmed" | "error";

interface StoredEnvelope {
  id: string;
  code: string;
  amount: string;
  note: string;
  createdAt: number;
}

export default function SealEnvelopeForm() {
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

  // Form State
  const [amount, setAmount] = useState("1");
  const [duration, setDuration] = useState<bigint>(86400n); // 1 day default
  const [note, setNote] = useState("");
  const [secretCode, setSecretCode] = useState("");
  useEffect(() => {
    setSecretCode(generateSecretCode());
  }, []);
  const [useCustomCode, setUseCustomCode] = useState(false);
  const [customPassphrase, setCustomPassphrase] = useState("");

  // Transaction State
  const [stage, setStage] = useState<TxStage>("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<Hex | null>(null);
  const [createdId, setCreatedId] = useState<bigint | null>(null);
  const [confirmedCode, setConfirmedCode] = useState<string>("");
  const [confirmedAmount, setConfirmedAmount] = useState<string>("");
  const [copiedLink, setCopiedLink] = useState(false);
  const [copiedCode, setCopiedCode] = useState(false);

  const settledRef = useRef<Set<string>>(new Set());

  // Active code determination
  const activeCode = useMemo(() => {
    return useCustomCode ? customPassphrase.trim() : secretCode;
  }, [useCustomCode, customPassphrase, secretCode]);

  // Entropy calculation
  const entropy = useMemo(() => {
    return useCustomCode ? entropyBits(customPassphrase.trim()) : 130;
  }, [useCustomCode, customPassphrase]);

  // Validation
  const noteBytes = useMemo(() => byteLength(note), [note]);
  const isNoteValid = noteBytes <= MAX_NOTE_BYTES;

  const parsedAmount = useMemo(() => {
    try {
      const v = parseEther(amount);
      return v > 0n ? v : null;
    } catch {
      return null;
    }
  }, [amount]);

  const isCodeValid = useMemo(() => {
    if (!useCustomCode) return secretCode.length > 0;
    return entropy >= 40 && customPassphrase.trim().length > 0;
  }, [useCustomCode, secretCode, entropy, customPassphrase]);

  const isValid = Boolean(parsedAmount && isNoteValid && isCodeValid);

  // Wagmi write contract
  const { writeContractAsync } = useWriteContract();

  const receipt = useWaitForTransactionReceipt({
    hash: txHash ?? undefined,
  });

  const receiptIsSuccess = receipt.isSuccess;
  const receiptIsError = receipt.isError;
  const receiptLogs = receipt.data?.logs;

  // Transaction settlement effect
  useEffect(() => {
    if (!txHash) return;
    if (settledRef.current.has(txHash)) return;

    if (receiptIsSuccess) {
      settledRef.current.add(txHash);

      // Extract created envelope ID from Locked event using parseEventLogs
      let newId: bigint | null = null;
      if (receiptLogs && receiptLogs.length > 0) {
        try {
          const parsed = parseEventLogs({
            abi: envelopeAbi,
            logs: receiptLogs,
            eventName: "Locked",
          });
          if (parsed.length > 0 && parsed[0]?.args?.id !== undefined) {
            newId = parsed[0].args.id;
          }
        } catch (e) {
          console.error("Failed to parse Locked event log:", e);
        }
      }

      if (newId === null) {
        setStage("error");
        setErrorMsg(
          `Transaction confirmed (${txHash}), but could not determine envelope ID from logs. Check your transaction on the explorer.`
        );
        return;
      }

      setCreatedId(newId);
      setConfirmedCode(activeCode);
      setConfirmedAmount(amount);
      setStage("confirmed");

      // Save to localStorage for recovery on /mine
      try {
        const key = "envelope_sealed_items";
        const raw = localStorage.getItem(key);
        const existing: StoredEnvelope[] = raw ? JSON.parse(raw) : [];
        existing.unshift({
          id: newId.toString(),
          code: activeCode,
          amount,
          note: note.trim(),
          createdAt: Date.now(),
        });
        localStorage.setItem(key, JSON.stringify(existing.slice(0, 50)));
      } catch {
        // LocalStorage quota or access denied
      }

      showToast("Envelope sealed on BOT Chain!", "success");
    } else if (receiptIsError) {
      settledRef.current.add(txHash);
      setStage("error");
      setErrorMsg("Transaction failed on-chain.");
      showToast("Transaction failed.", "error");
    }
  }, [
    txHash,
    receiptIsSuccess,
    receiptIsError,
    receiptLogs,
    activeCode,
    amount,
    note,
    showToast,
  ]);

  // Handle Sealing Submission
  const handleSeal = useCallback(async () => {
    if (!isValid || !parsedAmount || !isBotChainId(chainId)) return;

    const deployment = getDeployment(chainId);
    if (!isDeployed(chainId)) {
      showToast("Contract not deployed on this network.", "error");
      return;
    }

    try {
      setStage("awaiting_wallet");
      setErrorMsg(null);

      const secretHash = hashOf(activeCode);

      const hash = await writeContractAsync({
        address: deployment.address,
        abi: envelopeAbi,
        functionName: "lock",
        args: [secretHash, duration, note.trim()],
        value: parsedAmount,
      });

      setTxHash(hash);
      setStage("awaiting_receipt");
    } catch (err) {
      setStage("error");
      const msg = describeError(err);
      setErrorMsg(msg);
      showToast(msg, "error");
    }
  }, [
    isValid,
    parsedAmount,
    chainId,
    activeCode,
    duration,
    note,
    writeContractAsync,
    showToast,
  ]);

  // Regenerate secret code
  const handleRegenerateCode = () => {
    setSecretCode(generateSecretCode());
  };

  // Reset form
  const handleReset = () => {
    setAmount("1");
    setNote("");
    setSecretCode(generateSecretCode());
    setUseCustomCode(false);
    setCustomPassphrase("");
    setStage("idle");
    setErrorMsg(null);
    setTxHash(null);
    setCreatedId(null);
  };

  // Share link
  const shareUrl = useMemo(() => {
    if (!createdId) return "";
    const origin = typeof window !== "undefined" ? window.location.origin : "";
    return `${origin}/e/${createdId.toString()}#${normalizeCode(confirmedCode)}`;
  }, [createdId, confirmedCode]);

  const handleCopyLink = async () => {
    if (!shareUrl) return;
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopiedLink(true);
      showToast("Share link copied to clipboard!", "success");
      setTimeout(() => setCopiedLink(false), 2000);
    } catch {
      showToast("Failed to copy link.", "error");
    }
  };

  const handleCopyCode = async () => {
    if (!confirmedCode) return;
    try {
      await navigator.clipboard.writeText(normalizeCode(confirmedCode));
      setCopiedCode(true);
      showToast("Secret code copied to clipboard!", "success");
      setTimeout(() => setCopiedCode(false), 2000);
    } catch {
      showToast("Failed to copy code.", "error");
    }
  };

  // =========================================================================
  // RULE: stage === 'confirmed' FIRST before any other conditional branch
  // =========================================================================
  if (stage === "confirmed" && createdId) {
    return (
      <div className="w-full flex flex-col items-center gap-6">
        <EnvelopeIllustration state="sealed" amountDisplay={confirmedAmount}>
          <div className="flex flex-col items-center text-center py-2">
            <span className="text-[12px] font-mono text-[#5C4521] uppercase tracking-wider">
              ENVELOPE NO. {createdId.toString()}
            </span>
            <h2 className="text-[22px] sm:text-[26px] font-serif font-black text-[#7A1523] mt-1">
              Ready to hand over
            </h2>
            <p className="text-[13px] text-[#4A3A1F] mt-1 max-w-[360px]">
              Sealed with {confirmedAmount} BOT. Share the link or the code with your recipient.
            </p>
          </div>
        </EnvelopeIllustration>

        {/* Share Kit Card */}
        <div className="w-full max-w-[520px] bg-[#FAF5EB] border-2 border-[#A88B55] rounded-md p-6 sm:p-7 shadow-lg flex flex-col gap-5 text-[#2A1D0E]">
          {/* Large Monospace Secret Code Display */}
          <div className="flex flex-col gap-1.5 text-center">
            <span className="text-[11px] font-mono uppercase tracking-widest text-[#5C4521]">
              Secret Claim Code
            </span>
            <div className="p-3 bg-[#F6EFE0] border border-[#A88B55] rounded font-mono text-[17px] sm:text-[19px] font-bold tracking-wider text-[#7A1523] select-all break-all">
              {formatCode(confirmedCode)}
            </div>
          </div>

          {/* Action Buttons: Copy Link & Copy Code */}
          <div className="grid grid-cols-2 gap-3">
            <Button
              variant="wax"
              size="md"
              onClick={handleCopyLink}
              className="w-full"
            >
              {copiedLink ? "✓ Link Copied" : "Copy Link"}
            </Button>
            <Button
              variant="secondary"
              size="md"
              onClick={handleCopyCode}
              className="w-full"
            >
              {copiedCode ? "✓ Code Copied" : "Copy Code"}
            </Button>
          </div>

          {/* Offline SVG QR Code */}
          <div className="flex flex-col items-center gap-2 pt-2 border-t border-[#A88B55]/30">
            <span className="text-[11px] font-mono uppercase tracking-widest text-[#5C4521]">
              Scan to Open
            </span>
            <QRCode value={shareUrl} size={200} />
          </div>

          {/* Safety Disclaimer */}
          <div className="bg-[#F6EFE0] border-l-3 border-[#7A1523] p-3 text-[12px] leading-relaxed text-[#4A3A1F]">
            <p className="font-semibold text-[#2A1D0E]">Important</p>
            Anyone with this link or secret code can take the {confirmedAmount} BOT. Keep it as private as the money.
          </div>

          {/* Navigation Links */}
          <div className="flex items-center justify-between pt-2 border-t border-[#A88B55]/30 text-[13px]">
            <Link
              href={`/e/${createdId.toString()}#${normalizeCode(confirmedCode)}`}
              className="text-[#7A1523] font-serif font-bold hover:underline"
            >
              View Envelope Page →
            </Link>
            <button
              type="button"
              onClick={handleReset}
              className="text-[#4A3A1F] hover:text-[#2A1D0E] underline text-[12px] cursor-pointer"
            >
              Seal another envelope
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full flex flex-col items-center gap-6">
      <EnvelopeIllustration state="sealed" amountDisplay={amount}>
        <div className="flex flex-col gap-4">
          {/* Carrying Amount Input */}
          <div className="flex flex-col gap-1">
            <label
              htmlFor="amount-input"
              className="text-[11px] font-mono uppercase tracking-wider text-[#4A3A1F] flex justify-between"
            >
              <span>Amount to Enclose</span>
              <span className="text-[10px] text-[#5C4521]">BOT Native</span>
            </label>
            <div className="relative flex items-center">
              <input
                id="amount-input"
                type="text"
                inputMode="decimal"
                disabled={!isConnected}
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="1.0"
                className="w-full bg-[#FFFDF9] border border-[#A88B55] rounded px-3 py-2 text-[18px] font-serif font-bold text-[#2A1D0E] placeholder:text-[#A88B55]/50 outline-none focus:border-[#7A1523] disabled:opacity-75 disabled:cursor-not-allowed"
              />
              <span className="absolute right-3 font-serif font-bold text-[14px] text-[#7A1523]">
                BOT
              </span>
            </div>
          </div>

          {/* Duration Presets */}
          <div className="flex flex-col gap-1.5">
            <label className="text-[11px] font-mono uppercase tracking-wider text-[#4A3A1F]">
              Keep Open For
            </label>
            <div className="grid grid-cols-5 gap-1.5">
              {DURATION_PRESETS.map((preset) => {
                const isSelected = duration === preset.value;
                return (
                  <button
                    key={preset.label}
                    type="button"
                    disabled={!isConnected}
                    onClick={() => setDuration(preset.value)}
                    className={[
                      "py-1.5 px-1 rounded text-[11px] font-mono text-center transition-colors cursor-pointer disabled:opacity-75 disabled:cursor-not-allowed",
                      isSelected
                        ? "bg-[#7A1523] text-[#FBF3E4] font-bold shadow-sm"
                        : "bg-[#FFFDF9] text-[#4A3A1F] border border-[#A88B55]/60 hover:bg-[#FAF5EB]",
                    ].join(" ")}
                  >
                    {preset.label}
                  </button>
                );
              })}
            </div>
            <span className="text-[10px] text-[#5C4521] leading-tight">
              Cannot be refunded before expiration. If unclaimed, sender can retrieve funds after.
            </span>
          </div>

          {/* Note Field (Optional, max 140 bytes) */}
          <div className="flex flex-col gap-1">
            <div className="flex justify-between items-center text-[11px] font-mono text-[#4A3A1F]">
              <label htmlFor="note-input" className="uppercase tracking-wider">
                Enclosed Note (Optional)
              </label>
              <span className={noteBytes > MAX_NOTE_BYTES ? "text-red-700 font-bold" : ""}>
                {noteBytes}/{MAX_NOTE_BYTES} bytes
              </span>
            </div>
            <textarea
              id="note-input"
              rows={2}
              disabled={!isConnected}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="A secret message revealed only when opened..."
              className="w-full bg-[#FFFDF9] border border-[#A88B55] rounded px-3 py-1.5 text-[13px] font-serif text-[#2A1D0E] placeholder:text-[#A88B55]/50 outline-none focus:border-[#7A1523] resize-none disabled:opacity-75 disabled:cursor-not-allowed"
            />
          </div>

          {/* Secret Code Configuration */}
          <div className="bg-[#FAF5EB] border border-[#A88B55]/70 rounded p-3 flex flex-col gap-2.5">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-mono uppercase tracking-wider text-[#4A3A1F]">
                Secret Claim Code
              </span>
              <button
                type="button"
                disabled={!isConnected}
                onClick={() => setUseCustomCode(!useCustomCode)}
                className="text-[11px] text-[#7A1523] hover:underline font-mono cursor-pointer disabled:opacity-75 disabled:cursor-not-allowed"
              >
                {useCustomCode ? "Use Generated Code" : "Custom Passphrase"}
              </button>
            </div>

            {!useCustomCode ? (
              <div className="flex items-center justify-between gap-2">
                <span className="font-mono text-[13px] sm:text-[14px] font-bold text-[#7A1523] break-all select-all">
                  {secretCode ? formatCode(secretCode) : "••••-••••-••••-••••-••••-••"}
                </span>
                <button
                  type="button"
                  disabled={!isConnected}
                  onClick={handleRegenerateCode}
                  title="Generate new random code"
                  className="px-2 py-1 bg-[#FFFDF9] border border-[#A88B55] rounded text-[11px] font-mono text-[#4A3A1F] hover:bg-[#F6EFE0] shrink-0 cursor-pointer disabled:opacity-75 disabled:cursor-not-allowed"
                >
                  Regenerate
                </button>
              </div>
            ) : (
              <div className="flex flex-col gap-1">
                <input
                  type="text"
                  disabled={!isConnected}
                  value={customPassphrase}
                  onChange={(e) => setCustomPassphrase(e.target.value)}
                  placeholder="Enter custom secret passphrase"
                  className="w-full bg-[#FFFDF9] border border-[#A88B55] rounded px-2.5 py-1 text-[13px] font-mono text-[#2A1D0E] outline-none focus:border-[#7A1523] disabled:opacity-75 disabled:cursor-not-allowed"
                />
                <div className="flex items-center justify-between text-[10px] font-mono">
                  <span
                    className={
                      entropy < 40
                        ? "text-red-700 font-bold"
                        : entropy < 80
                        ? "text-amber-700"
                        : "text-emerald-800"
                    }
                  >
                    Entropy: ~{entropy} bits {entropy < 40 ? "(Min 40 required)" : entropy < 80 ? "(Low)" : "(Strong)"}
                  </span>
                  <span className="text-[#5C4521]">Max 64 bytes</span>
                </div>
              </div>
            )}
          </div>

          {/* Error Message */}
          {errorMsg && (
            <div className="p-2.5 bg-red-50 border border-red-300 rounded text-[12px] text-red-900 leading-snug">
              {errorMsg}
            </div>
          )}

          {/* Primary Action Button */}
          {!isConnected ? (
            <div className="w-full mt-1">
              <BotChainGate noWalletNote="Viewing or opening an envelope by link works from any web browser without a wallet. Connect to seal funds.">
                <Button
                  variant="wax"
                  size="lg"
                  disabled
                  className="w-full"
                >
                  Seal & Send
                </Button>
              </BotChainGate>
            </div>
          ) : (
            <Button
              variant="wax"
              size="lg"
              disabled={!isValid || stage === "awaiting_wallet" || stage === "awaiting_receipt"}
              loading={stage === "awaiting_wallet" || stage === "awaiting_receipt"}
              onClick={handleSeal}
              className="w-full mt-1"
            >
              {stage === "awaiting_wallet"
                ? "Confirm in Wallet…"
                : stage === "awaiting_receipt"
                ? "Sealing on BOT Chain…"
                : `Seal & Send ${amount} BOT`}
            </Button>
          )}

          <div className="text-[11px] text-[#5C4521] text-center leading-tight space-y-1">
            <p className="font-serif">
              Put BOT in an envelope. Whoever has the code can open it.
            </p>
            <p className="font-serif italic text-[#4A3A1F]">
              You can&apos;t call it back until it expires. If the code reaches the wrong person, so does the money.
            </p>
          </div>
        </div>
      </EnvelopeIllustration>
    </div>
  );
}
