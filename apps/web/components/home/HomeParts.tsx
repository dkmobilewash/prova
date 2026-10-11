import Link from "next/link";
import type { ReactNode } from "react";
import { STAGES, type NextAction, type Stage } from "./home-logic";
import { SearchChip } from "./SearchChip";

/**
 * The blocks of the home page (Concept G). Presentational and server-safe:
 * every figure arrives as a prop from app/(app)/dashboard/page.tsx, which is
 * where the data and the capability gates live.
 */

/** A shortcut is a page to open, or — when a job has to be picked first —
 * the search palette opened with a query. */
export type Shortcut = { label: string; href: string; sub?: string } | { label: string; query: string; sub?: string };

const CARD = "rounded-2xl border border-line-card bg-surface px-[22px] py-[18px]";
const DOT: Record<NeedTone, string> = { red: "bg-bar-rose", amber: "bg-bar-amber", green: "bg-bar-green" };

function BlockHead({ title, aside }: { title: string; aside?: string }) {
  return (
    <div className="mb-1.5 flex items-baseline justify-between gap-3">
      <h2 className="font-headline text-[22px] font-semibold text-ink">{title}</h2>
      {aside && <span className="text-[13px] text-ink-muted">{aside}</span>}
    </div>
  );
}

function ShortcutLink({ shortcut, className, children }: { shortcut: Shortcut; className: string; children: ReactNode }) {
  return "href" in shortcut ? (
    <Link href={shortcut.href} className={className}>
      {children}
    </Link>
  ) : (
    <SearchChip query={shortcut.query} className={className}>
      {children}
    </SearchChip>
  );
}

/* ------------------------------------------------------------ chips -- */

const CHIP = "flex items-center gap-1.5 rounded-full border border-line-card px-[15px] py-[7px] text-sm text-ink-body hover:bg-rail-hover hover:text-ink";
const CHIP_PRIMARY = "flex items-center gap-1.5 rounded-full border border-brand bg-brand px-[15px] py-[7px] text-sm font-semibold text-neutral-900 hover:bg-yellow-500";

/**
 * The shortcuts beside the greeting (Concept H): the search box made
 * compact — one chip that opens the same ⌘K palette the top bar does — then
 * New job and the job shortcuts. Desktop only; a phone has the search icon
 * in its top bar and the area tiles below.
 */
export function ShortcutChips({ newJob, others }: { newJob: boolean; others: { icon: string; shortcut: Shortcut }[] }) {
  return (
    <div className="hidden flex-wrap items-center justify-end gap-2.5 md:flex">
      <span data-tour="dashboard-ask">
        <SearchChip query="" className={CHIP}>
          <svg aria-hidden viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="h-4 w-4 text-ink-muted">
            <circle cx="11" cy="11" r="7" />
            <path d="m20 20-3.5-3.5" />
          </svg>
          Search or ask
        </SearchChip>
      </span>
      {newJob && (
        <Link href="/jobs/new" data-tour="dashboard-new-job" className={CHIP_PRIMARY}>
          <span aria-hidden>+</span> New job
        </Link>
      )}
      {others.map(({ icon, shortcut }) => (
        <ShortcutLink key={shortcut.label} shortcut={shortcut} className={CHIP}>
          <span aria-hidden className="text-ink-muted">
            {icon}
          </span>
          {shortcut.label}
        </ShortcutLink>
      ))}
    </div>
  );
}

/* ------------------------------------------------------ phone tiles -- */

/** Below md only: the one thing a foreman does from a phone every day, big.
 * The other field shortcuts the phone home used to tile (photo, RFI, daily
 * report) are one tap away in the Crew & field and Paperwork area tiles. */
export function PhoneTiles({ primary }: { primary: Shortcut }) {
  return (
    <div className="mt-3 md:hidden" data-home="phone-tiles">
      <ShortcutLink
        shortcut={primary}
        className="flex h-24 w-full items-center gap-4 rounded-[18px] bg-brand px-5 text-left text-neutral-900"
      >
        <svg aria-hidden width={34} height={34} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
          <circle cx="12" cy="12" r="9" />
          <path d="M12 7v5l3 2" />
        </svg>
        <span className="min-w-0 flex-1">
          <span className="block font-headline text-[28px] font-semibold leading-none">{primary.label}</span>
          {primary.sub && <span className="mt-1.5 block truncate text-[15px] font-semibold opacity-75">{primary.sub}</span>}
        </span>
        <svg aria-hidden width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <path d="M9 6l6 6-6 6" />
        </svg>
      </ShortcutLink>
    </div>
  );
}

/* ---------------------------------------------------- needs you today -- */

export type NeedTone = "red" | "amber" | "green";
export type NeedItem = { key: string; tone: NeedTone; text: string; when: string; action?: { label: string; href: string } };

const NEEDS_SHOWN = 6;

export function NeedsBlock({ items }: { items: NeedItem[] }) {
  const shown = items.slice(0, NEEDS_SHOWN);
  return (
    <section className={CARD} data-tour="dashboard-needs-attention">
      <BlockHead title="Needs you today" aside={`${items.length} ${items.length === 1 ? "item" : "items"}`} />
      {items.length === 0 ? (
        <p className="flex items-center gap-3 py-2 text-ink-body">
          <span className={`h-2 w-2 shrink-0 rounded-full ${DOT.green}`} />
          Nothing is waiting on you. Late invoices, late RFI answers, hours to approve and expiring papers show up here.
        </p>
      ) : (
        <ul>
          {shown.map((item) => (
            <li key={item.key} className="flex items-center gap-3 border-t border-line-row py-2 first:border-t-0">
              <span className={`h-2 w-2 shrink-0 rounded-full ${DOT[item.tone]}`} />
              <span className="line-clamp-2 min-w-0 flex-1 text-ink sm:line-clamp-1" title={item.text}>
                {item.text}
              </span>
              <span className="hidden whitespace-nowrap text-[13px] text-ink-muted sm:inline">{item.when}</span>
              {item.action && (
                <Link href={item.action.href} className="min-w-[76px] whitespace-nowrap text-right text-sm font-semibold text-link hover:text-link-hover">
                  {item.action.label} &rarr;
                </Link>
              )}
            </li>
          ))}
        </ul>
      )}
      {items.length > NEEDS_SHOWN && (
        <p className="mt-1 text-[13px] text-ink-muted">and {items.length - NEEDS_SHOWN} more</p>
      )}
    </section>
  );
}

/* -------------------------------------------------------------- money -- */

export type MoneyFigures = {
  month: string;
  billed: number;
  collected: number;
  retainage: number;
  overdue: number;
  overdueCount: number;
  outstanding: number;
  overdueHref?: string;
  retainageHref?: string;
};

/** Whole dollars: a headline figure, not a ledger line — the cents are on
 * /cash-flow and the job's billing tab. */
const dollars = (value: number) =>
  value.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

function Figure({ value, label, tone, href, children }: { value: string; label: string; tone?: string; href?: string; children?: ReactNode }) {
  const body = (
    <>
      <span className={`block font-headline text-[28px] font-semibold leading-none tabular-nums ${tone ?? "text-ink"}`}>{value}</span>
      <span className="mt-1.5 block whitespace-nowrap text-[13px] text-ink-muted">{label}</span>
      {children}
    </>
  );
  return href ? (
    <Link href={href} className="block min-w-0">
      {body}
    </Link>
  ) : (
    <div className="min-w-0">{body}</div>
  );
}

export function MoneyBlock({ figures }: { figures: MoneyFigures }) {
  const share = figures.outstanding > 0 ? Math.min(100, Math.round((figures.overdue / figures.outstanding) * 100)) : 0;
  return (
    <section className={CARD} data-tour="dashboard-money">
      <BlockHead title="Money" aside={figures.month} />
      <div className="mt-2.5 grid grid-cols-2 gap-x-[18px] gap-y-4">
        <Figure value={dollars(figures.billed)} label="Billed this month" />
        <Figure value={dollars(figures.collected)} label="Collected this month" />
        <Figure value={dollars(figures.retainage)} label="Retainage held" href={figures.retainageHref} />
        <Figure
          value={dollars(figures.overdue)}
          tone={figures.overdue > 0 ? "text-danger" : undefined}
          label={
            figures.overdueCount === 0
              ? "Nothing overdue"
              : `Overdue · ${figures.overdueCount} ${figures.overdueCount === 1 ? "invoice" : "invoices"}`
          }
          href={figures.overdueHref}
        >
          {figures.overdueCount > 0 && (
            <span className="mt-2 block h-[5px] overflow-hidden rounded bg-line-row" title={`${share}% of what you are owed`}>
              <span className="block h-full bg-bar-rose" style={{ width: `${share}%` }} />
            </span>
          )}
        </Figure>
      </div>
    </section>
  );
}

/* --------------------------------------------------------- crews today -- */

export type CrewToday = { jobId: string; jobName: string; people: string[] };

function initials(name: string) {
  return (
    name
      .split(/\s+/)
      .filter((w) => /^[A-Za-z0-9]/.test(w))
      .slice(0, 2)
      .map((w) => w[0]!.toUpperCase())
      .join("") || "?"
  );
}

export function CrewsBlock({ crews }: { crews: CrewToday[] }) {
  const people = crews.reduce((sum, c) => sum + c.people.length, 0);
  return (
    <section className={CARD} data-tour="dashboard-field">
      <BlockHead title="Crews today" aside={people > 0 ? `${people} scheduled` : undefined} />
      {crews.length === 0 ? (
        <p className="py-2 text-ink-body">
          Nobody is on the schedule for today.{" "}
          <Link href="/schedule" className="text-link hover:text-link-hover">
            Open the schedule
          </Link>
        </p>
      ) : (
        <ul>
          {crews.map((crew) => (
            <li key={crew.jobId} className="border-t border-line-row first:border-t-0">
              <Link href={`/jobs/${crew.jobId}/crew`} className="flex items-center gap-3 py-1.5">
                <span className="grid h-8 w-8 shrink-0 place-items-center rounded-[9px] bg-rail-hover text-xs font-semibold text-ink">
                  {initials(crew.jobName)}
                </span>
                <span className="min-w-0 flex-1 leading-snug">
                  <span className="block truncate text-sm font-medium text-ink">{crew.jobName}</span>
                  <span className="block truncate text-[12.5px] text-ink-muted">{crew.people.join(", ")}</span>
                </span>
                <span className="whitespace-nowrap text-ink">
                  {crew.people.length} <span className="text-[13px] text-ink-muted">ppl</span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/* ----------------------------------------------------------- job cards -- */

export type JobCardData = {
  id: string;
  name: string;
  /** "GC · trade · 57% billed", already joined, only what this viewer may see. */
  line: string;
  stage: Stage;
  tag?: { text: string; tone: "rose" | "amber" };
  health?: { sentence: string; tone: "over" | "watch" };
  action: NextAction;
};

const TAG_TONE = { rose: "bg-tag-rose text-tag-rose-ink", amber: "bg-tag-amber text-tag-amber-ink" };
const ACT = "mt-auto flex h-11 items-center justify-between gap-3 rounded-[10px] border border-line-card bg-canvas px-4 text-[15px] font-medium text-ink hover:bg-rail-hover";
const ACT_PRIMARY = "mt-auto flex h-11 items-center justify-between gap-3 rounded-[10px] border border-brand bg-brand px-4 text-[15px] font-semibold text-neutral-900 hover:bg-yellow-500";

export function StageStrip({ stage }: { stage: Stage }) {
  const at = STAGES.indexOf(stage);
  return (
    <div data-stage={stage}>
      <div className="mb-1.5 mt-4 flex gap-1" aria-hidden>
        {STAGES.map((s, i) => (
          // Borders, not fills: the current stage is a yellow LINE, and a
          // bg-brand fill would owe a dark label (theme-contrast census).
          <span
            key={s}
            className={`h-1.5 flex-1 rounded-full border-[3px] ${
              i < at ? "border-ink-muted/60" : i === at ? "border-brand" : "border-line-row"
            }`}
          />
        ))}
      </div>
      <ol className="mb-3.5 flex text-xs text-ink-muted" aria-label={`Stage: ${stage}`}>
        {STAGES.map((s) => (
          <li key={s} className={`flex-1 truncate ${s === stage ? "font-semibold text-ink" : ""}`} aria-current={s === stage ? "step" : undefined}>
            {s}
          </li>
        ))}
      </ol>
    </div>
  );
}

export function JobCard({ job }: { job: JobCardData }) {
  return (
    <article className="flex flex-col rounded-[14px] border border-line-card bg-surface px-[22px] py-[18px]">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <Link href={`/jobs/${job.id}`} className="block font-headline text-2xl font-semibold leading-tight text-ink hover:underline">
            {job.name}
          </Link>
          {job.line && <p className="mt-0.5 text-sm text-ink-muted">{job.line}</p>}
        </div>
        {job.tag && (
          <span className={`whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold ${TAG_TONE[job.tag.tone]}`}>{job.tag.text}</span>
        )}
      </div>
      {job.health && (
        <p className={`mt-1 text-[13px] ${job.health.tone === "over" ? "text-tag-rose-ink" : "text-tag-amber-ink"}`}>
          {job.health.sentence}
        </p>
      )}
      <StageStrip stage={job.stage} />
      <Link href={job.action.href} className={job.action.primary ? ACT_PRIMARY : ACT}>
        <span className="truncate">{job.action.label}</span>
        <span className={`whitespace-nowrap text-[13px] font-medium ${job.action.primary ? "opacity-75" : "text-ink-muted"}`}>
          {job.action.note ? `${job.action.note} ` : ""}&rarr;
        </span>
      </Link>
    </article>
  );
}
