import type { HTMLAttributes } from "react";

/**
 * A surface. Light ground, hairline border, no shadow by default.
 *
 * `accent` draws a 3px bar down the left edge, and exists ONLY for
 * summary cards — the four "needs attention" tiles. Plain cards below
 * them take no bar: a colour on every card is a colour that says nothing,
 * and the bar is meant to mark the row someone should look at first.
 */
type Accent = "rose" | "amber" | "green" | "blue" | "indigo" | "violet" | "teal";

const ACCENT_BAR: Record<Accent, string> = {
  rose: "before:bg-bar-rose",
  amber: "before:bg-bar-amber",
  green: "before:bg-bar-green",
  blue: "before:bg-bar-blue",
  indigo: "before:bg-bar-indigo",
  violet: "before:bg-bar-violet",
  teal: "before:bg-bar-teal",
};

export function Card({
  accent,
  className = "",
  ...props
}: HTMLAttributes<HTMLDivElement> & { accent?: Accent }) {
  const bar = accent
    ? `relative overflow-hidden before:absolute before:inset-y-0 before:left-0 before:w-[3px] before:content-[''] ${ACCENT_BAR[accent]}`
    : "";

  return (
    <div
      className={`rounded-lg border border-line-card bg-surface p-6 ${bar} ${className}`}
      {...props}
    />
  );
}
