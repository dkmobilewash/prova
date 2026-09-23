"use client";

import Link from "next/link";
import { useRef, useState, useTransition } from "react";
import { Hint } from "@/components/Hint";
import { submitPayApplication, updateInvoiceStatus } from "@/lib/actions";
import { money } from "@/lib/money";
import { parseNumericInput } from "@/lib/numeric-input";
import { payAppRowsFromForm, payAppTotal, thisPeriodForPercentComplete } from "@/lib/pay-application";
import { formatInstant } from "@/lib/render-date";

const inputClass =
  "w-28 rounded-md border border-line-card bg-canvas px-2 py-1 text-right text-sm text-ink placeholder:text-ink-muted focus:border-link focus:outline-none";

const STATUS_OPTIONS = [
  { value: "SUBMITTED", label: "Submitted" },
  { value: "APPROVED", label: "Approved" },
  { value: "PARTIALLY_PAID", label: "Partially paid" },
  { value: "PAID", label: "Paid" },
  { value: "DISPUTED", label: "Disputed" },
] as const;

export type PayAppLineItemOption = {
  id: string;
  description: string;
  scheduledValue: number;
  /** Running stored balance on this line across every invoice so far. Shown
   * beside the input because it is the only way the person entering a pay
   * application can see that value is sitting in "stored" and needs
   * releasing with a negative once the material is installed. Without it,
   * the documented release mechanism is invisible even now that it works,
   * and stored materials get billed a second time. */
  materialsStoredToDate: number;
  /** Running total billed on this line across every earlier application.
   * The percent-complete box needs it: "60%" is 60% of the line MINUS what
   * has already gone out, and a figure that forgets this bills the whole
   * 60% again every month. */
  previousBilled: number;
};

/** What the percent box did to this line: where it lands, or why it
 * produced no figure. Its own component so the conditional and the two
 * colours live in one place rather than three index lookups deep in a
 * table cell. */
function PercentNote({ note }: { note?: { ok: boolean; text: string } }) {
  if (!note?.text) return null;
  return (
    <p className={`mt-1 max-w-[12rem] text-xs ${note.ok ? "text-ink-muted" : "text-tag-red-ink"}`}>
      {note.text}
    </p>
  );
}

export type PayAppInvoice = {
  id: string;
  number: number;
  status: string;
  amount: number;
  issuedAt: string;
};

export function StatusForm({ jobId, invoiceId, status }: { jobId: string; invoiceId: string; status: string }) {
  const [isPending, startTransition] = useTransition();

  return (
    <form
      onChange={(event) => {
        const formData = new FormData(event.currentTarget);
        startTransition(async () => {
          await updateInvoiceStatus(jobId, invoiceId, formData);
        });
      }}
    >
      <select
        name="status"
        defaultValue={status}
        disabled={isPending}
        className="rounded-md border border-line-card bg-canvas px-2 py-1 text-xs text-ink focus:border-link focus:outline-none disabled:opacity-50"
      >
        {STATUS_OPTIONS.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    </form>
  );
}

export function PayApplications({
  jobId,
  lineItems,
  payApplications,
  timeZone,
}: {
  jobId: string;
  lineItems: PayAppLineItemOption[];
  payApplications: PayAppInvoice[];
  // Resolved on the server by viewerTimeZone() and handed down, rather
  // than read from Intl here: this is a client component, and computing a
  // zone during render makes the markup disagree with the server's.
  timeZone: string;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  /** What this application currently comes to, from the boxes as typed.
   * A preview only — `submitPayApplication` re-reads the raw form and
   * decides from that. Negative is what makes the credit panel appear. */
  /** What this application currently comes to, from the boxes as typed, or
   * null while a box holds something the parser cannot read — the server
   * will name that field on submit, and inventing a total over a figure
   * nobody could read would be worse than showing none. */
  const [total, setTotal] = useState<number | null>(0);
  /**
   * The percent-complete boxes, and what each one did.
   *
   * THIS PERIOD IS STILL THE FIGURE THAT IS SUBMITTED. The percent box has
   * no `name`, so it never reaches FormData and the action never sees it —
   * it is an input aid that writes dollars into the box next to it, not a
   * second way to bill. That matters beyond tidiness: the G703 that leaves
   * this company carries dollars, `payAppEntryError` validates dollars, and
   * a percent travelling alongside them would be a second source of truth
   * free to disagree on the document itself.
   *
   * Written through a ref rather than by making This period a controlled
   * input. That box is deliberately uncontrolled — `formRef.current.reset()`
   * clears it on success, and #414's history is written around what it
   * does and does not refuse. Controlling it to gain this one convenience
   * would put a money field's behaviour on a re-render, and this is the
   * form that bills the GC.
   */
  const formRef = useRef<HTMLFormElement>(null);
  const billedRefs = useRef<Record<string, HTMLInputElement | null>>({});
  /** Per line: what the conversion said. Either where the line lands, or
   * why no figure was produced — shown under the box, because a percent box
   * that silently does nothing is worse than no percent box. */
  const [pctNote, setPctNote] = useState<Record<string, { ok: boolean; text: string }>>({});

  /** The running total, re-read from the form the same way the change
   * handler does — one parse, the action's own. Called after a percent box
   * has written into This period, since that write happens outside React's
   * event flow and the form's `onChange` does not fire for it. */
  function recomputeTotal() {
    if (!formRef.current) return;
    const parsed = payAppRowsFromForm(new FormData(formRef.current));
    setTotal(parsed.ok ? payAppTotal(parsed.rows) : null);
  }

  /** "60" in the percent box -> this period's dollars in the box beside it. */
  function applyPercent(item: PayAppLineItemOption, raw: string) {
    const box = billedRefs.current[item.id];
    if (!box) return;
    if (raw.trim() === "") {
      // Clearing the percent clears what it put there. Not clearing it
      // would leave a figure nobody typed sitting in a money box with
      // nothing on screen explaining where it came from.
      box.value = "";
      setPctNote((n) => ({ ...n, [item.id]: { ok: true, text: "" } }));
      recomputeTotal();
      return;
    }
    // `parseNumericInput`, not a sixteenth parser. Its own header is about
    // exactly this: fourteen hand-rolled `Number(raw)` calls each refused
    // `2,800`, the thousands comma a contractor types without thinking. It
    // also strips the trailing `%` a person types back at a percent box,
    // and refuses `12,50` rather than guessing between twelve-and-a-half
    // and twelve-fifty.
    const parsed = parseNumericInput(raw, { label: "Percent complete", maxDecimals: 2 });
    if (!parsed.ok) {
      setPctNote((n) => ({ ...n, [item.id]: { ok: false, text: parsed.error } }));
      return;
    }
    const converted = thisPeriodForPercentComplete({
      percentComplete: parsed.n,
      scheduledValue: item.scheduledValue,
      previousBilled: item.previousBilled,
      materialsStoredToDate: item.materialsStoredToDate,
    });
    if (!converted.ok) {
      setPctNote((n) => ({ ...n, [item.id]: { ok: false, text: converted.error } }));
      return;
    }
    box.value = String(converted.result.thisPeriodBilled);
    setPctNote((n) => ({
      ...n,
      [item.id]: {
        ok: true,
        text: `Takes this line to ${converted.result.landsAtPercent.toFixed(1)}% complete`,
      },
    }));
    recomputeTotal();
  }

  /** What this application would credit the GC, or null when it is not a
   * credit. A number rather than a boolean so the panel below cannot be
   * rendered without the figure that justifies it. */
  const creditAmount = total !== null && total < 0 ? -total : null;

  return (
    <section>
      <div className="mb-1 flex items-center justify-between">
        <h2 className="text-lg font-semibold text-ink">Pay applications</h2>
        {!isOpen && (
          <Hint text="Opens the form. Nothing is billed and nothing reaches the GC until you submit it.">
            <button
              type="button"
              onClick={() => setIsOpen(true)}
              className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500"
            >
              Submit pay application
            </button>
          </Hint>
        )}
      </div>
      <p className="mb-3 text-sm text-ink-muted">
        A pay application bills against specific schedule-of-values lines — this period&rsquo;s completed work plus
        any materials stored, per line — rather than a single lump-sum amount. New materials stored carries forward
        automatically on later applications; leave it blank if nothing new was stored this period. See the full
        G702/G703-style report for each one below.
      </p>
      <p className="mb-3 max-w-2xl text-sm text-ink-muted">
        <span className="text-ink-body">Once stored material gets installed,</span> enter it twice on the same
        line: the amount as a <strong className="text-ink-label">negative</strong> under New materials stored, and
        the same amount as a positive under This period. That moves the value from stored to completed. Skip the
        negative and you bill the same material twice — the running &ldquo;stored to date&rdquo; figure under each
        box is what is still sitting there.
      </p>
      <p className="mb-3 max-w-2xl text-sm text-ink-muted">
        <span className="text-ink-body">Billed too much on a line last time?</span> Enter the
        difference as a <strong className="text-ink-label">negative</strong> under This period on that
        line and it comes off what you have claimed to date — the same thing a G703 does. You can take
        back at most what that line has already been billed.
      </p>

      {isOpen && (
        <form
          ref={formRef}
          // The running total, recomputed from the form's own boxes on every
          // keystroke, so a person can see their application go negative
          // while they are still looking at the figure that did it. Read
          // through `payAppRowsFromForm` — the SAME parse the action uses —
          // rather than a second expression here, which would be a preview
          // free to disagree with what the server decides.
          onChange={(event) => {
            const parsed = payAppRowsFromForm(new FormData(event.currentTarget));
            setTotal(parsed.ok ? payAppTotal(parsed.rows) : null);
          }}
          onSubmit={(event) => {
            event.preventDefault();
            const formData = new FormData(event.currentTarget);
            setError(null);
            startTransition(async () => {
              // Both halves are needed. The action RETURNS its refusals,
              // because production redacts thrown Server Action messages —
              // but requireCompanyContext, assertJobInCompany,
              // assertLineItemOnJob and Prisma all still throw, and dropping
              // the catch would turn those into an unhandled rejection
              // inside startTransition with nothing rendered.
              try {
                const result = await submitPayApplication(jobId, formData);
                if (!result.ok) {
                  setError(result.error);
                  return;
                }
                formRef.current?.reset();
                // `reset()` clears the percent boxes with everything else,
                // but the notes under them are React state and would
                // otherwise survive into the next application, describing
                // lines on a form that no longer holds those figures.
                setPctNote({});
                setTotal(0);
                setIsOpen(false);
              } catch (err) {
                setError(err instanceof Error ? err.message : "Could not submit the pay application");
              }
            });
          }}
          className="mb-4 flex flex-col gap-3 rounded-lg border border-line-card bg-surface p-4"
        >
          <div className="flex flex-wrap gap-3">
            <label className="flex flex-col gap-1 text-sm text-ink-label">
              Description
              <input
                name="description"
                placeholder="Application for payment #3"
                className="w-56 rounded-md border border-line-card bg-canvas px-3 py-2 text-ink placeholder:text-ink-muted focus:border-link focus:outline-none"
              />
            </label>
            <label className="flex flex-col gap-1 text-sm text-ink-label">
              Due date
              <input
                type="date"
                name="dueAt"
                className="rounded-md border border-line-card bg-canvas px-3 py-2 text-ink focus:border-link focus:outline-none"
              />
            </label>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full min-w-[520px] text-left text-sm">
              <thead>
                <tr className="text-xs text-ink-muted">
                  <th className="pb-1 pr-3 font-normal">Line item</th>
                  <th className="pb-1 pr-3 text-right font-normal">Scheduled value</th>
                  <th className="pb-1 pr-3 text-right font-normal">% complete</th>
                  <th className="pb-1 pr-3 text-right font-normal">This period</th>
                  <th className="pb-1 text-right font-normal">New materials stored</th>
                </tr>
              </thead>
              <tbody>
                {lineItems.map((item) => (
                  <tr key={item.id} className="border-t border-line-row">
                    <td className="py-1 pr-3 text-ink-label">{item.description}</td>
                    <td className="py-1 pr-3 text-right text-ink-muted">
                      {item.scheduledValue.toLocaleString("en-US", { style: "currency", currency: "USD" })}
                    </td>
                    {/* NO `name`, so it never reaches FormData: this box
                        fills the one beside it and is not itself billed.
                        DELIBERATELY NOT `onChange`: "6" on the way to "60"
                        is a valid percent, and converting on every
                        keystroke would rewrite the money box — and show a
                        note about a figure the person is halfway through
                        typing. Blur and Enter are where a typed number
                        settles. */}
                    <td className="py-1 pr-3 text-right align-top">
                      <input
                        type="text"
                        inputMode="decimal"
                        placeholder="%"
                        aria-label={`Percent complete on ${item.description}`}
                        onBlur={(event) => applyPercent(item, event.currentTarget.value)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") {
                            event.preventDefault();
                            applyPercent(item, event.currentTarget.value);
                          }
                        }}
                        className="w-20 rounded-md border border-line-card bg-canvas px-2 py-1 text-right text-sm text-ink placeholder:text-ink-muted focus:border-link focus:outline-none"
                      />
                      <PercentNote note={pctNote[item.id]} />
                    </td>
                    <td className="py-1 pr-3 text-right align-top">
                      <input type="hidden" name="lineItemId" value={item.id} />
                      {/* NO FLOOR ON THIS BOX ANY MORE, and the floor was
                          not the markup by the time it went — #414 had
                          already moved `min="0"` into the action as
                          `{ min: 0 }`, for the good reason that native
                          validation gates the submit handler and refuses in
                          silence. Same rule, better placed, and still the
                          wrong rule: it rested on "there is no
                          negative-billing mechanism", which is true of the
                          stored-materials RELEASE beside it and false of a
                          downward CORRECTION. With the attribute and the
                          server floor both in place, a line over-billed in
                          March could not be brought down on any later
                          application by any route. A G703's column E is
                          that route. What replaced it is a bound rather
                          than nothing — see payAppEntryError: you cannot
                          un-bill more than the line has been billed. */}
                      <input
                        ref={(el) => {
                          billedRefs.current[item.id] = el;
                        }}
                        name="thisPeriodBilled"
                        type="text"
                        inputMode="decimal"
                        placeholder="0.00"
                        className={inputClass}
                        onChange={() => {
                          // Typing dollars directly wins: the note beside
                          // the percent box would otherwise keep claiming a
                          // percent this line is no longer at.
                          setPctNote((n) => (n[item.id]?.text ? { ...n, [item.id]: { ok: true, text: "" } } : n));
                        }}
                      />
                    </td>
                    <td className="py-1 text-right">
                      {/* Never had a floor, and the reason is the older
                          half of the same story: a negative here is the
                          documented way to move value out of stored once
                          the material is installed (billing.prisma), and
                          `min="0"` made that unreachable — native validation
                          gates the submit handler, so the form silently
                          refused rather than showing anything. The box next
                          door has caught up. */}
                      <input
                        name="materialsStoredValue"
                        type="text"
                        inputMode="decimal"
                        placeholder="0.00"
                        className={inputClass}
                      />
                      <p className="mt-1 text-xs text-ink-muted">
                        {item.materialsStoredToDate !== 0
                          ? `${item.materialsStoredToDate.toLocaleString("en-US", {
                              style: "currency",
                              currency: "USD",
                            })} stored to date`
                          : "Nothing stored"}
                      </p>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* THE TOTAL, ALWAYS ON SCREEN. It was never shown before: the
              only way to know what this application came to was to submit
              it and read the invoice. A document that nets negative could
              therefore be produced without the figure ever appearing. */}
          {total !== null && (
            <p className="text-sm text-ink-body">
              This application comes to{" "}
              <span className={`tabular-nums ${creditAmount !== null ? "text-tag-rose-ink" : "text-ink-label"}`}>
                {money(total)}
              </span>
              {" — the sum of the boxes above, before retainage."}
            </p>
          )}

          {/* A CREDIT IS A REAL DOCUMENT AND IT IS ALSO WHAT HALF A TWO-PART
              ENTRY LOOKS LIKE. Nothing in the data tells them apart — both
              are "completed to date went down" — so the person who typed the
              figures is asked, here, rather than the app guessing. The
              action refuses a negative total that arrives without this box
              ticked, so this is the explanation and not the enforcement. */}
          {creditAmount !== null && (
            <div className="rounded-md border border-rose-700 bg-tag-rose p-3">
              <p className="text-sm text-tag-rose-ink">
                This is a <strong>credit</strong>, not a bill. It asks the GC for nothing and states that{" "}
                {money(creditAmount)} is owed back to them.
              </p>
              <p className="mt-1 text-xs text-tag-rose-ink">
                If you were moving installed material out of stored, the other half of that entry is
                missing: enter the same amount as a <strong>positive</strong> under This period on that
                line.
              </p>
              <label className="mt-2 flex items-center gap-2 text-sm text-tag-rose-ink">
                <input type="checkbox" name="confirmCredit" className="accent-yellow-500" />
                Yes — I mean to credit the GC {money(creditAmount)}.
              </label>
            </div>
          )}

          {error && <p className="text-sm text-red-400">{error}</p>}
          <div className="flex gap-2">
            <Hint text="Creates the application here and numbers it. It does not email the GC — print or export the G702/G703 below and send it the way this GC wants it.">
              <button
                type="submit"
                disabled={isPending}
                className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50"
              >
                {isPending ? "Submitting…" : "Submit pay application"}
              </button>
            </Hint>
            <button
              type="button"
              disabled={isPending}
              onClick={() => {
                setIsOpen(false);
                setError(null);
                setTotal(0);
              }}
              className="rounded-md border border-line-card px-4 py-2 text-sm text-ink-label hover:bg-neutral-800 disabled:opacity-50"
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      {payApplications.length === 0 ? (
        <p className="text-sm text-ink-body">No pay applications submitted yet.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {payApplications.map((app) => (
            <li
              key={app.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-line-card bg-surface p-3 text-sm"
            >
              <div>
                <Link href={`/jobs/${jobId}/pay-applications/${app.id}`} className="text-link hover:underline">
                  Application #{app.number}
                </Link>
                <span className="ml-2 text-ink-muted">
                  {formatInstant(new Date(app.issuedAt), timeZone)}
                  {" · "}
                  {app.amount.toLocaleString("en-US", { style: "currency", currency: "USD" })}
                </span>
              </div>
              <StatusForm jobId={jobId} invoiceId={app.id} status={app.status} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
