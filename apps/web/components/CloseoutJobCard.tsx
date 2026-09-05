"use client";

import Link from "next/link";
import { useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import {
  addCloseoutItem,
  addStandardCloseoutChecklist,
  deleteCloseoutItem,
  deleteServiceRequest,
  deleteWarrantyPeriod,
  recordServiceRequest,
  setWarrantyPeriod,
  updateCloseoutItem,
  updateServiceRequest,
} from "@/lib/actions";
import type { ActionResult } from "@/lib/actions/shared";
import { inputClass, labelClass } from "@/components/RfiFields";
import {
  type CloseoutItemData,
  type ServiceRequestData,
  type WarrantyPeriodData,
  RESPONSIBILITIES,
  daysOfWarrantyLeft,
  daysToResolve,
  isOpen,
  outsideWarranty,
  responsibilityLabel,
  warrantyExpiry,
  warrantyState,
  warrantyStateLabel,
} from "@/components/closeoutLabels";
import { localToday } from "@/components/localToday";
import { ConfirmDelete, RowActions } from "@/components/RowActions";
import { closeoutChip } from "@/components/closeoutPackageLabels";
import type { CloseoutBlocker, CloseoutStage } from "@/lib/closeout-readiness";

export type CloseoutJobData = {
  id: string;
  name: string;
  items: CloseoutItemData[];
  warranty: WarrantyPeriodData | null;
  requests: ServiceRequestData[];
};

const btn =
  "rounded-md border border-slate-700 px-3 py-1.5 text-sm text-slate-300 hover:border-slate-500 disabled:opacity-50";
const primaryBtn =
  "rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50";
const linkBtn = "text-xs text-slate-500 underline disabled:opacity-50";

export function CloseoutJobCard({
  job,
  today,
  canDelete,
  /** Rendered above the checklist. The closeout-package section lives in
   * its own component (CloseoutPackagePanel) and is passed in rather than
   * built here, so this card stays the checklist/warranty/callbacks card
   * it already was. */
  packageSlot,
  /** The package stage from lib/closeout-readiness. The chip used to be
   * derived from the CHECKLIST ALONE, so a job with every box ticked read
   * "Closeout complete" directly above a panel reading "Not ready to
   * submit — 1 punch item still open". Browser testing caught exactly
   * that. Two computations of one concept is the bug; this chip now
   * defers to the same derivation the panel uses, and says only what a
   * checklist can actually tell you. */
  packageStage,
  /** The blockers from lib/closeout-readiness — the SAME array the package
   * panel renders below, not a second reading of the checklist.
   *
   * The third time this chip disagreed with that panel: a checklist made
   * up ENTIRELY OF OPTIONAL ITEMS has no required items, so
   * isCloseoutComplete was false and outstandingRequired was empty, and
   * the chip fell through to an amber "0 still outstanding" sitting
   * directly above a panel saying no checklist exists. Both props are
   * required rather than optional on purpose: the absent-prop default
   * would be "nothing is blocking", which is the dangerous direction. */
  packageBlockers,
}: {
  job: CloseoutJobData;
  today: string;
  canDelete: boolean;
  packageSlot?: ReactNode;
  packageStage: CloseoutStage;
  packageBlockers: CloseoutBlocker[];
}) {
  const [openForm, setOpenForm] = useState<"none" | "item" | "warranty" | "request">("none");
  const [editingItemId, setEditingItemId] = useState<string | null>(null);
  const [editingRequestId, setEditingRequestId] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  function run(fn: () => Promise<ActionResult>, onOk?: () => void) {
    setError(null);
    startTransition(async () => {
      const result = await fn();
      if (result.ok) {
        // On top of the action's own revalidatePath. Browser testing found
      // two union-compliance forms leaving the page stale until a manual
      // reload while others updated live; every action revalidates and
      // every form calls them the same way, so this is NOT a root-cause
      // fix. It is applied here because these components share that exact
      // pattern, and the same bug would sit unseen until someone hit it.
      // A save that looks like it did nothing gets clicked again, and no
      // create action here is idempotent.
        router.refresh();
        onOk?.();
      } else {
        setError(result.error);
      }
    });
  }

  function submit(
    event: React.FormEvent<HTMLFormElement>,
    action: (fd: FormData) => Promise<ActionResult>,
    onOk?: () => void,
  ) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    run(() => action(formData), onOk);
  }

  const wState = warrantyState(job.warranty, today);
  const daysLeft = daysOfWarrantyLeft(job.warranty, today);
  const openRequests = job.requests.filter(isOpen);

  // Read out of the blockers the panel below renders, never recomputed
  // from job.items. The derivation itself lives in closeoutPackageLabels so
  // it can be tested — see closeoutPackageLabels.test.ts.
  const chip = closeoutChip(packageBlockers, packageStage, job.items.length);

  const warrantyChip =
    wState === "ACTIVE"
      ? "bg-blue-500/15 text-blue-300"
      : wState === "EXPIRED"
        ? "bg-slate-800 text-slate-400"
        : "bg-slate-800 text-slate-400";

  return (
    <li className="flex flex-col gap-4 p-5">
      <div className="flex flex-wrap items-center gap-2">
        {/* Closeout is the last thing you do TO a job, so the job is the
            obvious next click. It was plain text, which made this page a
            place you could only arrive at from the nav. */}
        <Link
          href={`/jobs/${job.id}`}
          className="text-slate-100 hover:text-blue-300 hover:underline"
        >
          {job.name}
        </Link>
        <span className={`rounded px-1.5 py-0.5 text-xs ${chip.className}`}>{chip.label}</span>
        <span className={`rounded px-1.5 py-0.5 text-xs ${warrantyChip}`}>
          {warrantyStateLabel(wState)}
          {daysLeft !== null && ` · ${daysLeft} day${daysLeft === 1 ? "" : "s"} left`}
        </span>
        {openRequests.length > 0 && (
          <span className="rounded bg-red-500/15 px-1.5 py-0.5 text-xs text-red-300">
            {openRequests.length} open callback{openRequests.length === 1 ? "" : "s"}
          </span>
        )}
      </div>

      {packageSlot}

      {/* ------------------------------------------------------ checklist */}
      <section>
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
          Closeout checklist
        </h3>

        {job.items.length === 0 ? (
          <div className="rounded-md border border-dashed border-slate-700 p-3">
            <p className="text-sm text-slate-400">
              Nothing listed. A checklist is what turns &ldquo;we&apos;re basically done&rdquo; into
              something you can hold the GC to when chasing final payment.
            </p>
            <button
              type="button"
              disabled={isPending}
              onClick={() => run(() => addStandardCloseoutChecklist(job.id))}
              className={`${primaryBtn} mt-2`}
            >
              {isPending ? "Adding…" : "Add the standard checklist"}
            </button>
          </div>
        ) : (
          <ul className="flex flex-col gap-1">
            {job.items.map((item) =>
              editingItemId === item.id ? (
                <li key={item.id} className="rounded-md border border-slate-700 p-3">
                  <form
                    onSubmit={(e) =>
                      submit(e, (fd) => updateCloseoutItem(item.id, fd), () => setEditingItemId(null))
                    }
                    className="flex flex-col gap-3"
                  >
                    <label className={labelClass}>
                      Item
                      <input type="text" name="name" required defaultValue={item.name} className={inputClass} />
                    </label>
                    <label className="flex items-center gap-2 text-sm text-slate-300">
                      <input type="checkbox" name="isRequired" defaultChecked={item.isRequired} />
                      Required before closeout counts as done
                    </label>
                    <label className={labelClass}>
                      Date completed
                      <input
                        type="date"
                        name="completedOn"
                        defaultValue={item.completedOn ?? ""}
                        className={inputClass}
                      />
                      <span className="text-xs text-slate-500">
                        The date it was actually signed, not today. Leave blank if it isn&apos;t done.
                      </span>
                    </label>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <label className={labelClass}>
                        Link to the document
                        <input
                          type="url"
                          name="documentUrl"
                          defaultValue={item.documentUrl ?? ""}
                          placeholder="https://…"
                          className={inputClass}
                        />
                      </label>
                      <label className={labelClass}>
                        Link label
                        <input
                          type="text"
                          name="documentName"
                          defaultValue={item.documentName ?? ""}
                          className={inputClass}
                        />
                      </label>
                    </div>
                    <label className={labelClass}>
                      Note
                      <textarea name="note" rows={2} defaultValue={item.note ?? ""} className={inputClass} />
                    </label>
                    {error && <p className="text-sm text-red-400">{error}</p>}
                    <div className="flex gap-2">
                      <button type="submit" disabled={isPending} className={primaryBtn}>
                        {isPending ? "Saving…" : "Save"}
                      </button>
                      <button
                        type="button"
                        disabled={isPending}
                        onClick={() => setEditingItemId(null)}
                        className={btn}
                      >
                        Cancel
                      </button>
                    </div>
                  </form>
                </li>
              ) : (
                <li key={item.id} className="text-sm text-slate-400">
                  <span className={item.completedOn ? "text-green-300" : "text-slate-500"}>
                    {item.completedOn ? "✓" : "○"}
                  </span>{" "}
                  <span className={item.completedOn ? "text-slate-400" : "text-slate-200"}>{item.name}</span>
                  {!item.isRequired && <span className="text-slate-500"> · optional</span>}
                  {item.completedOn && <span className="text-slate-500"> · {item.completedOn}</span>}
                  {item.note && <span className="text-slate-500"> — {item.note}</span>}
                  {/* Arming the remove empties the rest of this row. The
                      document link and "Mark done…" both used to stay live
                      beside the armed confirm — issue #152 — so one click
                      past where you meant to stop opened the item editor
                      instead of cancelling. They are children of RowActions
                      now, which covers whatever gets added here next. */}
                  <RowActions
                    as="span"
                    destructive={
                      canDelete ? (
                        <ConfirmDelete
                          label="Remove"
                          confirmLabel="Confirm remove"
                          pending={isPending}
                          onConfirm={() => run(() => deleteCloseoutItem(item.id))}
                          deleteClassName={`${linkBtn} ml-2`}
                          cancelClassName={`${linkBtn} ml-2`}
                          confirmClassName="ml-2 text-xs text-red-400 underline disabled:opacity-50"
                        />
                      ) : null
                    }
                  >
                    {item.documentUrl && (
                      <a
                        href={item.documentUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="ml-2 text-xs text-blue-400 underline"
                      >
                        {item.documentName || "open"}
                      </a>
                    )}
                    <button
                      type="button"
                      disabled={isPending}
                      onClick={() => setEditingItemId(item.id)}
                      className={`${linkBtn} ml-2`}
                    >
                      {/* "Mark done" marked nothing done -- it opens the item
                          editor, where a date has to be typed. The ellipsis is
                          the honest version. Not changed to complete-on-click
                          with today's date, because the date a closeout item was
                          actually signed is frequently NOT today, and this app
                          does not fill dates in on someone's behalf. */}
                      {item.completedOn ? "Edit" : "Mark done…"}
                    </button>
                  </RowActions>
                </li>
              ),
            )}
          </ul>
        )}

        {openForm === "item" ? (
          <form
            onSubmit={(e) => submit(e, addCloseoutItem, () => setOpenForm("none"))}
            className="mt-3 flex flex-col gap-3 rounded-md border border-slate-700 p-3"
          >
            <input type="hidden" name="jobId" value={job.id} />
            <label className={labelClass}>
              Item
              <input type="text" name="name" required placeholder="e.g. Consent of surety" className={inputClass} />
            </label>
            <label className="flex items-center gap-2 text-sm text-slate-300">
              <input type="checkbox" name="isRequired" defaultChecked />
              Required before closeout counts as done
            </label>
            <label className={labelClass}>
              Note
              <textarea name="note" rows={2} className={inputClass} />
            </label>
            {error && <p className="text-sm text-red-400">{error}</p>}
            <div className="flex gap-2">
              <button type="submit" disabled={isPending} className={primaryBtn}>
                {isPending ? "Adding…" : "Add item"}
              </button>
              <button type="button" disabled={isPending} onClick={() => setOpenForm("none")} className={btn}>
                Cancel
              </button>
            </div>
          </form>
        ) : (
          <button type="button" disabled={isPending} onClick={() => setOpenForm("item")} className={`${btn} mt-3`}>
            Add an item
          </button>
        )}
      </section>

      {/* ------------------------------------------------------- warranty */}
      <section>
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Warranty</h3>

        {job.warranty && openForm !== "warranty" && (
          <p className="text-sm text-slate-400">
            {job.warranty.months} months from {job.warranty.startsOn} · runs out{" "}
            <span className="text-slate-200">{warrantyExpiry(job.warranty)}</span>
            {job.warranty.note && <span className="text-slate-500"> — {job.warranty.note}</span>}
          </p>
        )}

        {openForm === "warranty" ? (
          <form
            onSubmit={(e) => submit(e, setWarrantyPeriod, () => setOpenForm("none"))}
            className="flex flex-col gap-3 rounded-md border border-slate-700 p-3"
          >
            <input type="hidden" name="jobId" value={job.id} />
            <div className="grid gap-3 sm:grid-cols-2">
              <label className={labelClass}>
                Starts
                <input
                  type="date"
                  name="startsOn"
                  required
                  defaultValue={job.warranty?.startsOn ?? localToday()}
                  className={inputClass}
                />
                <span className="text-xs text-slate-500">
                  Usually substantial completion — but entered here, because the warranty clock and the
                  retainage clock aren&apos;t always the same date.
                </span>
              </label>
              <label className={labelClass}>
                Length in months
                <input
                  type="number"
                  name="months"
                  required
                  min={1}
                  defaultValue={job.warranty?.months ?? 12}
                  className={inputClass}
                />
                <span className="text-xs text-slate-500">
                  Months, as the contract states it. The end date is worked out from this.
                </span>
              </label>
            </div>
            <label className={labelClass}>
              Note
              <textarea name="note" rows={2} defaultValue={job.warranty?.note ?? ""} className={inputClass} />
            </label>
            {error && <p className="text-sm text-red-400">{error}</p>}
            <div className="flex gap-2">
              <button type="submit" disabled={isPending} className={primaryBtn}>
                {isPending ? "Saving…" : "Save warranty"}
              </button>
              <button type="button" disabled={isPending} onClick={() => setOpenForm("none")} className={btn}>
                Cancel
              </button>
            </div>
          </form>
        ) : (
          /* Arming the remove hides "Edit warranty"/"Set the warranty
             period" — issue #152. It sat live beside the armed confirm, in
             the position a hurried second click lands on. */
          <RowActions
            className="flex flex-wrap gap-2"
            destructive={
              job.warranty && canDelete ? (
                <ConfirmDelete
                  label="Remove"
                  confirmLabel="Confirm remove"
                  pending={isPending}
                  onConfirm={() => run(() => deleteWarrantyPeriod(job.id))}
                  deleteClassName={btn}
                  cancelClassName={btn}
                  confirmClassName="rounded-md border border-red-500 px-3 py-1.5 text-sm text-red-400 hover:bg-red-500/10 disabled:opacity-50"
                />
              ) : null
            }
          >
            <button type="button" disabled={isPending} onClick={() => setOpenForm("warranty")} className={btn}>
              {job.warranty ? "Edit warranty" : "Set the warranty period"}
            </button>
          </RowActions>
        )}
      </section>

      {/* ------------------------------------------------- service requests */}
      <section>
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
          Callbacks after completion
        </h3>

        {job.requests.length > 0 && (
          <ul className="mb-2 flex flex-col gap-1">
            {job.requests.map((r) =>
              editingRequestId === r.id ? (
                <li key={r.id} className="rounded-md border border-slate-700 p-3">
                  <form
                    onSubmit={(e) =>
                      submit(e, (fd) => updateServiceRequest(r.id, fd), () => setEditingRequestId(null))
                    }
                    className="flex flex-col gap-3"
                  >
                    <p className="text-sm font-semibold text-slate-300">Reported {r.reportedOn}</p>
                    <label className={labelClass}>
                      What was reported
                      <textarea
                        name="description"
                        rows={2}
                        required
                        defaultValue={r.description}
                        className={inputClass}
                      />
                    </label>
                    <label className={labelClass}>
                      Reported by
                      <input type="text" name="reportedBy" defaultValue={r.reportedBy ?? ""} className={inputClass} />
                    </label>
                    <label className={labelClass}>
                      Whose responsibility
                      <select name="responsibility" defaultValue={r.responsibility} className={inputClass}>
                        {RESPONSIBILITIES.map((o) => (
                          <option key={o.value} value={o.value}>
                            {o.label}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className={labelClass}>
                      Date resolved
                      <input
                        type="date"
                        name="resolvedOn"
                        defaultValue={r.resolvedOn ?? ""}
                        className={inputClass}
                      />
                      <span className="text-xs text-slate-500">
                        Leave blank while it&apos;s still open.
                      </span>
                    </label>
                    <label className={labelClass}>
                      How it was resolved
                      <textarea
                        name="resolutionNote"
                        rows={2}
                        defaultValue={r.resolutionNote ?? ""}
                        className={inputClass}
                      />
                    </label>
                    {error && <p className="text-sm text-red-400">{error}</p>}
                    <div className="flex gap-2">
                      <button type="submit" disabled={isPending} className={primaryBtn}>
                        {isPending ? "Saving…" : "Save"}
                      </button>
                      <button
                        type="button"
                        disabled={isPending}
                        onClick={() => setEditingRequestId(null)}
                        className={btn}
                      >
                        Cancel
                      </button>
                    </div>
                  </form>
                </li>
              ) : (
                <li key={r.id} className="text-sm text-slate-400">
                  <span className={isOpen(r) ? "text-red-300" : "text-slate-500"}>
                    {isOpen(r) ? "open" : "closed"}
                  </span>
                  {` · reported ${r.reportedOn}`}
                  {/* `outsideWarranty`, never `!wasInWarranty(...)`. The
                      third state is null — no warranty period on file —
                      and negating it claimed every callback on such a job
                      was outside a warranty nobody has recorded. Nothing is
                      rendered there instead: the chip at the top of the card
                      already says "No warranty recorded", which is the only
                      thing the data supports. */}
                  {outsideWarranty(r, job.warranty) && (
                    <span className="text-amber-300"> · outside warranty</span>
                  )}
                  {` · ${responsibilityLabel(r.responsibility).toLowerCase()}`}
                  {(() => {
                    const d = daysToResolve(r, today);
                    if (d === null) return null;
                    return isOpen(r)
                      ? ` · open ${d} day${d === 1 ? "" : "s"}`
                      : ` · closed in ${d} day${d === 1 ? "" : "s"}`;
                  })()}
                  <span className="block text-slate-300">{r.description}</span>
                  {r.reportedBy && <span className="text-xs text-slate-500">reported by {r.reportedBy} · </span>}
                  {r.resolutionNote && <span className="text-xs text-slate-500">{r.resolutionNote} · </span>}
                  {/* Arming the remove hides "Resolve"/"Edit" — issue #152.
                      It stayed live beside the armed confirm, so a click
                      meant to cancel a delete opened the callback editor. */}
                  <RowActions
                    as="span"
                    destructive={
                      canDelete ? (
                        <ConfirmDelete
                          label="Remove"
                          confirmLabel="Confirm remove"
                          pending={isPending}
                          onConfirm={() => run(() => deleteServiceRequest(r.id))}
                          deleteClassName={`${linkBtn} ml-2`}
                          cancelClassName={`${linkBtn} ml-2`}
                          confirmClassName="ml-2 text-xs text-red-400 underline disabled:opacity-50"
                        />
                      ) : null
                    }
                  >
                    <button
                      type="button"
                      disabled={isPending}
                      onClick={() => setEditingRequestId(r.id)}
                      className={linkBtn}
                    >
                      {isOpen(r) ? "Resolve" : "Edit"}
                    </button>
                  </RowActions>
                </li>
              ),
            )}
          </ul>
        )}

        {openForm === "request" ? (
          <form
            onSubmit={(e) => submit(e, recordServiceRequest, () => setOpenForm("none"))}
            className="flex flex-col gap-3 rounded-md border border-slate-700 p-3"
          >
            <input type="hidden" name="jobId" value={job.id} />
            <div className="grid gap-3 sm:grid-cols-2">
              <label className={labelClass}>
                Date reported
                <input type="date" name="reportedOn" required defaultValue={localToday()} className={inputClass} />
                <span className="text-xs text-slate-500">
                  The day the call came in. This is what decides whether it was in warranty.
                </span>
              </label>
              <label className={labelClass}>
                Reported by
                <input type="text" name="reportedBy" placeholder="e.g. GC super, owner" className={inputClass} />
              </label>
            </div>
            <label className={labelClass}>
              What was reported
              <textarea
                name="description"
                rows={2}
                required
                placeholder="e.g. Crack at the corridor head joint, level 3"
                className={inputClass}
              />
            </label>
            {error && <p className="text-sm text-red-400">{error}</p>}
            <div className="flex gap-2">
              <button type="submit" disabled={isPending} className={primaryBtn}>
                {isPending ? "Saving…" : "Record callback"}
              </button>
              <button type="button" disabled={isPending} onClick={() => setOpenForm("none")} className={btn}>
                Cancel
              </button>
            </div>
          </form>
        ) : (
          <button type="button" disabled={isPending} onClick={() => setOpenForm("request")} className={btn}>
            Record a callback
          </button>
        )}
      </section>

      {error && openForm === "none" && !editingItemId && !editingRequestId && (
        <p className="text-sm text-red-400">{error}</p>
      )}
    </li>
  );
}
