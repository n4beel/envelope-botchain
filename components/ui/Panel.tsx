import { HTMLAttributes, ReactNode } from "react";

export interface PanelProps extends HTMLAttributes<HTMLDivElement> {
  paperStyle?: "cream" | "kraft" | "elevated";
  flush?: boolean;
  waxSealed?: boolean;
  children?: ReactNode;
}

/**
 * Archetype M · Parchment Folio Container.
 * Heavy cream-laid paper with tactile fiber edges and deep ink contrast.
 */
export default function Panel({
  paperStyle = "cream",
  flush = false,
  waxSealed = false,
  children,
  className = "",
  style,
  ...rest
}: PanelProps) {
  const bg =
    paperStyle === "kraft"
      ? "bg-[#BA955B] text-[#2A1D0E] border-[#8C6F3D]"
      : paperStyle === "elevated"
      ? "bg-[#FAF5EB] text-[#2A1D0E] border-[#A88B55]"
      : "bg-[#F6EFE0] text-[#2A1D0E] border-[#A88B55]";

  return (
    <div
      className={[
        "relative rounded-sm transition-shadow",
        "border shadow-[0_4px_20px_rgba(42,29,14,0.09)]",
        flush ? "p-0" : "p-6 sm:p-7",
        bg,
        className,
      ].join(" ")}
      style={style}
      {...rest}
    >
      {waxSealed && (
        <div
          aria-hidden="true"
          className="absolute -top-3 -right-3 w-7 h-7 rounded-full bg-[#7A1523] border border-[#5C0F1B] shadow-md flex items-center justify-center text-[#FBF3E4] text-[11px] font-serif font-bold"
        >
          ✉
        </div>
      )}
      {children}
    </div>
  );
}
