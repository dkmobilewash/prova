import Link from "next/link";
import { prisma } from "@prova/db";
import { requireCapability } from "@/lib/authz";
import { NoAccess } from "@/components/NoAccess";
import { IntakeDropZone } from "@/components/IntakeDropZone";
import { IntakeTable, type IntakeRow } from "@/components/IntakeTable";
import { countIntake, intakeSummarySentence } from "@/lib/intake/review";

/**
 * Drop a folder of a GC's paperwork in; get a table of proposals out.
 *
 * THE SHAPE OF THE SCREEN IS THE ARGUMENT IT MAKES. Three numbers, a drop
 * zone, and one row per file with the machine's reasoning written out in
 * words a person can disagree with. The uncertain rows are at the TOP —
 * `sortForReview`, applied in the table — because attention is the scarce
 * thing and a tray of eighty is worth having only if the four that need a
 * human are the four you land on.
 *
 * NOTHING IS FILED UNTIL A PERSON CONFIRMS, including a HIGH-confidence
 * proposal, and an UNKNOWN cannot be filed at all. The counts say "ready to
 * file", never "filed automatically", and the column is headed "Filed as"
 * rather than "Added to your submittals" — because this pass records the
 * accepted kind and job ON THE INTAKE ROW and creates no Submittal, Rfi or
 * ComplianceDocument. Routing each kind into its destination model is the
 * next change and carries per-model identity rules (a submittal number comes
 * from a counter; an RFI's fields lock on creation) that a filename is not
 * evidence for. Every word on this page is chosen so the demo and the
 * product are the same claim.
 *
 * MANAGE_JOBS, recorded in ROUTE_CAPABILITY and enforced HERE. The nav
 * filtering is cosmetic; this line is the boundary, and each of the three
 * actions behind the screen repeats it because an action is its own
 * endpoint.
 */

/**
 * How much of the tray one page renders.
 *
 * A drop is capped at 120 files and the tray is meant to be emptied, so this
 * is comfortably more than a working session — but it is a cap rather than
 * an unbounded read, because `/photos` shipped without one and a year of
 * rows arrived on a phone. The line under the table says what is being held
 * back, so a number on screen never disagrees with the rows beneath it.
 */
const TRAY_LIMIT = 200;

export default async function IntakePage() {
  const { context, allowed } = await requireCapability("MANAGE_JOBS");
  if (!allowed) return <NoAccess capability="MANAGE_JOBS" />;
  const { company } = context;

  const [jobs, tray, trayTotal, filed, dismissed] = await Promise.all([
    prisma.job.findMany({
      where: { companyId: company.id },
      orderBy: { createdAt: "desc" },
      select: { id: true, name: true },
    }),
    prisma.documentIntake.findMany({
      where: { companyId: company.id, status: "PROPOSED" },
      // Newest first is only the READ order — which rows are on this page.
      // Which row a person sees FIRST is decided by `sortForReview` in the
      // table, from kind and confidence together. Two different questions,
      // and conflating them is how the uncertain rows end up at the bottom.
      orderBy: { createdAt: "desc" },
      take: TRAY_LIMIT,
      select: {
        id: true,
        fileName: true,
        byteSize: true,
        blobUrl: true,
        proposedKind: true,
        proposedConfidence: true,
        proposedReason: true,
        revisionHint: true,
        jobHint: true,
        jobId: true,
        status: true,
      },
    }),
    prisma.documentIntake.count({ where: { companyId: company.id, status: "PROPOSED" } }),
    prisma.documentIntake.count({ where: { companyId: company.id, status: "FILED" } }),
    prisma.documentIntake.count({ where: { companyId: company.id, status: "DISMISSED" } }),
  ]);

  const rows: IntakeRow[] = tray;

  // The three tray numbers are counted over the rows actually on this page,
  // and `filed`/`dismissed` come from their own queries rather than from
  // this list — those rows are not in it by definition. A summary that
  // counted a filed row it had not loaded would be a number nothing on
  // screen could explain.
  const counts = {
    ...countIntake(rows),
    filed,
    dismissed,
  };
  const withheld = trayTotal - rows.length;

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <h1 className="mb-2 text-2xl font-semibold text-ink">Document intake</h1>
      <p className="mb-6 max-w-3xl text-sm text-ink-body">
        Drop in everything a GC has sent you and we will tell you what each file looks like and
        where it should go. We read the filename and the first page; we do not file anything —
        you confirm every row, and you can overrule any answer on the row itself.
      </p>

      <section className="mb-8">
        <IntakeDropZone companyId={company.id} />
      </section>

      {/* THE THREE NUMBERS, above the table they describe. "Ready to file"
          rather than "filed automatically": nothing here has been filed, and
          a headline claiming otherwise above a table of rows that have not
          been is the copy that survives a demo and not a customer. */}
      <section className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-lg font-semibold text-ink">{intakeSummarySentence(counts)}</p>
          <p className="mt-0.5 text-xs text-ink-muted">
            Nothing is filed until you confirm it. The ones we are least sure about are at the
            top.
          </p>
        </div>
        {(counts.filed > 0 || counts.dismissed > 0) && (
          <p className="text-xs text-ink-muted">
            {counts.filed} filed so far
            {counts.dismissed > 0 ? `, ${counts.dismissed} dismissed` : ""}.
          </p>
        )}
      </section>

      {rows.length === 0 ? (
        /* A real empty state with a way out, not a shrug. The two links are
           where the paperwork this tray is full of ends up being read. */
        <div className="rounded-lg border border-line-card bg-surface p-8 text-center">
          <p className="text-base font-medium text-ink">Nothing waiting for you</p>
          <p className="mx-auto mt-1 max-w-md text-sm text-ink-body">
            {counts.filed > 0 || counts.dismissed > 0
              ? "The tray is empty — everything dropped in so far has been dealt with."
              : "Drop a folder above and every file in it gets a row here, with a proposal you can accept or change."}
          </p>
          <div className="mt-4 flex flex-wrap items-center justify-center gap-4 text-sm">
            <Link href="/submittals" className="text-ink-label underline underline-offset-2">
              Submittals
            </Link>
            <Link href="/rfis" className="text-ink-label underline underline-offset-2">
              RFIs
            </Link>
            <Link href="/compliance" className="text-ink-label underline underline-offset-2">
              Compliance documents
            </Link>
          </div>
        </div>
      ) : (
        <>
          <IntakeTable rows={rows} jobs={jobs} />
          {withheld > 0 && (
            <p className="mt-3 text-xs text-ink-muted">
              Showing the {rows.length} most recent of {trayTotal} waiting. Confirm or dismiss
              these and the rest will appear.
            </p>
          )}
          {/* Said once, plainly, under the table it applies to. The column is
              headed "Filed as" for the same reason. */}
          <p className="mt-3 max-w-3xl text-xs text-ink-muted">
            Confirming records what each document is and which job it belongs to, here in the
            intake record. It does not yet create a submittal, an RFI or a compliance record —
            those have their own numbering and dates that somebody has to enter, and we are not
            going to guess them from a filename.
          </p>
        </>
      )}
    </div>
  );
}
