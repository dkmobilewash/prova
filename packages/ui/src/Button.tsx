import type { ButtonHTMLAttributes } from "react";

type Variant = "primary" | "secondary" | "ghost";

/**
 * Primary is a brand-yellow FILL, so it carries a dark label: #171717 at 600
 * weight, 9.5:1. That is what `apps/web/tailwind.config.ts` requires of every
 * brand fill — "Never put white text on this", it says, three lines above the
 * token — and what ~20 hand-rolled buttons across `apps/web` already do
 * (`bg-brand … font-semibold text-neutral-900 hover:bg-yellow-500`).
 *
 * This comment said "primary stays blue-600" until 2026-09-16 while the code
 * under it read `bg-brand text-white hover:bg-blue-700`. The re-skin changed
 * the fill here and nothing else, so the label stayed white on yellow at
 * 1.53:1 and the hover still reverted the button to the old blue. The comment
 * describing the intended behaviour is why nobody re-read the line.
 *
 * Weight sits on each variant rather than on `base` because two Tailwind
 * utilities of the same property resolve by STYLESHEET order, not by which is
 * written last in the class string. Tailwind emits font weights in ascending
 * scale order, so a `font-semibold` after a base `font-medium` happens to win
 * — but a variant needing `font-medium` over a `font-semibold` base would
 * silently lose. Per-variant weights remove the dependency rather than rely
 * on the ordering staying favourable.
 */
export function Button({
  variant = "primary",
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  const base =
    "inline-flex items-center justify-center rounded-md px-4 py-2 text-sm transition-colors disabled:opacity-50 disabled:pointer-events-none";
  const variants: Record<Variant, string> = {
    primary: "bg-brand font-semibold text-neutral-900 hover:bg-yellow-500",
    secondary:
      "border border-line-card bg-surface font-medium text-ink-label hover:bg-tag-slate",
    ghost: "font-medium text-ink-body hover:bg-tag-slate hover:text-ink",
  };

  return <button className={`${base} ${variants[variant]} ${className}`} {...props} />;
}
