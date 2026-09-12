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
        <h1 className="mb-2 text-xl font-semibold text-slate-100">Export your data</h1>
        <p className="text-sm text-slate-400">
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
      <h1 className="mb-2 text-xl font-semibold text-slate-100">Export your data</h1>
      <p className="mb-6 text-sm text-slate-400">
        Everything {company.name} has put into Prova, on demand, in a format you can open or
        load somewhere else. No request, no waiting, and it stays available whether or not
        you keep paying us.
      </p>

      <section className="mb-8 rounded-lg border border-slate-800 bg-slate-900 p-4">
        <h2 className="mb-1 text-sm font-semibold text-slate-300">Everything, as one file</h2>
        <p className="mb-3 text-xs text-slate-500">
          JSON, every table below, exactly as stored. This is the copy to hand to another
          system — the CSVs are for reading, this one is for moving.
        </p>
        <a
          href="/api/export"
          className="inline-flex items-center rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500"
        >
          Download everything ({total.toLocaleString()} rows)
        </a>
      </section>

      {/* A REPORT, not a table dump, and said so plainly — everything else on
          this page is one model's rows exactly as stored. It is linked from
          here because this is where a person looks for "get my data out", and
          it lives on /cash-flow because that is where the company's money is
          read. Its gate is capability-based rather than owner-only (see
          app/api/export/wip-schedule/route.ts); an owner holds both
          capabilities, so this button always works for whoever is reading
          this page. */}
      <section className="mb-8 rounded-lg border border-slate-800 bg-slate-900 p-4">
        <h2 className="mb-1 text-sm font-semibold text-slate-300">WIP schedule</h2>
        <p className="mb-3 text-xs text-slate-500">
          Not a table — a report. One row per contracted and in-progress job in the
          percentage-of-completion format a surety underwriter and a CPA ask for: contract value
          with its approved change orders, cost to date, cost to complete, percent complete, earned
          revenue, and the over/under-billing pair. Readable on screen first on{" "}
          <Link href="/cash-flow" className="text-blue-400 hover:text-blue-300">
            Cash flow
          </Link>
          , with the same numbers.
        </p>
        <a
          href="/api/export/wip-schedule"
          className="inline-flex items-center rounded-md border border-slate-700 px-3 py-1.5 text-xs text-slate-300 hover:border-slate-500"
        >
          Download WIP schedule CSV
        </a>
      </section>

      <h2 className="mb-1 text-sm font-semibold text-slate-300">Or one table at a time</h2>
      <p className="mb-3 text-xs text-slate-500">
        CSV, opens in Excel or Sheets. A value starting with <code>=</code>, <code>+</code>,{" "}
        <code>-</code> or <code>@</code> gets an apostrophe in front of it so a spreadsheet
        shows it instead of running it — which means the CSV is not a character-for-character
        copy. The JSON above is.
      </p>

      <ul className="mb-8 divide-y divide-slate-800 rounded-lg border border-slate-800 bg-slate-900">
        {EXPORT_DATASETS.map((dataset, i) => (
          <li key={dataset.key} className="flex items-start justify-between gap-4 p-4">
            <div>
              <p className="text-sm text-slate-200">
                {dataset.label}{" "}
                <span className="tabular-nums text-slate-500">
                  · {counts[i].toLocaleString()} {counts[i] === 1 ? "row" : "rows"}
                </span>
              </p>
              <p className="mt-1 text-xs text-slate-500">{dataset.note}</p>
            </div>
            {counts[i] === 0 ? (
              // Still downloadable — an empty table is a fact, and the file
              // carries its header row saying so. Just not dressed up as a
              // button with something behind it.
              <a
                href={`/api/export?dataset=${dataset.key}`}
                className="shrink-0 text-xs text-slate-500 hover:text-slate-300"
              >
                Empty
              </a>
            ) : (
              <a
                href={`/api/export?dataset=${dataset.key}`}
                className="shrink-0 rounded-md border border-slate-700 px-3 py-1.5 text-xs text-slate-300 hover:border-slate-500"
              >
                CSV
              </a>
            )}
          </li>
        ))}
      </ul>

      <section className="mb-8 rounded-lg border border-slate-800 bg-slate-950 p-4">
        <h2 className="mb-2 text-sm font-semibold text-slate-300">What is deliberately not in it</h2>
        <ul className="flex flex-col gap-2 text-xs text-slate-500">
          <li>
            <span className="text-slate-400">Integration credentials.</span> QuickBooks and
            other connection tokens. They are keys to another system, not a record of your
            work, and a copy in a downloaded file is a copy that can leak.
          </li>
          <li>
            <span className="text-slate-400">Client portal and signing links.</span> Same
            reason — anyone holding one can open a portal or sign a contract.
          </li>
          <li>
            <span className="text-slate-400">Uploaded files themselves.</span> Documents
            appear as their metadata rows here; the files are still in storage.
          </li>
        </ul>
      </section>

      <p className="text-sm text-slate-400">
        <Link href="/settings" className="text-blue-400 hover:text-blue-300">
          Back to settings
        </Link>
      </p>
    </div>
  );
}
