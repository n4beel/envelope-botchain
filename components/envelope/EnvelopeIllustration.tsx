"use client";

import React, { ReactNode } from "react";

export interface EnvelopeIllustrationProps {
  state?: "sealed" | "opening" | "opened" | "expired" | "refunded";
  amountDisplay?: string;
  note?: string;
  children?: ReactNode;
  onSealClick?: () => void;
  isActionable?: boolean;
}

/**
 * Archetype M · Physical Envelope Object Frame.
 *
 * Designed with a clean, calm working area:
 * - Solid plain paper surface behind inputs and text with no diagonal fold lines.
 * - Envelope identity with a low-contrast postal frame and wax seal reserved in the header.
 * - The wax seal sits beside the amount/badge in the header, never overlapping text or inputs.
 * - Solid paper container maintains full WCAG contrast and readability at both 360px and desktop widths.
 */
export default function EnvelopeIllustration({
  state = "sealed",
  amountDisplay,
  note,
  children,
  onSealClick,
  isActionable = false,
}: EnvelopeIllustrationProps) {
  const isOpened = state === "opened";

  return (
    <div className="relative w-full max-w-[540px] mx-auto select-none py-2">
      {/* Outer Envelope Frame */}
      <div className="relative w-full rounded-md shadow-[0_10px_30px_rgba(42,29,14,0.15)] border-2 border-[#A88B55] bg-[#FAF5EB] text-[#2A1D0E] overflow-hidden">
        {/* Top Postal Header with Reserved Wax Seal & Value */}
        <div className="bg-[#F0E6D2] border-b-2 border-[#A88B55]/60 px-5 py-3.5 flex items-center justify-between gap-3">
          {/* Left: Wax Seal in dedicated reserved spot beside status */}
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={onSealClick}
              disabled={!isActionable}
              aria-label="Wax Seal"
              className={[
                "w-11 h-11 rounded-full bg-[#7A1523] border-2 border-[#5C0F1B] shrink-0",
                "seal-press flex items-center justify-center text-[#FBF3E4]",
                "shadow-[0_3px_10px_#5C0F1B,inset_0_1px_3px_rgba(255,255,255,0.3)]",
                isActionable ? "cursor-pointer hover:scale-105 active:scale-95" : "cursor-default",
              ].join(" ")}
            >
              <span className="font-serif text-[18px] font-black tracking-tighter drop-shadow-sm select-none">
                B
              </span>
            </button>
            <div className="flex flex-col">
              <span className="text-[10px] font-mono tracking-widest uppercase text-[#5C4521]">
                {state === "opened"
                  ? "CLAIM CONFIRMED"
                  : state === "refunded"
                  ? "RETURNED TO SENDER"
                  : state === "expired"
                  ? "EXPIRED PARCEL"
                  : "PARCEL NO. 968"}
              </span>
              <span className="text-[13px] font-serif font-bold text-[#2A1D0E]">
                {state === "opened"
                  ? "Opened Envelope"
                  : state === "refunded"
                  ? "Reclaimed Funds"
                  : state === "expired"
                  ? "Expired Time-Lock"
                  : "Time-Sealed Envelope"}
              </span>
            </div>
          </div>

          {/* Right: Carrying Value in header */}
          {amountDisplay && (
            <div className="text-right shrink-0">
              <span className="text-[10px] font-mono text-[#5C4521] block uppercase tracking-wider">
                Value
              </span>
              <span className="text-[18px] sm:text-[20px] font-serif font-black text-[#7A1523]">
                {amountDisplay} BOT
              </span>
            </div>
          )}
        </div>

        {/* Revealed Enclosed Letter (only when opened with a note) */}
        {isOpened && note && (
          <div className="m-5 p-4 bg-[#FFFDF9] border border-[#A88B55] rounded-sm shadow-sm text-[#2A1D0E]">
            <div className="flex items-center justify-between border-b border-[#A88B55]/30 pb-1.5 mb-2">
              <span className="text-[10px] font-mono uppercase tracking-wider text-[#5C4521]">
                Enclosed Letter
              </span>
              <span className="text-[12px]">✉️</span>
            </div>
            <p className="font-serif italic text-[14px] sm:text-[15px] text-[#2A1D0E] leading-relaxed break-words">
              &ldquo;{note}&rdquo;
            </p>
          </div>
        )}

        {/* Working Area: Solid, uncluttered, plain paper surface behind inputs & text */}
        <div className="p-5 sm:p-7 bg-[#FAF5EB]">
          {children}
        </div>

        {/* Bottom Postal Edge */}
        <div className="bg-[#F0E6D2] border-t border-[#A88B55]/50 px-5 py-2 flex items-center justify-between text-[10px] font-mono text-[#5C4521]">
          <span>DISPATCH SEAL • BOT CHAIN</span>
          <span className="uppercase">
            {state === "sealed"
              ? "TIME-LOCKED & SECURED"
              : state === "opened"
              ? "CLAIM TRANSFERRED"
              : state === "refunded"
              ? "RETURNED"
              : "EXPIRED"}
          </span>
        </div>
      </div>
    </div>
  );
}
