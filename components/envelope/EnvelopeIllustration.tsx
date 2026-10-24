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
 * Archetype M · Illustrated Physical Envelope Object.
 *
 * Drawn in CSS and inline SVG:
 * - Cream paper (#F6EFE0) with paper texture filter.
 * - Deep wax seal (#7A1523) with embossed monogram.
 * - Flap physically opens (450ms transition) when claim begins.
 * - Note sheet emerges from within upon opening.
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
  const isOpening = state === "opening";
  const isOpen = isOpened || isOpening;

  return (
    <div className="relative w-full max-w-[520px] mx-auto select-none pt-12 pb-6">
      {/* Hidden SVG Noise Filter for Paper Texture */}
      <svg className="absolute w-0 h-0" aria-hidden="true">
        <filter id="paper-grain">
          <feTurbulence
            type="fractalNoise"
            baseFrequency="0.04"
            numOctaves="3"
            result="noise"
          />
          <feDiffuseLighting in="noise" lightingColor="#F6EFE0" surfaceScale="1.2">
            <feDistantLight azimuth="45" elevation="60" />
          </feDiffuseLighting>
          <feBlend mode="multiply" in="SourceGraphic" result="blend" />
        </filter>
      </svg>

      {/* Main Envelope Body */}
      <div
        className="relative w-full rounded-md shadow-[0_12px_36px_rgba(42,29,14,0.18),0_2px_8px_rgba(42,29,14,0.12)] border border-[#A88B55] overflow-visible bg-[#F6EFE0] text-[#2A1D0E]"
        style={{
          minHeight: "310px",
          backgroundImage:
            "linear-gradient(135deg, rgba(255,255,255,0.4) 0%, rgba(0,0,0,0.03) 100%)",
        }}
      >
        {/* Interior Pocket Shadow */}
        <div
          aria-hidden="true"
          className="absolute inset-0 bg-[#E8DEC8] rounded-md shadow-inner pointer-events-none"
        />

        {/* Sliding Note / Letter Sheet (revealed when opened) */}
        {isOpen && note && (
          <div
            className={[
              "absolute left-4 right-4 sm:left-8 sm:right-8 -top-16 z-10",
              "p-5 sm:p-6 bg-[#FFFDF9] border border-[#A88B55] rounded-sm",
              "shadow-[0_8px_24px_rgba(42,29,14,0.14)] text-[#2A1D0E]",
              "envelope-letter extracted",
            ].join(" ")}
          >
            <div className="flex items-center justify-between border-b border-[#A88B55]/30 pb-2 mb-3">
              <span className="text-[11px] font-mono uppercase tracking-wider text-[#4A3A1F]">
                Enclosed Letter
              </span>
              <span className="text-[14px]">✉️</span>
            </div>
            <p className="font-serif italic text-[15px] sm:text-[16px] text-[#2A1D0E] leading-relaxed break-words">
              "{note}"
            </p>
          </div>
        )}

        {/* Diagonal Fold Lines (Envelope Front Geometry) */}
        <div aria-hidden="true" className="absolute inset-0 pointer-events-none z-15 overflow-hidden rounded-md">
          {/* Left fold triangle */}
          <div
            className="absolute inset-0 bg-[#F6EFE0]"
            style={{
              clipPath: "polygon(0 0, 50% 50%, 0 100%)",
              filter: "drop-shadow(2px 0 3px rgba(42,29,14,0.06))",
            }}
          />
          {/* Right fold triangle */}
          <div
            className="absolute inset-0 bg-[#F6EFE0]"
            style={{
              clipPath: "polygon(100% 0, 50% 50%, 100% 100%)",
              filter: "drop-shadow(-2px 0 3px rgba(42,29,14,0.06))",
            }}
          />
          {/* Bottom fold triangle */}
          <div
            className="absolute inset-0 bg-[#EFE6D4] border-t border-[#A88B55]/40"
            style={{
              clipPath: "polygon(0 100%, 50% 48%, 100% 100%)",
              boxShadow: "0 -3px 8px rgba(42,29,14,0.05)",
            }}
          />
        </div>

        {/* Top Triangular Flap */}
        <div
          aria-hidden="true"
          className={[
            "absolute top-0 left-0 right-0 h-[155px] z-20 envelope-flap",
            isOpen ? "open pointer-events-none" : "",
          ].join(" ")}
          style={{
            transformOrigin: "top center",
          }}
        >
          {/* Flap Polygon */}
          <div
            className="w-full h-full bg-[#FAF3E6] border-b border-[#A88B55]/50 shadow-[0_4px_10px_rgba(42,29,14,0.1)]"
            style={{
              clipPath: "polygon(0 0, 100% 0, 50% 100%)",
            }}
          />

          {/* Wax Seal Centered at the Flap Tip */}
          {!isOpen && (
            <div className="absolute -bottom-6 left-1/2 -translate-x-1/2 z-30 flex flex-col items-center">
              <button
                type="button"
                onClick={onSealClick}
                disabled={!isActionable}
                aria-label="Wax Seal"
                className={[
                  "w-14 h-14 rounded-full bg-[#7A1523] border-2 border-[#5C0F1B]",
                  "seal-press flex items-center justify-center text-[#FBF3E4]",
                  "shadow-[0_6px_16px_#5C0F1B,inset_0_2px_4px_rgba(255,255,255,0.3)]",
                  isActionable ? "cursor-pointer hover:scale-105 active:scale-95" : "cursor-default",
                ].join(" ")}
              >
                <span className="font-serif text-[22px] font-black tracking-tighter drop-shadow-sm select-none">
                  B
                </span>
              </button>
            </div>
          )}
        </div>

        {/* Envelope Content Layer (Forms, Actions, Details) */}
        <div className="relative z-25 p-6 sm:p-8 flex flex-col justify-between min-h-[310px]">
          {/* Top Stamp / Header badge */}
          <div className="flex items-center justify-between">
            <div className="border border-[#A88B55] px-2.5 py-1 rounded-sm bg-[#FAF5EB]/80 text-[#2A1D0E] text-[10px] font-mono tracking-widest uppercase">
              POSTAL PARCEL
            </div>

            {amountDisplay && (
              <div className="text-right">
                <span className="text-[11px] font-mono text-[#4A3A1F] block uppercase tracking-wider">
                  Carrying Value
                </span>
                <span className="text-[20px] sm:text-[24px] font-serif font-black text-[#7A1523]">
                  {amountDisplay} BOT
                </span>
              </div>
            )}
          </div>

          {/* Center User Form / Interaction Slot */}
          <div className="my-auto py-4 w-full">{children}</div>

          {/* Bottom Stamp Line */}
          <div className="flex items-center justify-between text-[10px] font-mono text-[#5C4521] border-t border-[#A88B55]/30 pt-2">
            <span>DISPATCH SEAL • NO. 968</span>
            <span className="uppercase">
              {state === "sealed"
                ? "TIME-LOCKED & SECURED"
                : state === "opened"
                ? "CLAIM CONFIRMED"
                : state === "refunded"
                ? "RETURNED TO SENDER"
                : "EXPIRY REACHED"}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
