import {
  qualify,
  BAND_LABELS,
  type QualifyingSignal,
} from "@/lib/sales-qualification";
import { SalesSignalForm } from "@/components/SalesSignalForm";
import {
  SalesSignalRow,
  type SalesSignalRowData,
} from "@/components/SalesSignalRow";

/**
 * "What we know" — the signals, the band, and the band's REASON.
 *
 * A server component: the band is derived here, from the rows, on every read.
 * Nothing about it is stored, so a signal dismissed a second ago moves it.
 *
 * THE REASON IS THE POINT, not the band. A coloured pill saying "Too thin to
 * call" tells somebody they cannot call and not what to go and find out; the
 * reason names the missing half ("Not confirmed yet: where they work"), and on
 * a STRONG lead it IS the opening line. CLAUDE.md's rule that a status is a
 * word and a colour, taken one step further: here the word is also the next
 * action.
 */

const BAND_STYLE = {
  STRONG: "bg-tag-green text-tag-green-ink",
  WORTH_A_CALL: "bg-tag-blue text-tag-blue-ink",
  THIN: "bg-tag-slate text-tag-slate-ink",
  NOT_A_FIT: "bg-tag-rose text-tag-rose-ink",
} as const;

export function SalesLeadSignals({
  leadId,
  signals,
}: {
  leadId: string;
  signals: SalesSignalRowData[];
}) {
  const qualification = qualify(signals as readonly QualifyingSignal[]);

  /* Unreviewed research first — it is the only thing here that is somebody's
     job. Then confirmed, then dismissed, which is history. */
  const order = { PROPOSED: 0, CONFIRMED: 1, DISMISSED: 2 } as const;
  const sorted = [...signals].sort((a, b) => order[a.state] - order[b.state]);

  return (
    <section className="mt-10">
      <div className="mb-1 flex flex-wrap items-center gap-2">
        <h2 className="text-lg font-semibold text-ink">What we know</h2>
        <span
          className={`rounded px-2 py-0.5 text-xs ${BAND_STYLE[qualification.band]}`}
        >
          {BAND_LABELS[qualification.band]}
        </span>
      </div>
      <p className="mb-4 text-sm text-ink-body">{qualification.reason}</p>

      {sorted.length === 0 ? (
        /* A real empty state with a way out, per the list-page rules — and it
           says what a signal IS, because "no signals" means nothing to
           somebody opening this page for the first time. */
        <div className="rounded-lg border border-line-card bg-surface p-6">
          <p className="text-sm text-ink-body">
            Nothing yet. A signal is one thing you found out about them, with
            the page you read it on — what they do, where they work, who they
            build for, a job they are on now.
          </p>
          <p className="mt-2 text-sm text-ink-muted">
            Two of them — what they do and where they work — are what this lead
            needs before it is worth a call at all.
          </p>
          <div className="mt-4">
            <SalesSignalForm leadId={leadId} />
          </div>
        </div>
      ) : (
        <div className="rounded-lg border border-line-card bg-surface p-4">
          <ul>
            {sorted.map((signal) => (
              <SalesSignalRow key={signal.id} signal={signal} />
            ))}
          </ul>
          <div className="mt-4">
            <SalesSignalForm leadId={leadId} />
          </div>
        </div>
      )}
    </section>
  );
}
