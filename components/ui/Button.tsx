"use client";

import { ButtonHTMLAttributes, forwardRef, ReactNode } from "react";

export type ButtonVariant = "primary" | "secondary" | "wax" | "ghost" | "danger";
export type ButtonSize = "sm" | "md" | "lg";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  leftIcon?: ReactNode;
}

const sizeClassMap: Record<ButtonSize, string> = {
  sm: "px-3 py-1.5 text-[12px] min-h-[36px]",
  md: "px-5 py-2.5 text-[14px] min-h-[44px]",
  lg: "px-7 py-3.5 text-[16px] min-h-[50px]",
};

const variantClassMap: Record<ButtonVariant, string> = {
  primary:
    "bg-[#7A1523] text-[#FBF3E4] font-serif font-bold shadow-[0_4px_14px_#5C0F1B] hover:brightness-110 active:scale-[0.98] border border-[#5C0F1B]",
  wax:
    "bg-[#7A1523] text-[#FBF3E4] font-serif font-bold tracking-wide rounded-full shadow-[0_6px_18px_#5C0F1B,inset_0_2px_4px_rgba(255,255,255,0.25)] hover:scale-[1.02] active:scale-[0.97] border border-[#5C0F1B]",
  secondary:
    "bg-[#F6EFE0] text-[#2A1D0E] font-medium border border-[#A88B55] hover:bg-[#FAF5EB] shadow-[0_2px_6px_rgba(42,29,14,0.08)] active:scale-[0.98]",
  ghost:
    "bg-transparent text-[#2A1D0E] font-medium border border-transparent hover:border-[#A88B55] hover:bg-[#F6EFE0]/40 active:scale-[0.98]",
  danger:
    "bg-[#FAF5EB] text-[#962121] border border-[#962121]/40 font-semibold hover:bg-red-100 active:scale-[0.98]",
};

const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      variant = "primary",
      size = "md",
      loading = false,
      disabled = false,
      leftIcon,
      children,
      className = "",
      ...rest
    },
    ref
  ) => {
    return (
      <button
        ref={ref}
        disabled={disabled || loading}
        className={[
          "inline-flex items-center justify-center gap-2 rounded-sm select-none",
          "transition-all duration-150 cursor-pointer",
          "disabled:opacity-45 disabled:cursor-not-allowed disabled:transform-none disabled:shadow-none",
          sizeClassMap[size],
          variantClassMap[variant],
          className,
        ].join(" ")}
        {...rest}
      >
        {loading ? (
          <>
            <span className="w-3.5 h-3.5 border-2 border-current border-t-transparent rounded-full animate-spin" />
            <span>{children}</span>
          </>
        ) : (
          <>
            {leftIcon && <span className="inline-flex shrink-0">{leftIcon}</span>}
            <span>{children}</span>
          </>
        )}
      </button>
    );
  }
);

Button.displayName = "Button";
export default Button;
