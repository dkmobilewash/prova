import Link from "next/link";
import { bidCheckSummary, type BidCheck } from "@/lib/estimating/bidCheck";

/**
 * The bid check on the Send step, above the signing link (`bidCheck.ts`). Every check says
 * OPEN or CLEAR in a word as well as a colour, what it found, and a link to fix it. It never
 * disables Send: the count sits beside the button too, so it is read, not obeyed.
 */
export function BidCheckPanel({ checks }: { checks: BidCheck[] }) {
  const open = checks.filter((c) => c.open).length;
  return (
    <div data-bid-check="" data-open={open} className={`mb-3 rounded-lg border p-4 ${open > 0 ? "border-brand" : "border-line-card"} bg-surface`}>
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-base font-semibold text-ink">Bid check</h3>
        <p data-bid-check="summary" className={`text-sm font-semibold ${open > 0 ? "text-warn" : "text-ok"}`}>
          {bidCheckSummary(checks)}
        </p>
      </div>
      <ul className="divide-y divide-line-row">
        {checks.map((check) => (
          <li key={check.key} data-bid-check-item={check.key} data-state={check.open ? "open" : "clear"} className="py-2 text-sm">
            <div className="flex flex-wrap items-baseline gap-2">
              <span className={`w-12 shrink-0 text-xs font-semibold uppercase ${check.open ? "text-warn" : "text-ok"}`}>{check.open ? "Open" : "Clear"}</span>
              <span className="font-medium text-ink">{check.title}</span>
              {check.fix && (
                <Link
                  href={check.fix.href}
                  target={check.fix.newTab ? "_blank" : undefined}
                  rel={check.fix.newTab ? "noopener" : undefined}
                  data-bid-check-fix={check.key}
                  className="ml-auto text-link hover:underline"
                >
                  {check.fix.label} →
                </Link>
              )}
            </div>
            <ul className="ml-14 mt-0.5 text-ink-body">
              {check.lines.map((line, i) => (
                <li key={i}>{line}</li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
    </div>
  );
}
