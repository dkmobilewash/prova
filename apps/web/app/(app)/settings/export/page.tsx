import Link from "next/link";
import { prisma } from "@prova/db";
import { requireCompanyContext } from "@/lib/auth";
import { EXPORT_DATASETS } from "@/lib/export";

/**
 * The page that exists so nobody ever has to ask for their data.
 *
 * It shows the row count next to every table BEFORE anything is downloaded,
 * because "here is a file, trust us" is the thing the incumbents do. A
 * count a person can check against what they see on screen is the whole
 * difference between an export and a promise of one.
 *
 * It also says what is NOT in the file. An export that quietly omits
 * something is worse than one that admits a gap, and the omissions here are
 * deliberate: connection tokens and portal links are live keys rather than
 * records, and copying them into a spreadsheet is how a key leaks.
 */

export const dynamic = "force-dynamic";

type Delegate = { count: (args: unknown) => Promise<number> };

export default async function ExportPage() {
  const context = await requireCompanyContext();
  const { company } = context;

  if (context.role !== "OWNER") {
    return (
      <div className="mx-auto max-w-3xl px-6 py-8">
        <h1 className="mb-2 text-xl font-semibold text-ink">Export your data</h1>
        <p className="text-sm text-ink-body">
          Only the account owner can export company data. One file holding every job, every
          price and every employee&rsquo;s hours is a different thing from any single page.
        </p>
      </div>
    );
  }

  // Counted rather than estimated, and counted with the same scope the
  // export itself uses — so a number here that disagrees with the file
  // would be a bug in one shared place rather than in two.
  const counts = await Promise.all(
    EXPORT_DATASETS.map(async (dataset) => {
      const delegate = (prisma as unknown as Record<string, Delegate>)[dataset.model];
      return delegate.count({ where: dataset.scope(company.id) });
    }),
  );
  const total = counts.reduce((sum, n) => sum + n, 0);

  return (
    <div className="mx-auto max-w-3xl px-6 py-8">
      <h1 className="mb-2 text-xl font-semibold text-ink">Export your data</h1>
      <p className="mb-6 text-sm text-ink-body">
        Everything {company.name} has put into C Stream, on demand, in a format you can open or
        load somewhere else. No request, no waiting, and it stays available whether or not
        you keep paying us.
      </p>

      <section className="mb-8 rounded-lg border border-line-card bg-surface p-4">
        <h2 className="mb-1 text-sm font-semibold text-ink-label">Everything, as one file</h2>
        <p className="mb-3 text-xs text-ink-muted">
          JSON, every table below, exactly as stored. This is the copy to hand to another
          system — the CSVs are for reading, this one is for moving.
        </p>
        <a
          href="/api/export"
          className="inline-flex items-center rounded-md bg-brand px-4 py-2 text-sm font-semibold text-neutral-900 hover:bg-yellow-500"
        >
          Download everything ({total.toLocaleString()} rows)
        </a>
      </section>

      <h2 className="mb-1 text-sm font-semibold text-ink-label">Or one table at a time</h2>
      <p className="mb-3 text-xs text-ink-muted">
        CSV, opens in Excel or Sheets. A value starting with <code>=</code>, <code>+</code>,{" "}
        <code>-</code> or <code>@</code> gets an apostrophe in front of it so a spreadsheet
        shows it instead of running it — which means the CSV is not a character-for-character
        copy. The JSON above is.
      </p>

      <ul className="mb-8 divide-y divide-line-row rounded-lg border border-line-card bg-surface">
        {EXPORT_DATASETS.map((dataset, i) => (
          <li key={dataset.key} className="flex items-start justify-between gap-4 p-4">
            <div>
              <p className="text-sm text-ink-label">
                {dataset.label}{" "}
                <span className="tabular-nums text-ink-muted">
                  · {counts[i].toLocaleString()} {counts[i] === 1 ? "row" : "rows"}
                </span>
              </p>
              <p className="mt-1 text-xs text-ink-muted">{dataset.note}</p>
            </div>
            {counts[i] === 0 ? (
              // Still downloadable — an empty table is a fact, and the file
              // carries its header row saying so. Just not dressed up as a
              // button with something behind it.
              <a
                href={`/api/export?dataset=${dataset.key}`}
                className="shrink-0 text-xs text-ink-muted hover:text-ink-label"
              >
                Empty
              </a>
            ) : (
              <a
                href={`/api/export?dataset=${dataset.key}`}
                className="shrink-0 rounded-md border border-line-card px-3 py-1.5 text-xs text-ink-label hover:bg-neutral-800"
              >
                CSV
              </a>
            )}
          </li>
        ))}
      </ul>

      <section className="mb-8 rounded-lg border border-line-row bg-canvas p-4">
        <h2 className="mb-2 text-sm font-semibold text-ink-label">What is deliberately not in it</h2>
        <ul className="flex flex-col gap-2 text-xs text-ink-muted">
          <li>
            <span className="text-ink-body">Integration credentials.</span> QuickBooks and
            other connection tokens. They are keys to another system, not a record of your
            work, and a copy in a downloaded file is a copy that can leak.
          </li>
          <li>
            <span className="text-ink-body">Client portal and signing links.</span> Same
            reason — anyone holding one can open a portal or sign a contract.
          </li>
          <li>
            <span className="text-ink-body">Uploaded files themselves.</span> Documents
            appear as their metadata rows here; the files are still in storage.
          </li>
        </ul>
      </section>

      <p className="text-sm text-ink-body">
        <Link href="/settings" className="text-link hover:text-link-hover">
          Back to settings
        </Link>
      </p>
    </div>
  );
}
