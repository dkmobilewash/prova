import type { ReactNode } from "react";

/**
 * One native `<details>`, styled once — the thing behind "see it, then click
 * into it" wherever the detail is text or a form rather than a whole page.
 * Extracted from the three `<details>` on /settings (density audit, pattern
 * 4; thirteen ad-hoc copies existed and none was shared).
 *
 * Native on purpose: works before hydration and with no JS, `open` is a
 * plain attribute a server page can set from a search param, and `name`
 * gives a group of them accordion behaviour for free — one open at a time,
 * which is exactly "a row opens its edit form on click (one at a time)".
 *
 *   card  — a bordered box; an explainer ("How this works") or an add form
 *           under a list. The settings look.
 *   row   — a list row that opens: a 44px one-line summary on a row rule,
 *           the detail under it. Give the group a `name` so opening one
 *           closes the last. Put row ACTIONS in the children, not the
 *           summary — a button inside `<summary>` also toggles it.
 *   plain — no chrome; a footnote or a long paragraph's second half.
 *
 * `summary` is the one line that is always visible; make it carry the facts
 * (date · job · crew · hours) so the closed row still answers the question.
 */
export function Disclosure({
  summary,
  children,
  open,
  name,
  variant = "card",
  id,
  className = "",
}: {
  summary: ReactNode;
  children: ReactNode;
  open?: boolean;
  /** Same name on siblings = at most one of them open (native accordion). */
  name?: string;
  variant?: "card" | "row" | "plain";
  id?: string;
  className?: string;
}) {
  const box =
    variant === "card"
      ? "rounded-lg border border-line-card bg-surface p-4"
      : variant === "row"
        ? "border-b border-line-row last:border-b-0"
        : "";
  const line =
    variant === "row"
      ? "flex min-h-11 cursor-pointer items-center gap-3 py-2 text-sm text-ink hover:bg-rail-hover mouse:min-h-9 [&::-webkit-details-marker]:text-ink-muted"
      : "cursor-pointer text-sm font-medium text-ink-label";
  return (
    <details id={id} open={open} name={name} className={`${box} ${className}`}>
      <summary className={line}>{summary}</summary>
      <div className={variant === "row" ? "pb-3 pl-5 text-sm text-ink-body" : "mt-4"}>{children}</div>
    </details>
  );
}
