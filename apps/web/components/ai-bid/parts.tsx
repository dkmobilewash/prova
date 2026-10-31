import Link from "next/link";
import type { ReactNode } from "react";
import type { Severity, Source } from "@/components/ai-bid/types";

const DOT: Record<Severity, string> = {
  flag: "bg-bar-rose",
  warn: "bg-bar-amber",
  info: "bg-ink-muted",
};
const SEVERITY_WORD: Record<Severity, string> = { flag: "Needs a fix", warn: "Worth a look", info: "For your information" };

/** A stored severity is a plain string; anything unknown reads as the mildest. */
export function SeverityDot({ severity }: { severity?: string | null }) {
  const s: Severity = severity === "flag" || severity === "warn" ? severity : "info";
  return (
    <>
      <span aria-hidden className={`mt-[0.45em] inline-block h-2 w-2 shrink-0 rounded-full ${DOT[s]}`} />
      <span className="sr-only">{SEVERITY_WORD[s]}: </span>
    </>
  );
}

const CHIP =
  "inline-flex max-w-full items-center gap-1.5 truncate rounded-lg border border-line-card bg-canvas px-2 py-0.5 text-xs text-ink-body";

/** Where a finding came from. A record link stays in the app; a web page
 * opens in a new tab and says so; a label with neither is shown plain —
 * the loader is meant to have refused that, so it is drawn rather than hidden. */
export function SourceChips({ sources, fit = false }: { sources: Source[]; fit?: boolean }) {
  if (sources.length === 0) return null;
  return (
    // `fit` bounds the list to its container so a long label truncates inside
    // its chip instead of widening the page: without it the list is as wide as
    // its longest unwrapped label. Off by default — the CRM's markup is
    // unchanged — and on in C Stream Bid, measured at 375px.
    <ul aria-label="Sources" className={fit ? "flex min-w-0 max-w-full flex-wrap gap-1.5" : "flex flex-wrap gap-1.5"}>
      {sources.map((s, i) => (
        <li key={`${s.label}-${i}`} className="min-w-0 max-w-full">
          {s.href ? (
            <Link href={s.href} className={`${CHIP} hover:border-ink-muted hover:text-ink`}>
              {s.label}
            </Link>
          ) : s.url ? (
            <a href={s.url} target="_blank" rel="noreferrer" className={`${CHIP} hover:border-ink-muted hover:text-ink`}>
              {s.label}
              <span aria-hidden>↗</span>
              <span className="sr-only"> (opens a web page)</span>
            </a>
          ) : (
            <span className={CHIP}>{s.label}</span>
          )}
        </li>
      ))}
    </ul>
  );
}

export function Card({ title, aside, children, className = "" }: { title: string; aside?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`min-w-0 rounded-2xl border border-line-card bg-surface px-5 pb-4 pt-4 ${className}`}>
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-headline text-[22px] leading-tight text-ink">{title}</h2>
        {aside && <span className="text-xs font-semibold uppercase tracking-wider text-ink-muted">{aside}</span>}
      </div>
      {children}
    </section>
  );
}

/** A stored UTC-midnight calendar date, e.g. "Tue, Oct 14". */
export function calendarDay(date: Date): string {
  return new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" }).format(date);
}

/** A moment, in the reader's zone, e.g. "Oct 14, 7:31 AM". */
export function moment(date: Date, zone: string): string {
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: zone }).format(date);
}

export function sentenceCase(kind: string): string {
  const words = kind.replace(/[_-]+/g, " ").trim().toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}
