import type { ButtonHTMLAttributes } from "react";

type Variant = "primary" | "secondary";

export function Button({
  variant = "primary",
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  const base =
    "inline-flex items-center justify-center rounded-md px-4 py-2 text-sm font-medium transition-colors disabled:opacity-50 disabled:pointer-events-none";
  const variants: Record<Variant, string> = {
    primary: "bg-blue-600 text-white hover:bg-blue-500",
    secondary: "bg-slate-800 text-slate-100 hover:bg-slate-700",
  };

  return <button className={`${base} ${variants[variant]} ${className}`} {...props} />;
}
