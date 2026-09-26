"use client";

import { useMemo, useState } from "react";
import { ActionForm } from "@/components/ActionForm";
import { SubmitButton } from "@/components/SubmitButton";
import { ConfirmDelete, RowActions } from "@/components/RowActions";
import { createLienWaiver, markLienWaiverSigned, revokeLienWaiver, updateLienWaiver } from "@/lib/actions";
import { money } from "@/lib/money";
import { formatCalendarDate } from "@/lib/render-date";
import {
  candidateExceptions,
  candidateExceptionTotal,
  waiverFormLabel,
  waiverWarnings,
  type WaiverCondition,
  type WaiverStage,
} from "@/lib/lien-waiver";
import type { LienWaiverSection } from "@/lib/lien-waiver-query";

/**
 * The lien waivers issued on this job, and the form that issues one.
 *
 * THE WARNINGS ARE THE FEATURE, and they are rendered LIVE — as the
 * condition, stage and excepted amount change, not on submit. A sentence
 * that appears only after you have committed is a receipt; this screen's
 * whole job is to be read before signing.
 *
 * THE CANDIDATE EXCEPTIONS ARE BUTTONS THAT FILL THE FIELD, and that is a
 * deliberate line rather than a compromise. The app never writes the
 * number by itself and never pre-fills it — but a person who reads
 * "retainage held $8,000" and then retypes 8000 is doing data entry, not
 * deciding, and the typo lands in the one field where a typo is expensive.
 * A tap is a decision; a default is not. The field starts EMPTY, and the
 * action refuses an empty one rather than reading it as zero.
 */
export function LienWaivers({
  jobId,
  section,
  canManage,
}: {
  jobId: string;
  section: LienWaiverSection;
  canManage: boolean;
}) {
  const [open, setOpen] = useState(false);

  return (
    <section className="mb-10">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-ink-label">Lien waivers</h2>
          <p className="mt-1 text-xs text-ink-muted">
            What you signed away, and what you kept. The exceptions are the part worth reading twice.
          </p>
        </div>
        {canManage && !open && (
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="shrink-0 rounded-md bg-brand px-3 py-2 text-sm font-semibold text-neutral-900 hover:bg-yellow-500"
          >
            Issue a waiver
          </button>
        )}
      </div>

      {open && canManage && (
        <IssueWaiverForm jobId={jobId} section={section} onDone={() => setOpen(false)} />
      )}

      {section.waivers.length === 0 ? (
        <p className="rounded-md border border-line-card bg-surface px-4 py-6 text-sm text-ink-muted">
          No lien waivers on this job yet. A GC usually wants one with each pay application —
          issue it here so what you excepted is on the record.
        </p>
      ) : (
        <ul className="space-y-2">
          {section.waivers.map((waiver) => (
            <WaiverRow key={waiver.id} waiver={waiver} canManage={canManage} />
          ))}
        </ul>
      )}
    </section>
  );
}

function WaiverRow({
  waiver,
  canManage,
}: {
  waiver: LienWaiverSection["waivers"][number];
  canManage: boolean;
}) {
  const [editing, setEditing] = useState(false);
  // A signed waiver is the record of what was given up; a withdrawn one is
  // closed. Neither is edited — the action refuses both too, because a
  // Server Action answers whoever posts to it.
  const editable = canManage && waiver.status === "PENDING" && !waiver.revokedAt;
  const state = waiver.revokedAt ? "Withdrawn" : waiver.status === "SIGNED" ? "Signed" : "Awaiting signature";
  const tone =
    waiver.revokedAt
      ? "bg-tag-slate text-tag-slate-ink"
      : waiver.status === "SIGNED"
        ? "bg-tag-emerald text-tag-emerald-ink"
        : "bg-tag-amber text-tag-amber-ink";

  return (
    <li className="rounded-md border border-line-card bg-surface px-4 py-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium text-ink">
            {waiverFormLabel(waiver.condition, waiver.stage)}
          </p>
          <p className="mt-1 text-xs text-ink-muted">
            Through {formatCalendarDate(waiver.throughDate)} · {money(waiver.amount)}
            {waiver.invoiceNumber !== null && <> · Pay app #{waiver.invoiceNumber}</>}
          </p>
          <p className="mt-1 text-xs text-ink-body">
            {waiver.exceptedAmount > 0 ? (
              <>
                Excepted {money(waiver.exceptedAmount)}
                {waiver.exceptionsNote && <> — {waiver.exceptionsNote}</>}
              </>
            ) : (
              // Stated, never implied. A row that simply omits the
              // exceptions reads as "none were needed"; this one says what
              // the document actually does.
              <span className="text-tag-rose-ink">Nothing excepted — this waiver gives up everything through that date.</span>
            )}
          </p>
          {waiver.signedAt && (
            <p className="mt-1 text-xs text-ink-muted">
              Signed {formatCalendarDate(waiver.signedAt)}
              {waiver.signerName && <> by {waiver.signerName}</>}
            </p>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${tone}`}>{state}</span>
          {editable && (
            <RowActions
              className="flex items-center gap-2"
              destructive={
                <ConfirmDelete
                  label="Withdraw"
                  confirmLabel="Withdraw it"
                  describe={`Withdraw the ${waiverFormLabel(waiver.condition, waiver.stage).toLowerCase()}`}
                  prompt="Withdraw this waiver? The signing link stops working. The record that it was issued stays."
                  action={async () => {
                    await revokeLienWaiver(waiver.id);
                  }}
                />
              }
            >
              <button
                type="button"
                onClick={() => setEditing((was) => !was)}
                className="text-sm text-link hover:text-link-hover"
              >
                {editing ? "Close" : "Edit"}
              </button>
            </RowActions>
          )}
        </div>
      </div>
      {editing && editable && (
        <EditWaiverForm waiver={waiver} onDone={() => setEditing(false)} />
      )}
      {editable && !editing && (
        <ActionForm
          action={markLienWaiverSigned.bind(null, waiver.id)}
          resetOnSuccess={false}
          className="mt-3 flex flex-wrap items-end gap-3 border-t border-line-card pt-3"
        >
          <label className="flex flex-col gap-1 text-xs text-ink-label">
            Signed on
            <input
              type="date"
              name="signedAt"
              required
              className="rounded-md border border-line-card bg-canvas px-2 py-1.5 text-sm text-ink focus:border-link focus:outline-none"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs text-ink-label">
            Signed by
            <input
              type="text"
              name="signerName"
              placeholder="Name on the form"
              className="rounded-md border border-line-card bg-canvas px-2 py-1.5 text-sm text-ink focus:border-link focus:outline-none"
            />
          </label>
          <SubmitButton
            type="submit"
            className="rounded-md border border-line-card px-3 py-1.5 text-sm text-ink hover:bg-canvas"
          >
            Record as signed
          </SubmitButton>
          <span className="w-full text-xs text-ink-muted">
            The date on the executed form, not today — it is the date that would be read out.
          </span>
        </ActionForm>
      )}
    </li>
  );
}

function EditWaiverForm({
  waiver,
  onDone,
}: {
  waiver: LienWaiverSection["waivers"][number];
  onDone: () => void;
}) {
  return (
    <ActionForm
      action={updateLienWaiver.bind(null, waiver.id)}
      onSuccess={onDone}
      resetOnSuccess={false}
      className="mt-3 grid gap-3 border-t border-line-card pt-3 sm:grid-cols-2"
    >
      <label className="flex flex-col gap-1 text-sm text-ink-label">
        Form
        <select
          name="condition"
          defaultValue={waiver.condition}
          className="rounded-md border border-line-card bg-canvas px-3 py-2 text-ink focus:border-link focus:outline-none"
        >
          <option value="CONDITIONAL">Conditional</option>
          <option value="UNCONDITIONAL">Unconditional</option>
        </select>
      </label>
      <label className="flex flex-col gap-1 text-sm text-ink-label">
        Covers
        <select
          name="stage"
          defaultValue={waiver.stage}
          className="rounded-md border border-line-card bg-canvas px-3 py-2 text-ink focus:border-link focus:outline-none"
        >
          <option value="PROGRESS">A progress payment</option>
          <option value="FINAL">Final payment</option>
        </select>
      </label>
      <label className="flex flex-col gap-1 text-sm text-ink-label">
        Through date
        <input
          type="date"
          name="throughDate"
          defaultValue={waiver.throughDate.toISOString().slice(0, 10)}
          className="rounded-md border border-line-card bg-canvas px-3 py-2 text-ink focus:border-link focus:outline-none"
        />
      </label>
      <label className="flex flex-col gap-1 text-sm text-ink-label">
        Amount
        <input
          type="text"
          name="amount"
          inputMode="decimal"
          defaultValue={String(waiver.amount)}
          className="rounded-md border border-line-card bg-canvas px-3 py-2 text-ink focus:border-link focus:outline-none"
        />
      </label>
      <label className="flex flex-col gap-1 text-sm text-ink-label">
        Excepted
        <input
          type="text"
          name="exceptedAmount"
          inputMode="decimal"
          defaultValue={String(waiver.exceptedAmount)}
          className="rounded-md border border-line-card bg-canvas px-3 py-2 text-ink focus:border-link focus:outline-none"
        />
      </label>
      <label className="flex flex-col gap-1 text-sm text-ink-label">
        What the exceptions are
        <input
          type="text"
          name="exceptionsNote"
          defaultValue={waiver.exceptionsNote ?? ""}
          className="rounded-md border border-line-card bg-canvas px-3 py-2 text-ink focus:border-link focus:outline-none"
        />
      </label>
      <div className="sm:col-span-2">
        <SubmitButton
          type="submit"
          className="rounded-md bg-brand px-4 py-2 text-sm font-semibold text-neutral-900 hover:bg-yellow-500"
        >
          Save
        </SubmitButton>
      </div>
    </ActionForm>
  );
}

function IssueWaiverForm({
  jobId,
  section,
  onDone,
}: {
  jobId: string;
  section: LienWaiverSection;
  onDone: () => void;
}) {
  const [condition, setCondition] = useState<WaiverCondition>("CONDITIONAL");
  const [stage, setStage] = useState<WaiverStage>("PROGRESS");
  const [invoiceId, setInvoiceId] = useState("");
  const [excepted, setExcepted] = useState("");

  const candidates = candidateExceptions(section);
  const suggested = candidateExceptionTotal(section);
  const invoice = section.invoices.find((row) => row.id === invoiceId) ?? null;

  const warnings = useMemo(
    () =>
      waiverWarnings({
        condition,
        stage,
        // An unparsed or empty field is treated as nothing excepted for
        // the purpose of WARNING — which is the honest reading while
        // somebody is mid-type, and the action still refuses to save it.
        exceptedAmount: Number(excepted.replace(/[$,]/g, "")) || 0,
        amountPaid: invoice ? invoice.amountPaid : null,
        retainageBalance: section.retainageBalance,
        pendingChangeOrderTotal: section.pendingChangeOrderTotal,
      }),
    [condition, stage, excepted, invoice, section.retainageBalance, section.pendingChangeOrderTotal],
  );

  return (
    <ActionForm
      action={createLienWaiver}
      onSuccess={onDone}
      className="mb-4 space-y-4 rounded-md border border-line-card bg-surface p-4"
    >
      <input type="hidden" name="jobId" value={jobId} />

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-sm text-ink-label">
          Form
          <select
            name="condition"
            value={condition}
            onChange={(event) => setCondition(event.target.value as WaiverCondition)}
            className="rounded-md border border-line-card bg-canvas px-3 py-2 text-ink focus:border-link focus:outline-none"
          >
            <option value="CONDITIONAL">Conditional — effective when the payment clears</option>
            <option value="UNCONDITIONAL">Unconditional — effective on signature</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm text-ink-label">
          Covers
          <select
            name="stage"
            value={stage}
            onChange={(event) => setStage(event.target.value as WaiverStage)}
            className="rounded-md border border-line-card bg-canvas px-3 py-2 text-ink focus:border-link focus:outline-none"
          >
            <option value="PROGRESS">A progress payment</option>
            <option value="FINAL">Final payment — closes the job</option>
          </select>
        </label>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <label className="flex flex-col gap-1 text-sm text-ink-label">
          Through date
          <input
            type="date"
            name="throughDate"
            required
            className="rounded-md border border-line-card bg-canvas px-3 py-2 text-ink focus:border-link focus:outline-none"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm text-ink-label">
          Amount
          <input
            type="text"
            name="amount"
            inputMode="decimal"
            placeholder="0.00"
            className="rounded-md border border-line-card bg-canvas px-3 py-2 text-ink focus:border-link focus:outline-none"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm text-ink-label">
          Pay application
          <select
            name="invoiceId"
            value={invoiceId}
            onChange={(event) => setInvoiceId(event.target.value)}
            className="rounded-md border border-line-card bg-canvas px-3 py-2 text-ink focus:border-link focus:outline-none"
          >
            <option value="">Not tied to one</option>
            {section.invoices.map((row) => (
              <option key={row.id} value={row.id}>
                #{row.number} — {money(row.amount)}
                {row.amountPaid > 0 ? ` (${money(row.amountPaid)} received)` : " (nothing received)"}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-sm text-ink-label">
          Excepted from this waiver
          <input
            type="text"
            name="exceptedAmount"
            inputMode="decimal"
            value={excepted}
            onChange={(event) => setExcepted(event.target.value)}
            placeholder="0.00"
            className="rounded-md border border-line-card bg-canvas px-3 py-2 text-ink focus:border-link focus:outline-none"
          />
          <span className="text-xs text-ink-muted">
            Money this waiver does NOT give up. Enter 0 if there is none.
          </span>
        </label>
        <label className="flex flex-col gap-1 text-sm text-ink-label">
          What the exceptions are
          <input
            type="text"
            name="exceptionsNote"
            placeholder="Retainage held to date; PCO 14"
            className="rounded-md border border-line-card bg-canvas px-3 py-2 text-ink focus:border-link focus:outline-none"
          />
        </label>
      </div>

      {candidates.length > 0 && (
        <div className="rounded-md border border-line-card bg-canvas p-3">
          <p className="text-xs font-medium text-ink-label">This job is carrying:</p>
          <ul className="mt-2 space-y-1">
            {candidates.map((candidate) => (
              <li key={candidate.key} className="text-xs text-ink-body">
                {candidate.label} — <span className="font-medium">{money(candidate.amount)}</span>
              </li>
            ))}
          </ul>
          <button
            type="button"
            onClick={() => setExcepted(String(suggested))}
            className="mt-2 text-xs font-medium text-link hover:text-link-hover"
          >
            Except {money(suggested)}
          </button>
        </div>
      )}

      {warnings.length > 0 && (
        <ul className="space-y-2" aria-live="polite">
          {warnings.map((warning) => (
            <li
              key={warning.key}
              className="rounded-md border border-tag-rose bg-tag-rose px-3 py-2 text-xs text-tag-rose-ink"
            >
              {warning.message}
            </li>
          ))}
        </ul>
      )}

      <div className="flex items-center gap-3">
        <SubmitButton
          type="submit"
          className="rounded-md bg-brand px-4 py-2 text-sm font-semibold text-neutral-900 hover:bg-yellow-500"
        >
          Issue waiver
        </SubmitButton>
        <button type="button" onClick={onDone} className="text-sm text-ink-muted hover:text-ink">
          Cancel
        </button>
      </div>
    </ActionForm>
  );
}
