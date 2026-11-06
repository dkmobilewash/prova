import type { GcProposal } from "@/lib/estimating/gc-proposal";
import { feetLabel } from "@/lib/takeoff/wallHeight";

/**
 * The scope by wall type, the clauses and the terms, as the GC reads them on
 * the signing link (`app/esign/[token]`) and as the proposal prints. Pure
 * rendering of `GcProposal`, so a signed snapshot renders exactly as the live
 * page did. `showClauses` is off on the job's own proposal page, which lists
 * the clauses with their edit controls.
 */
export function GcProposalSections({ proposal, showClauses = true }: { proposal: GcProposal; showClauses?: boolean }) {
  const { scope, clauses, terms } = proposal;
  const termLines = [
    terms.paymentTermsDays !== null ? `Payment: net ${terms.paymentTermsDays} days.` : null,
    terms.retainagePercent !== null ? `Retainage: ${Number(terms.retainagePercent)}%.` : null,
  ].filter((line): line is string => line !== null);
  return (
    <div className="mt-6 flex flex-col gap-6">
      {scope.length > 0 && (
        <section data-proposal="scope">
          <h2 className="mb-2 text-lg font-semibold text-ink print:text-black">Scope by wall type</h2>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line-card text-left text-ink-label">
                <th className="py-2">Wall type</th>
                <th className="py-2 text-right">Height</th>
                <th className="py-2 text-right">Linear feet</th>
                <th className="py-2 text-right">Square feet</th>
              </tr>
            </thead>
            <tbody>
              {scope.map((row) => (
                <tr key={row.code ?? "untyped"} className="border-b border-line-card" data-proposal="scope-row">
                  <td className="py-2 pr-2 text-ink">
                    {row.code !== null && <span className="font-semibold">{row.code} · </span>}
                    {row.name}
                  </td>
                  <td className="py-2 text-right tabular-nums text-ink-body">{row.heightFt !== null ? feetLabel(row.heightFt) : "—"}</td>
                  <td className="py-2 text-right tabular-nums text-ink">{row.linearFt.toLocaleString()} LF</td>
                  <td className="py-2 text-right tabular-nums text-ink">{row.squareFeet !== null ? `${row.squareFeet.toLocaleString()} SF` : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-1 text-xs text-ink-muted">Measured from the drawings. Square feet count both faces unless the type is one-sided.</p>
        </section>
      )}

      {showClauses &&
        clauses.map((group) => (
          <section key={group.kind} data-proposal={`clauses-${group.kind.toLowerCase()}`}>
            <h2 className="mb-2 text-lg font-semibold text-ink print:text-black">{group.heading}</h2>
            <ul className="list-disc pl-5 text-sm text-ink">
              {group.texts.map((text, i) => (
                <li key={i}>{text}</li>
              ))}
            </ul>
          </section>
        ))}

      {termLines.length > 0 && (
        <section data-proposal="terms">
          <h2 className="mb-2 text-lg font-semibold text-ink print:text-black">Terms</h2>
          <ul className="flex flex-col gap-1 text-sm text-ink">
            {termLines.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
