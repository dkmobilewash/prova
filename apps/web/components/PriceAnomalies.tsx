import type { PriceAnomalyReport } from "@/lib/estimating/price-anomalies";

/**
 * LINES THAT LOOK WRONG AGAINST WHAT THE WORK HAS COST.
 *
 * A server component with no state and no action: it has nothing to press,
 * because the fix is editing the line twelve inches above it. The job here is to
 * be read in two seconds by somebody about to send a bid.
 *
 * ── IT STATES WHAT IT DID NOT CHECK ──
 *
 * The coverage line is not a footnote. Most lines are typed by hand and carry no
 * catalog entry, so they have no history to be judged against — and a panel that
 * printed only "no anomalies" would be read as "all twenty lines are fine" when
 * it had looked at six. `bid-responsiveness.ts`'s posture, in one sentence:
 * "nothing outstanding that THIS APP CAN SEE".
 *
 * ── AND IT IS SILENT WHEN IT HAS NOTHING ──
 *
 * No anomalies and nothing checked means no panel at all. An empty box on the
 * screen somebody works on every day is how a warning becomes furniture.
 */
export function PriceAnomalies({ report }: { report: PriceAnomalyReport }) {
  // Nothing found AND nothing checkable: say nothing. There is no information
  // in "we could not look at any of this".
  if (report.anomalies.length === 0 && report.checked === 0) return null;

  const typos = report.anomalies.filter((anomaly) => anomaly.kind === "TYPED_WRONG");

  return (
    <section
      // `alert` only when something was found. A region that announces itself
      // to a screen reader to say nothing is wrong is noise with extra steps.
      role={report.anomalies.length > 0 ? "alert" : undefined}
      className={
        report.anomalies.length > 0
          ? "mt-4 rounded-lg border border-tag-amber bg-tag-amber p-4"
          : "mt-4 rounded-lg border border-line-card bg-surface p-4"
      }
    >
      <h3
        className={
          report.anomalies.length > 0 ? "text-sm font-semibold text-tag-amber-ink" : "text-sm font-semibold text-ink"
        }
      >
        {report.anomalies.length === 0
          ? "Nothing looks off against your own history"
          : typos.length > 0
            ? "Check these before this goes out"
            : "Worth a look against your own history"}
      </h3>

      {report.anomalies.length > 0 && (
        <ul className="mt-2 flex flex-col gap-2">
          {report.anomalies.map((anomaly) => (
            <li
              key={`${anomaly.lineId}-${anomaly.kind}`}
              className={
                // The typo gets the weight, because it is the one that loses a
                // job. Drift is a note; a moved decimal is a stop.
                anomaly.kind === "TYPED_WRONG"
                  ? "text-sm font-medium text-tag-amber-ink"
                  : "text-sm text-tag-amber-ink"
              }
            >
              {anomaly.sentence}
            </li>
          ))}
        </ul>
      )}

      {/* THE COVERAGE LINE, always, whether anything was found or not. */}
      <p className={report.anomalies.length > 0 ? "mt-3 text-xs text-tag-amber-ink" : "mt-1 text-xs text-ink-body"}>
        {report.checked} {report.checked === 1 ? "line was" : "lines were"} checked against what that work has cost
        you.
        {report.unchecked > 0 ? (
          <>
            {" "}
            <span className="text-ink-muted">
              {report.unchecked} {report.unchecked === 1 ? "line has" : "lines have"} no history to check against —
              nothing on {report.unchecked === 1 ? "it" : "them"} has been looked at.
            </span>
          </>
        ) : null}
      </p>
    </section>
  );
}
