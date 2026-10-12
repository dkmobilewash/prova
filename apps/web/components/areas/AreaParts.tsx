import Link from "next/link";
import { NAV_ITEMS } from "@/components/navItems";
import type { AreaView, Tone, ToolStatus } from "@/lib/areas";
import type { WaitingList } from "@/lib/areas-data";

/**
 * The pieces the home boxes and the area pages share (Concept H). Server-safe
 * and presentational: every figure arrives in an AreaView built by
 * lib/areas.ts from lib/areas-data.ts.
 */

export const DOT: Record<Tone, string> = { red: "bg-bar-rose", amber: "bg-bar-amber", green: "bg-bar-green" };
const TEXT: Record<Tone, string> = { red: "text-danger", amber: "text-tag-amber-ink", green: "text-ink-muted" };

export function AreaIcon({ paths, className = "h-5 w-5" }: { paths: string[]; className?: string }) {
  return (
    <svg aria-hidden viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" className={className}>
      {paths.map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  );
}

const iconByHref = new Map(NAV_ITEMS.map((item) => [item.href, item.icon]));

/** A tool's icon is its nav entry's icon — one drawing per page app-wide. */
export function ToolIcon({ route }: { route: string }) {
  return (
    <span aria-hidden className="grid h-9 w-9 shrink-0 place-items-center rounded-[10px] bg-rail-hover text-ink">
      {iconByHref.get(route)}
    </span>
  );
}

/** A status as a dot and words — several parts joined by " · ", each in
 * its own tone, the dot taking the first part's that has one — or the plain
 * description when there is none. */
export function StatusLine({ status, fallback, className = "" }: { status: ToolStatus | ToolStatus[] | null; fallback: string; className?: string }) {
  const parts = status === null ? [] : Array.isArray(status) ? status : [status];
  if (parts.length === 0) return <span className={`block text-[13.5px] leading-snug text-ink-muted ${className}`}>{fallback}</span>;
  const dot = parts.find((p) => p.tone)?.tone;
  return (
    <span className={`flex min-w-0 items-start gap-[7px] text-[13.5px] leading-snug ${className}`}>
      {dot && <span aria-hidden className={`mt-[0.42em] h-[7px] w-[7px] shrink-0 rounded-full ${DOT[dot]}`} />}
      <span className="min-w-0">
        {parts.map((p, i) => (
          <span key={p.text} className={p.tone ? TEXT[p.tone] : "text-ink-muted"}>
            {i > 0 && <span className="text-ink-muted"> · </span>}
            {p.text}
          </span>
        ))}
      </span>
    </span>
  );
}

/** A count chip for the dropdown rows. */
export function StatusChip({ status }: { status: ToolStatus }) {
  const tone =
    status.tone === "red"
      ? "bg-tag-rose text-tag-rose-ink"
      : status.tone === "amber"
        ? "bg-tag-amber text-tag-amber-ink"
        : "bg-rail-hover text-ink-body";
  return <span className={`whitespace-nowrap rounded-full px-2.5 py-1 text-[13px] font-semibold ${tone}`}>{status.text}</span>;
}

/* --------------------------------------------------------- area page -- */

/** The actions on a tool card (one, except Jobs), and which is a create.
 *
 * "Open <tool name>", or the tool's own short `action` from lib/areas.ts
 * when that will not fit — never a bare "Open" (until 2026-10-10 a long name
 * fell back to one, so "Open RFIs" sat beside "Open"). It used to truncate
 * instead, and at 1555px "Open Closeout & …" hid the tool's name; the label
 * is now never cut (areas.test.ts holds every one under the ceiling measured
 * in Chromium, and a label past it wraps rather than hides).
 *
 * `create` is true only for a genuine create action: the jobs list's create
 * page (/jobs/new) and /bids?new=1, which opens the bids page with its add-form
 * already open. Every other tool's create form lives on its list page, so
 * opening that page is not a create. Only a create
 * gets the brand-yellow fill — it used to go to whichever card was first,
 * which made "Open Cash flow" look like the thing the Money area wanted
 * you to do. */
export type ToolAction = { label: string; href: string; create: boolean };

export function toolActions(tool: { route: string; href: string; name: string; action?: string }): ToolAction[] {
  const open = { label: tool.action ?? `Open ${tool.name}`, href: tool.href, create: false };
  // Jobs is the one tool with a create page, and the create must not be the
  // ONLY way in: with just "+ New job" the card had no door to the list
  // itself (click test, 2026-10-11). Create first, in yellow; open under it.
  if (tool.route === "/dashboard") return [{ label: "+ New job", href: "/jobs/new", create: true }, { ...open, label: "Open jobs" }];
  // Bids has no create page; ?new=1 opens /bids's own add-form, so a bid
  // can be logged without first finding the GC's contact page.
  if (tool.route === "/bids") return [{ label: "+ Log a bid", href: "/bids?new=1", create: true }, { ...open, label: "Open bids" }];
  return [open];
}

/**
 * A tool on an area page: icon, name, ONE status line and its action(s).
 *
 * No big number in the corner. It used to repeat the status line's first
 * word — "1" above "1 RFI waiting" — so every figure was said twice.
 */
export function ToolCard({ tool }: { tool: AreaView["tools"][number] }) {
  return (
    <article className="flex min-w-0 flex-col rounded-[14px] border border-line-card bg-surface p-4" data-area-tool={tool.route}>
      <ToolIcon route={tool.route} />
      <h2 className="mt-2 font-headline text-lg leading-tight text-ink">
        <Link href={tool.href} className="hover:underline">
          {tool.name}
        </Link>
      </h2>
      <StatusLine status={tool.status} fallback={tool.description} className="mt-0.5 min-h-5" />
      {tool.status && <p className="mt-1 line-clamp-2 text-[13px] text-ink-muted">{tool.description}</p>}
      <div className="mt-auto flex flex-col gap-2 pt-3">
        {toolActions(tool).map((action) => (
          <Link
            key={action.href}
            href={action.href}
            className={`flex min-h-11 min-w-0 items-center justify-center rounded-[10px] border px-3 py-1 text-center text-sm font-semibold leading-tight ${
              action.create
                ? "border-brand bg-brand text-neutral-900 hover:bg-brand-hover"
                : "border-line-card bg-canvas text-ink hover:bg-rail-hover"
            }`}
          >
            {action.label}
          </Link>
        ))}
      </div>
    </article>
  );
}

const CHIP_TONE: Record<Tone | "neutral", string> = {
  red: "bg-tag-rose text-tag-rose-ink",
  amber: "bg-tag-amber text-tag-amber-ink",
  green: "bg-tag-green text-tag-green-ink",
  neutral: "bg-rail-hover text-ink-body",
};

export function WaitingTable({ list }: { list: WaitingList }) {
  return (
    <section className="mt-5 overflow-hidden rounded-2xl border border-line-card bg-surface" aria-labelledby="area-waiting">
      <div className="flex flex-wrap items-baseline justify-between gap-2 px-5 pb-2 pt-3">
        <h2 id="area-waiting" className="font-headline text-xl text-ink">
          {list.title}
        </h2>
        {list.total > 0 && (
          <span className="text-sm text-ink-muted">
            {list.total} {list.total === 1 ? "item" : "items"}
            {list.total > list.rows.length ? ` · first ${list.rows.length} shown` : ""}
          </span>
        )}
      </div>
      {list.rows.length === 0 ? (
        <p className="flex items-center gap-3 border-t border-line-row px-5 py-3 text-ink-body">
          <span aria-hidden className="h-2 w-2 shrink-0 rounded-full bg-bar-green" />
          {list.empty}
        </p>
      ) : (
        <ul>
          {list.rows.map((row) => (
            <li key={row.key} className="border-t border-line-row">
              <Link
                href={row.href}
                className="grid grid-cols-[1fr_auto] items-center gap-x-4 gap-y-1 px-5 py-2.5 hover:bg-rail-hover mouse:py-2 md:grid-cols-[minmax(10rem,14rem)_minmax(0,1fr)_minmax(0,14rem)_6.5rem_9rem_4.5rem]"
              >
                <span className="flex min-w-0 items-center gap-2.5 font-semibold text-ink">
                  <span className="rounded-[5px] border border-line-card px-1.5 text-xs font-semibold text-ink-muted">{row.tag}</span>
                  <span className="truncate">{row.ref}</span>
                </span>
                <span className="col-span-2 truncate text-ink md:col-span-1">{row.subject}</span>
                <span className="truncate text-ink-body">{row.job ?? ""}</span>
                <span className="whitespace-nowrap text-right text-ink-body tabular-nums md:text-left">{row.when}</span>
                {/* Phone: the status chip sits beside the ref on the first
                    line, not alone on a fourth (measured at 375: rows went
                    from 134px to 106px with nothing hidden). */}
                <span className="max-md:col-start-2 max-md:row-start-1 max-md:justify-self-end">
                  <span className={`inline-block whitespace-nowrap rounded-full px-2.5 py-0.5 text-[12.5px] font-semibold ${CHIP_TONE[row.status.tone]}`}>
                    {row.status.text}
                  </span>
                </span>
                <span className="hidden whitespace-nowrap text-right font-semibold text-link md:block">{row.action} &rarr;</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
