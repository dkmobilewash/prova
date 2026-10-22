"use client";

import { useState, useTransition } from "react";
import { createWallType } from "@/lib/actions";
import type { PlanTextView } from "@/lib/actions/planTextRead";
import type { WallLegendProposal } from "@/lib/takeoff/readWallLegend";
import { feetInches } from "@/lib/takeoff/planTextView";
import { sameDesignation } from "@/lib/takeoff/wallTypeMatch";

/**
 * ── WHAT PLAN-TEXT READING PUTS ON THE TAKEOFF SCREEN ──
 *
 * Three things, under the found-walls panel, all from `loadPlanText` and
 * none of them a price:
 *
 *   1. where the sheet's typed feet came from — tagged on the drawing,
 *      carried along the wall from a tag, a general note, or nothing — so the
 *      untyped share is a number rather than a silence;
 *   2. the doors the schedule names on this sheet, with the schedule's own
 *      width, and the rows the sheet did not place, which is the list an
 *      estimator checks by hand;
 *   3. the wall types the set's legend defines, as quantity-only assemblies
 *      with every flag the parser raised, each with an Add button that creates
 *      the company's wall type through the existing action.
 *
 * Renders nothing when the switch is off or nothing has been read, which is
 * the only honest rendering of either.
 */
export function PlanTextPanel({
  view,
  wallTypes,
}: {
  view: PlanTextView | null;
  wallTypes: readonly { code: string }[];
}) {
  if (view === null || (view.sheet === null && view.legend === null)) return null;
  const sheet = view.sheet;
  const typed = sheet?.typed ?? null;
  const total = typed === null ? 0 : typed.taggedFeet + typed.propagatedFeet + typed.noteFeet + typed.untypedFeet;
  const ft = (n: number) => `${Math.round(n).toLocaleString()} ft`;
  return (
    <section className="mt-3 flex flex-col gap-3 border-t border-line-card pt-3" data-takeoff="plan-text">
      {typed !== null && total > 0 && (
        <p className="text-xs text-ink-body" data-takeoff="plan-text-typed">
          <span className="font-semibold text-ink">Where the types came from:</span> tagged on the drawing {ft(typed.taggedFeet)}
          {typed.propagatedFeet > 0 && <> · same wall as a tag {ft(typed.propagatedFeet)}</>}
          {typed.noteFeet > 0 && <> · by general note {ft(typed.noteFeet)}</>}
          <> · </>
          <span className={typed.untypedFeet > 0 ? "font-semibold text-ink" : ""}>untyped {ft(typed.untypedFeet)}</span>
          {sheet?.legend && <span className="text-ink-muted"> — legend read from page {sheet.legend.page}</span>}
        </p>
      )}
      {sheet?.doors && (
        <div className="text-xs text-ink-body" data-takeoff="plan-text-doors">
          <span className="font-semibold text-ink">Doors from the schedule (page {sheet.doors.schedulePage}):</span>{" "}
          {sheet.doors.placed.length === 0
            ? "none placed on this sheet"
            : sheet.doors.placed
                .map((d) => `${d.mark} ${feetInches(d.widthFt)}${d.widthFrom === "drawn" ? " (drawn)" : ""}`)
                .join(", ")}
          {sheet.doors.unplaced.length > 0 && (
            <p className="mt-1" data-takeoff="plan-text-unplaced">
              <span className="font-semibold text-ink">Scheduled, not found on this sheet:</span> {sheet.doors.unplaced.join(", ")}
            </p>
          )}
        </div>
      )}
      {view.legend && view.legend.proposals.length > 0 && (
        <div data-takeoff="plan-text-legend">
          <p className="text-xs text-ink-body">
            <span className="font-semibold text-ink">
              The drawings define {view.legend.proposals.length} wall type{view.legend.proposals.length === 1 ? "" : "s"}
            </span>{" "}
            (page {view.legend.page}, read at {view.legend.confidence} confidence). Quantities only — add the ones you bid.
          </p>
          <ul className="mt-1 flex flex-col gap-1">
            {view.legend.proposals.map((proposal) => (
              <LegendRow
                key={proposal.code}
                proposal={proposal}
                inLibrary={wallTypes.some((type) => sameDesignation(type.code, proposal.code))}
              />
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

function LegendRow({ proposal, inLibrary }: { proposal: WallLegendProposal; inLibrary: boolean }) {
  const [isPending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const parts = proposal.assembly.components.map((c) => c.description).join("; ");
  const flags = proposal.assembly.flags;
  return (
    <li className="flex flex-wrap items-baseline gap-2 rounded-md px-2 py-1 text-xs" data-takeoff="plan-text-legend-row" data-code={proposal.code}>
      <span className="rounded bg-tag-slate px-1.5 py-0.5 font-medium text-tag-slate-ink">{proposal.code}</span>
      <span className="text-ink-body">{parts === "" ? "no assembly could be read from its words" : parts}</span>
      {flags.map((flag) => (
        <span key={flag.why} className="text-danger" title={flag.phrase}>
          {flag.why}
        </span>
      ))}
      {inLibrary ? (
        <span className="ml-auto text-ink-muted">in your wall types</span>
      ) : message !== null ? (
        <span className="ml-auto text-ink-muted">{message}</span>
      ) : (
        <button
          type="button"
          disabled={isPending}
          className="ml-auto min-h-[36px] rounded-md border border-line-card px-3 font-medium text-ink-body hover:bg-rail-hover disabled:opacity-60"
          onClick={() =>
            startTransition(async () => {
              const form = new FormData();
              form.set("code", proposal.code);
              form.set("name", proposal.name ?? (parts === "" ? proposal.lines.join(" ").slice(0, 120) : parts.slice(0, 120)));
              // Two sides unless the parser flagged one-sided board; the flag is on screen either way.
              form.set("sides", flags.some((f) => f.why.startsWith("the board is on one side only")) ? "1" : "2");
              form.set("studSpacingIn", String(proposal.assembly.read.studSpacingIn ?? 16));
              form.set("notes", proposal.lines.join("\n"));
              const result = await createWallType(form);
              setMessage(result.ok ? "added" : result.error);
            })
          }
        >
          {isPending ? "Adding…" : "Add to your wall types"}
        </button>
      )}
    </li>
  );
}
