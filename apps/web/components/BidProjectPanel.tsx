"use client";

import { useState } from "react";
import Link from "next/link";

import { ActionForm } from "@/components/ActionForm";
import { SubmitButton } from "@/components/SubmitButton";
import {
  mergeIntoProject,
  recordPrimeAward,
  saveBidProject,
  saveGcPriceAdjustment,
  splitFromProject,
  startEstimateFromProject,
} from "@/lib/actions";
import { money } from "@/lib/money";
import type { ProjectPanelView } from "@/lib/bid-project-view";
import { surfaceHrefs, type Surface } from "@/lib/bid/surfaceHrefs";

const field =
  "rounded-md border border-line-card bg-canvas px-3 py-2 text-base text-ink placeholder:text-ink-muted focus:border-link focus:outline-none sm:text-sm";
const quiet =
  "inline-flex min-h-11 items-center rounded-md border border-line-card px-3 py-1 text-sm text-ink-label hover:bg-rail-hover mouse:min-h-9";
const primary =
  "inline-flex min-h-11 items-center justify-center rounded-md bg-brand px-4 py-2 text-sm font-semibold text-neutral-900 hover:bg-brand-hover mouse:min-h-9";

const STATUS_WORD: Record<string, string> = {
  INVITED: "invited",
  SUBMITTED: "submitted",
  WON: "won",
  LOST: "lost",
  DECLINED: "declined",
};

/**
 * One piece of work, many GC invitations, one estimate — on an invitation's row.
 *
 * Always visible: which other GCs are on the same job, the single estimate
 * they share, and — when the prime contract went to a different GC — that
 * THIS invitation "didn't get the job" (said neutrally: it is not a loss, and
 * it is not counted against the GC). Everything that changes something sits
 * behind "Project", and the two moves that can't be taken back with one click
 * (folding two jobs into one, splitting one out) are two-step.
 *
 * Nothing here decides that two invitations are the same job. A person picks.
 *
 * `surface` chooses where the estimate and per-GC proposal links go (CRM: the
 * job and its proposal; Bid: the estimate and ITS proposal) and where "Start
 * the estimate" lands. The default is the CRM, whose markup is unchanged.
 */
export function BidProjectPanel({
  view,
  projectChoices,
  gcs,
  surface = "crm",
}: {
  view: ProjectPanelView;
  projectChoices: { id: string; label: string }[];
  gcs: { id: string; name: string }[];
  surface?: Surface;
}) {
  const hrefs = surfaceHrefs(surface, view.estimate?.jobId ?? "");
  const [merging, setMerging] = useState<string | null>(null);
  const [splitting, setSplitting] = useState(false);
  const others = view.gcs.filter((gc) => !gc.isThis);
  const choices = projectChoices.filter((choice) => choice.id !== view.projectId);
  const mergeTarget = choices.find((choice) => choice.id === merging) ?? null;

  return (
    <div className="mt-2 text-sm text-ink-body" data-bids="project-panel">
      {others.length > 0 && (
        <p data-bids="project-gcs">
          <span className="font-medium text-ink-label">Same job, {view.gcs.length} GCs:</span>{" "}
          {view.gcs.map((gc, index) => (
            <span key={gc.invitationId}>
              {index > 0 && ", "}
              <span className={gc.isThis ? "font-medium text-ink" : ""}>{gc.name}</span>{" "}
              <span className="text-ink-muted">({STATUS_WORD[gc.status] ?? gc.status.toLowerCase()})</span>
            </span>
          ))}
        </p>
      )}
      {view.estimate && (
        <p data-bids="project-estimate">
          <span className="font-medium text-ink-label">Estimate:</span>{" "}
          <Link href={hrefs.job} className="text-link hover:underline">
            {view.estimate.name}
          </Link>
          {others.length > 0 && <span className="text-ink-muted"> — one estimate prices to every GC above</span>}
        </p>
      )}
      {view.priceSentence && (
        <p className="text-ink-muted" data-bids="project-price">
          {view.priceSentence}
        </p>
      )}
      {/* ── ONE ESTIMATE, EACH GC'S PRICE OFF IT ──
          The estimate total beside what every GC is quoted. Derived on every
          render from the estimate and each invitation's own adjustment; the
          price is not a stored column. "Sent" is a different fact (what a person
          recorded as actually sent) and sits beside it, never in place of it. */}
      {view.estimate && view.estimateTotal !== null && (
        <div className="mt-1" data-bids="gc-prices">
          <p>
            <span className="font-medium text-ink-label">Estimate total:</span>{" "}
            <span className="tabular-nums text-ink" data-bids="estimate-total">
              {money(view.estimateTotal)}
            </span>
          </p>
          {/* A LIST, NOT A TABLE. Five table columns cannot shrink below
              their content, and at 375px they pushed the whole bid log 27px
              past the edge of the phone (measured in Chromium against the
              app's own CSS; `bid-bids.spec.ts` step 5). Each GC is one row
              that wraps: who and why on the left, the price, what was sent
              and its proposal on the right. */}
          <ul className="mt-1 text-sm">
            {view.prices.map((row) => (
              <li
                key={row.invitationId}
                className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 border-t border-line-row py-1"
                data-bids="gc-price-row"
              >
                <span className="min-w-0 break-words">
                  <span className={row.isThis ? "font-medium text-ink" : ""}>{row.name}</span>{" "}
                  <span className="text-ink-muted">
                    · {row.adjustment ?? "no adjustment"}
                    {row.reason && <> — {row.reason}</>}
                  </span>
                </span>
                <span className="flex flex-wrap items-baseline gap-x-3">
                  <span className="text-xs text-ink-muted">Price to GC</span>
                  <span className="tabular-nums text-ink" data-bids="gc-price">
                    {row.price ?? (
                      <span className="text-tag-amber-ink" title={row.problem ?? undefined}>
                        check adjustment
                      </span>
                    )}
                  </span>
                  <span className="tabular-nums text-ink-muted">Sent {row.sent ?? "—"}</span>
                  <Link
                    href={`${hrefs.proposal}?invitation=${encodeURIComponent(row.invitationId)}`}
                    className="inline-flex min-h-11 items-center text-link hover:underline mouse:min-h-0"
                  >
                    Proposal
                  </Link>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {view.primeAwarded && (
        <p data-bids="project-prime">
          <span className="font-medium text-ink-label">Prime contract:</span> awarded to {view.primeAwarded.name}
          {view.primeAwarded.on && <> on {view.primeAwarded.on}</>}
          {view.didntGetTheJob && (
            <>
              {" "}
              <span
                className="ml-1 inline-flex items-center rounded-full bg-rail-hover px-2 py-0.5 text-xs font-medium text-ink-label"
                data-bids="didnt-get-the-job"
              >
                {view.didntGetTheJobLabel}
              </span>
            </>
          )}
        </p>
      )}

      <details className="mt-1" data-bids="project-controls">
        <summary className="inline-flex min-h-11 cursor-pointer items-center text-sm font-medium text-link hover:underline mouse:min-h-9">
          Project: {view.projectName}
        </summary>
        <div className="mt-2 space-y-4 rounded-lg border border-line-row bg-surface p-3">
          {/* ── what we call the job and where it is ── */}
          <ActionForm
            action={saveBidProject.bind(null, view.projectId)}
            resetOnSuccess={false}
            className="flex flex-wrap items-end gap-3"
          >
            <label className="flex flex-col gap-1 text-sm text-ink-label">
              Project name
              <input name="name" required defaultValue={view.projectName} autoComplete="off" className={field} />
            </label>
            <label className="flex flex-col gap-1 text-sm text-ink-label">
              Address
              <input name="siteAddress" defaultValue={view.siteAddress} autoComplete="off" placeholder="Street address" className={field} />
            </label>
            <label className="flex flex-col gap-1 text-sm text-ink-label">
              City
              <input name="siteCity" defaultValue={view.siteCity} autoComplete="off" className={field} />
            </label>
            <label className="flex flex-col gap-1 text-sm text-ink-label">
              Owner
              <input name="owner" defaultValue={view.owner} autoComplete="off" className={field} />
            </label>
            <label className="flex flex-col gap-1 text-sm text-ink-label">
              Architect
              <input name="architect" defaultValue={view.architect} autoComplete="off" className={field} />
            </label>
            <label className="flex flex-col gap-1 text-sm text-ink-label">
              Bid date
              <input name="bidDueDate" type="date" defaultValue={view.bidDueDate} className={field} />
            </label>
            <SubmitButton type="submit" className={quiet}>
              Save project
            </SubmitButton>
          </ActionForm>

          {/* ── what THIS GC is quoted, off the one estimate ── */}
          <ActionForm
            action={saveGcPriceAdjustment.bind(null, view.gcs.find((gc) => gc.isThis)!.invitationId)}
            resetOnSuccess={false}
            className="flex flex-wrap items-end gap-3"
          >
            <label className="flex flex-col gap-1 text-sm text-ink-label">
              Price to {view.gcs.find((gc) => gc.isThis)?.name}
              <select name="kind" defaultValue={view.thisAdjustment.kind} className={field}>
                <option value="none">The estimate total, no adjustment</option>
                <option value="amount">Add or take off a dollar amount</option>
                <option value="percent">Add or take off a percent</option>
              </select>
            </label>
            <label className="flex flex-col gap-1 text-sm text-ink-label">
              Amount or percent
              <input
                name="value"
                inputMode="text"
                autoComplete="off"
                placeholder="-2,500 or 4.5"
                defaultValue={view.thisAdjustment.value}
                className={field}
              />
            </label>
            <label className="flex flex-col gap-1 text-sm text-ink-label">
              Why
              <input
                name="reason"
                autoComplete="off"
                maxLength={200}
                placeholder="e.g. pays net 60"
                defaultValue={view.thisAdjustment.reason}
                className={field}
              />
            </label>
            <SubmitButton type="submit" className={quiet}>
              Save price
            </SubmitButton>
            <p className="w-full text-xs text-ink-muted">
              A minus takes money off. The price is worked out from the estimate every time, so editing a line moves every
              GC&apos;s price with it. The reason is for you and never prints on the proposal.
            </p>
          </ActionForm>

          {/* ── the one estimate ── */}
          {!view.estimate && (
            <ActionForm
              action={startEstimateFromProject.bind(null, view.projectId, surface)}
              className="flex flex-wrap items-center gap-3"
            >
              <SubmitButton type="submit" className={primary} data-bids="start-estimate">
                Start the estimate
              </SubmitButton>
              <p className="text-xs text-ink-muted">
                One estimate for the whole project. The name, address and bid date come from the project
                {view.firstGcName ? `; it starts as ${view.firstGcName}'s and switches to the winner at award` : ""}.
              </p>
            </ActionForm>
          )}

          {/* ── who won the prime ── */}
          <ActionForm
            action={recordPrimeAward.bind(null, view.projectId)}
            resetOnSuccess={false}
            className="flex flex-wrap items-end gap-3"
          >
            <label className="flex flex-col gap-1 text-sm text-ink-label">
              Prime contract awarded to
              <select name="contactId" defaultValue={view.primeAwarded?.contactId ?? ""} className={field}>
                <option value="">A GC not on my list / not known</option>
                {gcs.map((gc) => (
                  <option key={gc.id} value={gc.id}>
                    {gc.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-sm text-ink-label">
              …or name
              <input
                name="name"
                autoComplete="off"
                placeholder="If not in the list"
                defaultValue={view.primeAwarded && !view.primeAwarded.contactId ? view.primeAwarded.name : ""}
                className={field}
              />
            </label>
            <label className="flex flex-col gap-1 text-sm text-ink-label">
              Awarded on
              <input name="awardedOn" type="date" defaultValue={view.primeAwarded?.on ?? ""} className={field} />
            </label>
            <SubmitButton type="submit" className={quiet}>
              {view.primeAwarded ? "Update award" : "Record award"}
            </SubmitButton>
            <p className="w-full text-xs text-ink-muted">
              An entered fact: from a results sheet or a phone call. GCs who did not get it stop counting against their win rate.
              Leave both blank and save to clear it.
            </p>
          </ActionForm>

          {/* ── same job / not the same job ── */}
          {choices.length > 0 && (
            <div data-bids="merge">
              {merging === null ? (
                <label className="flex flex-wrap items-center gap-2 text-sm text-ink-label">
                  This is the same job as…
                  <select
                    value=""
                    onChange={(event) => setMerging(event.target.value || null)}
                    className={`${field} max-w-full`}
                    aria-label="This is the same job as"
                  >
                    <option value="">Pick a project…</option>
                    {choices.map((choice) => (
                      <option key={choice.id} value={choice.id}>
                        {choice.label}
                      </option>
                    ))}
                  </select>
                </label>
              ) : (
                <ActionForm
                  action={mergeIntoProject.bind(null, view.projectId)}
                  className="flex flex-wrap items-center gap-2"
                >
                  <input type="hidden" name="intoProjectId" value={merging} />
                  <p className="w-full text-sm text-ink">
                    Move {view.gcs.length === 1 ? "this bid" : `these ${view.gcs.length} bids`} onto{" "}
                    <span className="font-medium">{mergeTarget?.label}</span>? They become one job with one estimate.
                  </p>
                  <SubmitButton type="submit" className={primary}>
                    Yes, same job
                  </SubmitButton>
                  <button type="button" onClick={() => setMerging(null)} className={quiet}>
                    Cancel
                  </button>
                </ActionForm>
              )}
            </div>
          )}
          {others.length > 0 && (
            <div data-bids="split">
              {!splitting ? (
                <button type="button" onClick={() => setSplitting(true)} className={quiet}>
                  Not the same job as the others
                </button>
              ) : (
                <ActionForm
                  action={splitFromProject.bind(null, view.gcs.find((gc) => gc.isThis)!.invitationId)}
                  className="flex flex-wrap items-center gap-2"
                >
                  <p className="w-full text-sm text-ink">
                    Give this bid a project of its own? It keeps its own name, date and status; the address and estimate stay with
                    the other GCs.
                  </p>
                  <SubmitButton type="submit" className={primary}>
                    Yes, split it out
                  </SubmitButton>
                  <button type="button" onClick={() => setSplitting(false)} className={quiet}>
                    Cancel
                  </button>
                </ActionForm>
              )}
            </div>
          )}
        </div>
      </details>
    </div>
  );
}
