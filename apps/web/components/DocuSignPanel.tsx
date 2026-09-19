"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { refreshDocuSignEnvelope, sendWithDocuSign, voidSentEnvelope } from "@/lib/actions";
import { ConfirmDelete, RowActions } from "@/components/RowActions";
import type { DocuSignCardState } from "@/lib/docusign/setup";

/**
 * "Send with DocuSign", beside C Stream's own signing link — never instead
 * of it. One panel per thing that can be sent: the contract summary, an
 * uploaded contract document, a submitted change order.
 *
 *   - Not set up on this install: renders NOTHING. The built-in link is the
 *     default and needs no apology for an integration nobody configured.
 *   - Set up but not connected: one line saying where to connect it.
 *   - Connected: the envelopes already sent for this thing (status, dates,
 *     the signed copy and certificate once signed, Refresh, and an
 *     owner-only two-step Void), and a Send button while nothing is out.
 *
 * The send form follows the React 19 rule (formActionCensus): onSubmit,
 * preventDefault, a FormData read synchronously, and the fields cleared only
 * on success — a refused send keeps what was typed next to the reason.
 */

export type DocuSignEnvelopeView = {
  id: string;
  status: "SENT" | "DELIVERED" | "COMPLETED" | "DECLINED" | "VOIDED";
  statusLabel: string;
  documentName: string;
  recipients: string;
  /** "Sent Sep 18, 2026, 2:14 PM" and the like, already in the viewer's zone. */
  timeline: string[];
  voidedReason: string | null;
  signedDocumentUrl: string | null;
  certificateUrl: string | null;
};

const buttonClass =
  "rounded-md border border-line-card bg-surface px-3 py-1.5 text-xs font-medium text-ink-label hover:bg-neutral-800 disabled:cursor-not-allowed disabled:opacity-60";
const primaryClass =
  "rounded-md bg-brand px-3 py-2 text-sm font-semibold text-neutral-900 hover:bg-yellow-500 disabled:cursor-not-allowed disabled:opacity-50";
const inputClass =
  "rounded-md border border-line-card bg-canvas px-3 py-2 text-sm text-ink placeholder:text-ink-muted focus:border-link focus:outline-none";

const STATUS_STYLE: Record<DocuSignEnvelopeView["status"], string> = {
  SENT: "bg-tag-slate text-tag-slate-ink",
  DELIVERED: "bg-tag-slate text-tag-slate-ink",
  COMPLETED: "bg-tag-green text-tag-green-ink",
  DECLINED: "bg-tag-rose text-tag-rose-ink",
  VOIDED: "bg-tag-rose text-tag-rose-ink",
};

function EnvelopeRow({ envelope, canVoid }: { envelope: DocuSignEnvelopeView; canVoid: boolean }) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const live = envelope.status === "SENT" || envelope.status === "DELIVERED";

  return (
    <li className="flex flex-col gap-2 p-3 sm:flex-row sm:items-start sm:justify-between" data-tour="docusign-envelope">
      <div className="min-w-0 text-sm">
        <p className="text-ink">
          <span className={`mr-2 rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLE[envelope.status]}`}>
            {envelope.statusLabel}
          </span>
          {envelope.documentName}
        </p>
        <p className="mt-1 text-xs text-ink-body">To {envelope.recipients}</p>
        {envelope.timeline.map((line) => (
          <p key={line} className="text-xs text-ink-muted">
            {line}
          </p>
        ))}
        {envelope.voidedReason && <p className="text-xs text-ink-muted">Reason: {envelope.voidedReason}</p>}
        {(envelope.signedDocumentUrl || envelope.certificateUrl) && (
          <p className="mt-1 flex flex-wrap gap-3 text-xs">
            {envelope.signedDocumentUrl && (
              <a href={envelope.signedDocumentUrl} target="_blank" rel="noreferrer" className="text-link hover:underline">
                Signed copy
              </a>
            )}
            {envelope.certificateUrl && (
              <a href={envelope.certificateUrl} target="_blank" rel="noreferrer" className="text-link hover:underline">
                Certificate of completion
              </a>
            )}
          </p>
        )}
        {error && (
          <p role="alert" className="mt-1 text-xs text-red-400">
            {error}
          </p>
        )}
      </div>
      <RowActions
        className="flex shrink-0 flex-wrap items-center gap-2 sm:justify-end"
        destructive={
          live && canVoid ? (
            <ConfirmDelete
              label="Void"
              confirmLabel="Confirm void"
              pendingLabel="Voiding…"
              pending={isPending}
              pinned="end"
              describe="Cancels the envelope at DocuSign so it can no longer be signed. The record stays here — sent correspondence is never deleted."
              onConfirm={() => {
                setError(null);
                startTransition(async () => {
                  const result = await voidSentEnvelope(envelope.id, reason);
                  if (!result.ok) setError(result.error);
                });
              }}
              armedClassName="flex flex-wrap items-center justify-end gap-2"
              hint={
                <label className="flex flex-col gap-1 text-xs text-ink-label">
                  Why (the signer sees this)
                  <input
                    className={inputClass}
                    value={reason}
                    maxLength={200}
                    onChange={(event) => setReason(event.target.value)}
                    placeholder="Sent to the wrong person"
                  />
                </label>
              }
              deleteClassName={buttonClass}
              cancelClassName="rounded-md border border-line-card px-3 py-1.5 text-xs text-ink-body hover:text-ink disabled:opacity-60"
              confirmClassName="rounded-md border border-red-500 px-3 py-1.5 text-xs text-red-400 hover:bg-tag-rose disabled:cursor-not-allowed disabled:opacity-60"
            />
          ) : undefined
        }
      >
        {(live || (envelope.status === "COMPLETED" && !envelope.signedDocumentUrl)) && (
          <button
            type="button"
            className={buttonClass}
            disabled={isPending}
            data-tour="docusign-refresh"
            onClick={() => {
              setError(null);
              startTransition(async () => {
                const result = await refreshDocuSignEnvelope(envelope.id);
                if (!result.ok) setError(result.error);
              });
            }}
          >
            {isPending ? "Checking…" : "Refresh"}
          </button>
        )}
      </RowActions>
    </li>
  );
}

function SendForm({
  jobId,
  subject,
  subjectId,
  defaultSigner,
  onDone,
}: {
  jobId: string;
  subject: string;
  subjectId?: string;
  defaultSigner: { name: string; email: string };
  onDone: () => void;
}) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [signers, setSigners] = useState(1);

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const formData = new FormData(form);
    setError(null);
    startTransition(async () => {
      const result = await sendWithDocuSign(formData);
      if (result.ok) {
        form.reset();
        onDone();
      } else {
        setError(result.error);
      }
    });
  }

  return (
    <form onSubmit={submit} className="mt-3 flex flex-col gap-3 rounded-md border border-line-card p-3">
      <input type="hidden" name="jobId" value={jobId} />
      <input type="hidden" name="subject" value={subject} />
      {subjectId && <input type="hidden" name="subjectId" value={subjectId} />}
      {Array.from({ length: signers }, (_, index) => (
        <div key={index} className="grid gap-2 sm:grid-cols-2">
          <label className="flex flex-col gap-1 text-xs text-ink-label">
            {index === 0 ? "Signer's name" : `Signer ${index + 1}'s name`}
            <input name="signerName" className={inputClass} defaultValue={index === 0 ? defaultSigner.name : ""} required />
          </label>
          <label className="flex flex-col gap-1 text-xs text-ink-label">
            Email
            <input name="signerEmail" type="email" className={inputClass} defaultValue={index === 0 ? defaultSigner.email : ""} required />
          </label>
        </div>
      ))}
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" className={primaryClass} disabled={isPending}>
          {isPending ? "Sending…" : "Send for signature"}
        </button>
        {signers < 5 && (
          <button type="button" className="text-xs text-link hover:underline" onClick={() => setSigners((n) => n + 1)}>
            Add another signer
          </button>
        )}
        <button type="button" className="text-xs text-ink-body hover:text-ink" onClick={onDone} disabled={isPending}>
          Cancel
        </button>
      </div>
      <p className="text-xs text-ink-muted">
        DocuSign emails each signer in the order listed. When everyone has signed, the signed copy and
        DocuSign&rsquo;s certificate are saved here.
      </p>
      {error && (
        <p role="alert" className="text-sm text-red-400">
          {error}
        </p>
      )}
    </form>
  );
}

export function DocuSignPanel({
  state,
  jobId,
  subject,
  subjectId,
  defaultSigner,
  envelopes,
  canSend,
  canVoid,
  sendLabel = "Send with DocuSign",
  autoUpdates,
}: {
  state: DocuSignCardState;
  jobId: string;
  subject: "CONTRACT_SUMMARY" | "CONTRACT_DOCUMENT" | "CHANGE_ORDER";
  subjectId?: string;
  defaultSigner: { name: string; email: string };
  envelopes: DocuSignEnvelopeView[];
  /** False when this thing is not in a sendable state (already contracted,
   * already executed, not submitted). The history still shows. */
  canSend: boolean;
  canVoid: boolean;
  sendLabel?: string;
  /** Whether DocuSign Connect updates arrive by themselves on this install. */
  autoUpdates: boolean;
}) {
  const [open, setOpen] = useState(false);

  if (state === "not-set-up") return null;

  if (state !== "connected") {
    if (!canSend && envelopes.length === 0) return null;
    return (
      <p className="mt-3 text-xs text-ink-muted" data-tour="docusign-connect-hint">
        Prefer DocuSign? {state === "reconnect" ? "Reconnect" : "Connect"} it on{" "}
        <Link href="/settings/integrations#docusign" className="text-link hover:underline">
          Settings → Integrations
        </Link>{" "}
        (account owner).
      </p>
    );
  }

  const live = envelopes.some((envelope) => envelope.status === "SENT" || envelope.status === "DELIVERED");

  return (
    <div className="mt-3">
      {envelopes.length > 0 && (
        <ul className="divide-y divide-line-row rounded-md border border-line-card">
          {envelopes.map((envelope) => (
            <EnvelopeRow key={envelope.id} envelope={envelope} canVoid={canVoid} />
          ))}
        </ul>
      )}
      {live && !autoUpdates && (
        <p className="mt-2 text-xs text-ink-muted">
          Automatic updates from DocuSign are off on this install — press Refresh to check where it stands.
        </p>
      )}
      {canSend && !live && !open && (
        <button type="button" className={`${buttonClass} mt-3`} onClick={() => setOpen(true)} data-tour="docusign-send">
          {sendLabel}
        </button>
      )}
      {canSend && !live && open && (
        <SendForm
          jobId={jobId}
          subject={subject}
          subjectId={subjectId}
          defaultSigner={defaultSigner}
          onDone={() => setOpen(false)}
        />
      )}
    </div>
  );
}
