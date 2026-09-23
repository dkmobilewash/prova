import { EXPORT_DATASETS, EXPORT_OMISSIONS, EXPORT_WITHHELD } from "@/lib/export";

/**
 * The two bits of copy on `/settings/export` that make a claim about
 * coverage, pulled out of the page so they can actually be rendered in a
 * test.
 *
 * THE COUNT IS READ FROM `EXPORT_DATASETS` AT RENDER, not typed here. That
 * is the whole point of this file existing: the old page said "Everything"
 * and "Download everything", which cannot rot because it never said a
 * number — it was just wrong from the day the second table was added.
 * Replacing it with a typed "18" would be the other failure this codebase
 * keeps meeting, a count that decorates a claim and outlives it. So the
 * sentence counts the registry, and `export-coverage.test.ts` renders this
 * component with a fake dataset pushed onto that registry and insists the
 * rendered number follows.
 *
 * The page stays a server component and passes nothing but the company
 * name — if it passed the count in, the page could hardcode it and this
 * test would be looking the other way.
 */

/** The heading and the sentence under it. Says what the file is and, in the
 * same breath, that it is not everything. */
export function ExportCoverageIntro({ companyName }: { companyName: string }) {
  const tables = EXPORT_DATASETS.length;
  return (
    <>
      <h1 className="mb-2 text-xl font-semibold text-ink">Export core records</h1>
      <p className="mb-6 text-sm text-ink-body">
        The {tables} tables {companyName} works from day to day — jobs, money, hours and the
        correspondence that backs them — on demand, in a format you can open or load somewhere
        else. No request, no waiting, and it stays available whether or not you keep paying us.
        It is not the whole account: what it leaves out is named at the bottom of this page.
      </p>
    </>
  );
}

/** The label on the everything-as-one-file button. Counts tables and rows,
 * because "everything" was the part that was not true. */
export function exportAllLabel(totalRows: number): string {
  const tables = EXPORT_DATASETS.length;
  return `Download all ${tables} tables (${totalRows.toLocaleString()} rows)`;
}

/**
 * What is not in the file, in two groups, because the two groups have
 * different futures: the first is withheld on purpose and always will be,
 * the second is simply not built yet and the honest thing is to say so
 * rather than let a person discover it after they have cancelled.
 */
export function ExportOmissionsPanel() {
  return (
    <section className="mb-8 rounded-lg border border-line-row bg-canvas p-4">
      <h2 className="mb-2 text-sm font-semibold text-ink-label">What is not in it</h2>

      <h3 className="mb-1 mt-3 text-xs font-semibold uppercase tracking-wide text-ink-muted">
        Held back on purpose
      </h3>
      <ul className="flex flex-col gap-2 text-xs text-ink-muted">
        {EXPORT_WITHHELD.map((item) => (
          <li key={item.key}>
            <span className="text-ink-body">{item.title}.</span> {item.detail}
          </li>
        ))}
      </ul>

      <h3 className="mb-1 mt-4 text-xs font-semibold uppercase tracking-wide text-ink-muted">
        Not covered by this export yet
      </h3>
      <p className="mb-2 text-xs text-ink-muted">
        These are records you put in, and they are not in the file. They are still in the app,
        and you can ask us for any of them.
      </p>
      <ul className="flex flex-col gap-2 text-xs text-ink-muted">
        {EXPORT_OMISSIONS.map((item) => (
          <li key={item.key}>
            <span className="text-ink-body">{item.title}.</span> {item.detail}
          </li>
        ))}
      </ul>

      <p className="mt-4 text-xs text-ink-muted">
        Sequence counters, integration connections and sync logs, notification records, AI
        usage and the shared licence-classification table are not listed above and are not in
        the file either. That is bookkeeping the app does for itself, not work
        anybody put in.
      </p>
    </section>
  );
}
