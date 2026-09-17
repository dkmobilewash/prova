import type { ReactNode } from "react";

/**
 * The phase-code picker for a line item, and the tag that displays one.
 *
 * ⚠ NOT RENDERED ANYWHERE YET, AND THAT IS A REPORTED BLOCK RATHER THAN AN
 * OVERSIGHT. Both line-item forms — the add form and the inline row edit —
 * live inside `app/(app)/jobs/[id]/page.tsx`, which belongs to the other
 * lane (WORK-SPLIT.md) and which the branch that added this was explicitly
 * forbidden to touch. This file is the whole of what that page needs, so
 * wiring it is three edits and no new decisions:
 *
 *   1. `<PhaseCodeField phaseCodes={phaseCodeOptions} />` beside
 *      `<LaborHoursField crafts={craftOptions} />` in the add form, and
 *      `<PhaseCodeField phaseCodes={phaseCodeOptions} selectedId={item.phaseCodeId} />`
 *      beside the `craftClassificationId` select in the row edit;
 *   2. `<PhaseCodeTag phase={…} />` in the row's read-only display, next to
 *      where the craft is shown;
 *   3. `phaseCodeId` read from the form in `createLineItem` and
 *      `updateLineItem` (lib/actions/jobs.ts, also the other lane) and
 *      verified against the caller's own company before it is stored —
 *      exactly what `craftClassificationIdFromForm` in lib/actions/shared.ts
 *      already does for the craft beside it. Without that step the select
 *      posts a value nothing reads, which is worse than no select at all.
 *
 * Deliberately a SERVER component: it holds no state, and the craft picker
 * beside it is only a client component because it prices hours as they are
 * typed. There is nothing to price here.
 *
 * RETIRED CODES ARE NOT OFFERED, but a line already coded to one keeps
 * showing it and can be saved again without being silently re-coded — a
 * retired code is evidence of how work on an invoiced job was coded, and
 * an edit form that dropped it would rewrite that quietly. So the selected
 * retired code is rendered as its own option, marked.
 */

export type PhaseCodeOption = {
  id: string;
  code: string;
  name: string;
  isActive: boolean;
};

export function PhaseCodeField({
  phaseCodes,
  selectedId = null,
  className,
  labelled = true,
}: {
  phaseCodes: PhaseCodeOption[];
  selectedId?: string | null;
  className?: string;
  /** The add form stacks labelled fields; the inline row edit is a single
   * flex row of bare controls that lean on `title` instead — the craft
   * select beside this one has no visible label either. Rendering a
   * labelled field there would be the only two-line control in the row.
   *
   * One component rather than two so the option list, the retired-code
   * rule and the "Not coded to a phase" wording cannot drift apart between
   * the two places a phase is chosen. */
  labelled?: boolean;
}) {
  const offered = phaseCodes.filter(
    (phase) => phase.isActive || phase.id === selectedId,
  );

  const select = (
    <select
        name="phaseCodeId"
        defaultValue={selectedId ?? ""}
        title="Your own cost code for this line — what makes it countable against the same phase on every other job"
        className={
          className ??
          "rounded-md border border-line-card bg-surface px-3 py-2 text-ink focus:border-link focus:outline-none"
        }
      >
        {/* "Not coded" rather than a blank: uncoded is a real, common and
            reportable state, not a missing answer, and the phase-codes
            report names it in exactly these words. */}
        <option value="">Not coded to a phase</option>
        {offered.map((phase) => (
          <option key={phase.id} value={phase.id}>
            {phase.code} — {phase.name}
            {phase.isActive ? "" : " (retired)"}
          </option>
        ))}
    </select>
  );

  if (!labelled) return select;

  return (
    <label className="flex flex-col gap-1 text-sm text-ink-label">
      Phase code
      {select}
    </label>
  );
}

/** How a coded line reads in a list. Null renders nothing at all rather
 * than "none": a row is not making a claim by being uncoded, and a badge
 * on every uncoded line would shout on a page where most lines are. */
export function PhaseCodeTag({ phase }: { phase: PhaseCodeOption | null }): ReactNode {
  if (!phase) return null;
  return (
    <span
      className="rounded bg-tag-slate px-1.5 py-0.5 text-xs text-tag-slate-ink"
      title={`Phase code ${phase.code} — ${phase.name}${phase.isActive ? "" : " (retired)"}`}
    >
      {phase.code}
    </span>
  );
}
