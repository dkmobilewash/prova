import Link from "next/link";
import { prisma } from "@prova/db";
import { relativeTime } from "@/lib/integrations/relativeTime";
import { isStale } from "@/lib/acc/feed";
import { ACCRefresh } from "@/components/ACCRefresh";

type Kind = "RFI" | "SUBMITTAL";

const HEADINGS: Record<Kind, { title: string; empty: string }> = {
  RFI: { title: "RFIs from the GC's Autodesk Construction Cloud", empty: "No RFIs in this ACC project yet." },
  SUBMITTAL: {
    title: "Submittals from the GC's Autodesk Construction Cloud",
    empty: "No submittals in this ACC project yet.",
  },
};

/** Rows shown per project before "and N more in ACC". */
const SHOW = 100;

function day(date: Date | null) {
  // Stored at UTC midnight, rendered in UTC — the app-wide date rule.
  return date ? date.toISOString().slice(0, 10) : null;
}

/**
 * The GC's own records, read from Autodesk Construction Cloud, on /rfis and
 * /submittals. Same shape as ProcoreFeedSection.tsx — a SEPARATE section
 * from this company's log, never merged into it: the sub's RFIs and
 * submittals are their evidence records, counter-numbered and
 * identity-locked, and the GC's are somebody else's with somebody else's
 * numbers. Everything here says whose it is and links back to ACC, where
 * the GC keeps it.
 *
 * Renders nothing for a company that has not connected ACC, so the pages do
 * not grow an empty box for everyone who never will.
 */
export type ACCFeed = Awaited<ReturnType<typeof loadAccFeed>>;

/**
 * The section's data, loaded by the PAGE and handed down, rather than read
 * inside an async component: the pages render synchronously in tests
 * (correspondence-dates.test.ts) and an async child would suspend there.
 */
export async function loadAccFeed(companyId: string, kind: Kind, activeJob: string | null) {
  const [connection, links] = await Promise.all([
    prisma.integrationConnection.findUnique({
      where: { companyId_provider: { companyId, provider: "ACC" } },
      select: { status: true },
    }),
    prisma.accProjectLink.findMany({
      where: { companyId, ...(activeJob ? { jobId: activeJob } : {}) },
      orderBy: { linkedAt: "asc" },
      select: {
        id: true,
        accProjectName: true,
        accAccountName: true,
        lastRefreshedAt: true,
        lastRefreshStatus: true,
        lastRefreshMessage: true,
        job: { select: { name: true } },
        items: {
          where: { companyId, kind },
          orderBy: [{ number: "asc" }, { title: "asc" }],
          select: {
            id: true,
            number: true,
            title: true,
            status: true,
            revision: true,
            discipline: true,
            ballInCourt: true,
            dueDate: true,
            webUrl: true,
          },
        },
      },
    }),
  ]);
  return { kind, activeJob, connected: connection?.status === "CONNECTED", links: links ?? [] };
}

export function ACCFeedSection({ feed }: { feed: ACCFeed }) {
  const { kind, activeJob, links } = feed;
  const connection = feed.connected ? { status: "CONNECTED" } : null;

  if (links.length === 0) {
    if (connection?.status !== "CONNECTED" || activeJob) return null;
    return (
      <section className="mt-10" data-tour="acc-feed">
        <h2 className="text-sm font-semibold text-ink-label">From the GC&rsquo;s Autodesk Construction Cloud</h2>
        <p className="mt-1 text-sm text-ink-body">
          ACC is connected, but no GC project is linked to a job yet. The account owner links one on{" "}
          <Link href="/settings/integrations#acc" className="text-link">
            Settings → Integrations
          </Link>
          .
        </p>
      </section>
    );
  }

  const now = new Date();
  const stale = connection?.status === "CONNECTED" && links.some((link) => isStale(link.lastRefreshedAt, now));
  const heading = HEADINGS[kind];

  return (
    <section className="mt-10" data-tour="acc-feed">
      <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-sm font-semibold text-ink">{heading.title}</h2>
          <p className="mt-1 max-w-2xl text-sm text-ink-body">
            The GC&rsquo;s own records, read from Autodesk Construction Cloud. They are theirs: C Stream
            only reads them, and they are not part of your log above. Open one in ACC to answer or
            change it.
          </p>
        </div>
        {connection?.status === "CONNECTED" ? (
          <ACCRefresh jobId={activeJob} stale={stale} />
        ) : (
          <p className="max-w-xs text-xs text-ink-muted sm:text-right">
            ACC isn&rsquo;t connected right now, so this is what was last read. The account owner
            reconnects on Settings → Integrations.
          </p>
        )}
      </div>

      <div className="flex flex-col gap-4">
        {links.map((link) => (
          <div key={link.id} className="rounded-lg border border-dashed border-line-card bg-surface">
            <div className="flex flex-col gap-1 border-b border-line-row px-4 py-2 sm:flex-row sm:items-baseline sm:justify-between">
              <span className="text-sm font-medium text-ink">
                {link.accProjectName}{" "}
                <span className="font-normal text-ink-muted">
                  — {link.accAccountName}&rsquo;s project, linked to {link.job.name}
                </span>
              </span>
              <span
                className={`text-xs ${link.lastRefreshStatus === "FAILURE" ? "text-tag-rose-ink" : "text-ink-muted"}`}
              >
                {link.lastRefreshedAt ? `Read ${relativeTime(link.lastRefreshedAt, now)}` : "Not read yet"}
                {link.lastRefreshStatus === "FAILURE" && link.lastRefreshMessage ? ` — ${link.lastRefreshMessage}` : ""}
              </span>
            </div>
            {link.items.length === 0 ? (
              <p className="px-4 py-3 text-sm text-ink-muted">{heading.empty}</p>
            ) : (
              <ul className="divide-y divide-line-row" data-tour="acc-feed-list">
                {link.items.slice(0, SHOW).map((item) => (
                  <li key={item.id} className="flex flex-col gap-1 px-4 py-2 sm:flex-row sm:items-baseline sm:justify-between">
                    <div className="flex flex-col gap-0.5">
                      <span className="text-sm text-ink">
                        <span className="mr-2 inline-flex items-center rounded-full border border-line-card px-2 py-0.5 text-[11px] font-medium uppercase tracking-wide text-ink-muted">
                          GC&rsquo;s
                        </span>
                        {item.number ? <span className="mr-1 font-medium">{item.number}</span> : null}
                        {item.title}
                      </span>
                      <span className="text-xs text-ink-muted">
                        {[
                          item.status,
                          item.revision ? `Rev ${item.revision}` : null,
                          item.discipline,
                          item.ballInCourt ? `Ball in court: ${item.ballInCourt}` : null,
                          day(item.dueDate) ? `Due ${day(item.dueDate)}` : null,
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </span>
                    </div>
                    <a
                      href={item.webUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex min-h-11 shrink-0 items-center text-sm text-link sm:min-h-0"
                    >
                      Open in ACC ↗
                    </a>
                  </li>
                ))}
                {link.items.length > SHOW && (
                  <li className="px-4 py-2 text-xs text-ink-muted">
                    And {link.items.length - SHOW} more — open the project in ACC to see them all.
                  </li>
                )}
              </ul>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
