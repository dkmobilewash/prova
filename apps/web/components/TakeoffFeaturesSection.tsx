"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { saveDemotedWallsSwitch, saveRoomFinderSwitch, setWallTypesFromDrawings } from "@/lib/actions";
import { ActionForm } from "@/components/ActionForm";
import { SubmitButton } from "@/components/SubmitButton";
import { statusText, type TakeoffFeatureRow } from "@/lib/takeoff/features";
import type { ActionResult } from "@/lib/actions/shared";

/**
 * Every takeoff switch in one list — what it does, where it stands, where it
 * lives — with an on/off button on the rows this build can switch. The
 * switches themselves stay where they are (each row links there), so nothing
 * that worked before moves. See `lib/takeoff/features.ts`.
 */
const ACTIONS: Record<string, (formData: FormData) => Promise<ActionResult>> = {
  wallTypesFromDrawings: setWallTypesFromDrawings,
  roomFinderOn: saveRoomFinderSwitch,
  demotedWallsOn: saveDemotedWallsSwitch,
};

function Pill({ row }: { row: TakeoffFeatureRow }) {
  const tone =
    row.status.kind === "on"
      ? "bg-tag-brand text-tag-brand-ink"
      : row.status.kind === "needs"
        ? "bg-tag-amber text-tag-amber-ink"
        : "bg-rail-hover text-ink-muted";
  return (
    <span data-feature-status={row.status.kind} className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${tone}`}>
      {statusText(row.status)}
    </span>
  );
}

export function TakeoffFeaturesSection({ rows, isOwner }: { rows: TakeoffFeatureRow[]; isOwner: boolean }) {
  const router = useRouter();
  return (
    <section id="takeoff-features" className="mb-10 scroll-mt-20" data-settings="takeoff-features">
      <h2 className="mb-1 text-sm font-semibold text-ink-label">Takeoff features</h2>
      <p className="mb-3 text-xs text-ink-muted">
        Every switch that changes what the takeoff does, in one place. Each one still lives where it did; the link says
        where.
      </p>
      <ul className="flex flex-col gap-3">
        {rows.map((row) => {
          const action = row.field === null ? null : ACTIONS[row.field];
          const on = row.status.kind === "on" || row.status.kind === "needs";
          return (
            <li key={row.key} data-feature={row.key} className="rounded-lg border border-line-card bg-surface p-4">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium text-ink">{row.title}</span>
                <Pill row={row} />
                <Link href={row.where.href} className="ml-auto text-xs text-link underline-offset-2 hover:underline" data-feature-where>
                  {row.where.label}
                </Link>
              </div>
              <p className="mt-1 text-xs text-ink-muted">{row.explain}</p>
              {row.status.kind === "needs" && (
                <ul data-feature-needs className="mt-2 list-disc pl-5 text-xs text-ink-body">
                  {row.status.needs.map((need) => (
                    <li key={need}>{need}</li>
                  ))}
                </ul>
              )}
              {row.status.kind === "not-yet" && (
                <p className="mt-2 text-xs text-ink-muted">Arrives with a later release; its switch will appear here and under its own section.</p>
              )}
              {action !== null && isOwner && (
                <ActionForm action={action} resetOnSuccess={false} onSuccess={() => router.refresh()} className="mt-3">
                  {/* A checkbox that is off posts nothing, which is how every switch action here reads "off". */}
                  {!on && <input type="hidden" name={row.field!} value="on" />}
                  <SubmitButton data-feature-toggle={on ? "off" : "on"}>{on ? "Turn off" : "Turn on"}</SubmitButton>
                  {row.key === "wallTypesFromDrawings" && !on && (
                    <span className="ml-3 text-xs text-ink-muted">Also turns company AI on if it is off, which this needs.</span>
                  )}
                </ActionForm>
              )}
              {action !== null && !isOwner && <p className="mt-2 text-xs text-ink-muted">Only the account owner can change this.</p>}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
