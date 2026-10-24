"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import ConnectButton from "@/components/ui/ConnectButton";
import NetworkBadge from "@/components/botchain/NetworkBadge";
import BuiltOnBotChain from "@/components/botchain/BuiltOnBotChain";
import { app } from "@/lib/app-config";

export interface PageShellProps {
  children: React.ReactNode;
  title?: string;
  description?: string;
}

/**
 * Archetype M · Object App Shell.
 *
 * No generic top navbar and no card containers. The layout frames a single physical object:
 * an envelope resting on a warm kraft dispatch table.
 *
 * Top-left: Small engraved wordmark.
 * Top-right: Minimal wallet connect & network indicator.
 * Hanging tag: Tied with twine for secondary navigation (My Envelopes / Seal New).
 * Footer: Stamped postmark along the bottom edge.
 */
export default function PageShell({ children, title, description }: PageShellProps) {
  const pathname = usePathname();
  const isMine = pathname === "/mine";

  return (
    <div className="min-h-[100dvh] flex flex-col justify-between overflow-x-hidden relative text-[#2A1D0E]">
      {/* Top utility row: Wordmark and Wallet Connect */}
      <header className="w-full max-w-[820px] mx-auto px-4 sm:px-6 pt-4 pb-2 flex items-center justify-between z-20">
        <div className="flex items-center gap-3">
          <Link
            href="/"
            className="flex items-center gap-2 group text-[#2A1D0E] font-serif font-black text-[18px] sm:text-[20px] tracking-tight hover:opacity-85 transition-opacity"
          >
            <span
              className="w-3.5 h-3.5 rounded-full bg-[#7A1523] shadow-inner inline-block"
              aria-hidden="true"
            />
            <span className="uppercase tracking-[0.06em]">{app.name}</span>
          </Link>
        </div>

        <div className="flex items-center gap-2.5">
          {/* Hanging luggage / postal tag */}
          <Link
            href={isMine ? "/" : "/mine"}
            className="hanging-tag hidden sm:inline-flex items-center gap-1.5 px-3 py-1 bg-[#F6EFE0] border border-[#A88B55] shadow-sm rounded-sm text-[12px] font-serif font-bold text-[#2A1D0E] hover:bg-[#FAF5EB] hover:-translate-y-0.5 transition-all"
            title={isMine ? "Seal a new envelope" : "View my envelopes"}
          >
            <span className="text-[#A88B55]" aria-hidden="true">🏷</span>
            <span>{isMine ? "Seal Envelope" : "My Envelopes"}</span>
          </Link>

          <NetworkBadge />
          <div className="w-[136px]">
            <ConnectButton />
          </div>
        </div>
      </header>

      {/* Hanging tag on mobile below header */}
      <div className="sm:hidden px-4 flex justify-end z-20">
        <Link
          href={isMine ? "/" : "/mine"}
          className="hanging-tag inline-flex items-center gap-1.5 px-2.5 py-1 bg-[#F6EFE0] border border-[#A88B55] shadow-sm rounded-sm text-[11px] font-serif font-bold text-[#2A1D0E]"
        >
          <span className="text-[#A88B55]" aria-hidden="true">🏷</span>
          <span>{isMine ? "Seal Envelope" : "My Envelopes"}</span>
        </Link>
      </div>

      {/* Main Object Workspace */}
      <main className="flex-1 w-full max-w-[620px] mx-auto px-4 py-4 sm:py-6 flex flex-col justify-center items-center z-10">
        {(title || description) && (
          <div className="text-center mb-4 max-w-[500px]">
            {title && (
              <h1 className="text-[24px] sm:text-[28px] font-serif font-extrabold text-[#2A1D0E] tracking-tight leading-snug">
                {title}
              </h1>
            )}
            {description && (
              <p className="mt-1 text-[13px] sm:text-[14px] text-[#4A3A1F] leading-relaxed">
                {description}
              </p>
            )}
          </div>
        )}

        <div className="w-full flex justify-center">{children}</div>
      </main>

      {/* Postmark cancellation stamp footer */}
      <footer className="w-full max-w-[820px] mx-auto px-4 py-4 flex flex-col sm:flex-row items-center justify-between gap-2 border-t border-[#A88B55]/40 text-[#4A3A1F] text-[11px] font-mono z-10">
        <div className="flex items-center gap-2">
          <span className="inline-block w-4 h-4 rounded-full border border-dashed border-[#5C4521] text-center leading-3 text-[9px] font-serif">
            §
          </span>
          <span className="uppercase tracking-wider">
            BOT CHAIN POSTAL SERVICE • PROTOCOL NO. 07
          </span>
        </div>

        <div className="flex items-center gap-3">
          <span className="text-[#5C4521]/70">DISPATCHED ON-CHAIN</span>
          <BuiltOnBotChain />
        </div>
      </footer>
    </div>
  );
}
