import type { ButtonHTMLAttributes } from "react";

type Variant = "primary" | "secondary" | "ghost";

/**
 * Primary stays blue-600 — the re-skin changed surfaces and tags, not
 * Prova's own accent colour, so an action looks the same as it always did.
 */
export function Button({
  variant = "primary",
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  const base =
    "inline-flex items-center justify-center rounded-md px-4 py-2 text-sm font-medium transition-colors disabled:opacity-50 disabled:pointer-events-none";
  const variants: Record<Variant, string> = {
    primary: "bg-brand text-white hover:bg-blue-700",
    secondary: "border border-line-card bg-surface text-ink-label hover:bg-tag-slate",
    ghost: "text-ink-body hover:bg-tag-slate hover:text-ink",
  };

  return <button className={`${base} ${variants[variant]} ${className}`} {...props} />;
}
