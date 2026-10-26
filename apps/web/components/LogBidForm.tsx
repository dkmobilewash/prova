"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { checkSameJobFromOtherGc, createBidInvitation, readBidInvitationText } from "@/lib/actions";
import type { BidInviteReadResult } from "@/lib/actions/bidInviteRead";
import type { SameJobMatch } from "@/lib/estimating/bid-invitation";
import { ActionForm } from "@/components/ActionForm";
import { SubmitButton } from "@/components/SubmitButton";
import { BidDetailsFields } from "@/components/BidDetailsFields";
import { surfaceHrefs, type Surface } from "@/lib/bid/surfaceHrefs";

const field =
  "rounded-md border border-line-card bg-canvas px-3 py-2 text-base text-ink placeholder:text-ink-muted focus:border-link focus:outline-none sm:text-sm";

/**
 * "+ Log a bid" on /bids. A bid invitation could only be logged from a GC's
 * own contact page, which nobody looking for "log a bid" thinks to open
 * (contractor click test, 2026-10-11). Same fields as that page's form and
 * the SAME action — createBidInvitation(contactId, formData) — with the GC
 * picked here instead of implied by the page. The action itself checks the
 * contact belongs to this company.
 *
 * Collapsed behind its button like every add-form; `?new=1` (the area card
 * and ⌘K) opens it already.
 *
 * TWO THINGS ON TOP OF THE FORM, NEITHER OF WHICH SAVES ANYTHING:
 *
 *   - PASTE THE INVITATION. The text goes to `readBidInvitationText`, which
 *     returns a proposal; the form remounts filled with it (the `formKey`
 *     below) and the person checks it and presses "Log invitation" as before.
 *     The note and the checks are held HERE, above the remount, for the reason
 *     `QuoteReader`'s `note` prop records: state inside the keyed form is
 *     thrown away by the very remount that fills it.
 *   - SAME JOB FROM ANOTHER GC. As the GC, name, date or notes change, the
 *     form asks `checkSameJobFromOtherGc` — deterministic rules, no model, no
 *     allowance — and says in words which open invitation looks like the same
 *     job. It warns; it never blocks the save. Four GCs inviting you to one job
 *     is four invitations, and each is logged.
 */
/** The picked GC is the action's bound first argument on the contact page;
 * here it rides in the form. */
export const logBid = (formData: FormData) => createBidInvitation(String(formData.get("contactId") ?? ""), formData);

/** What the same-job check reads off the form. */
export function sameJobInputFromForm(form: FormData) {
  return {
    contactId: String(form.get("contactId") ?? "") || null,
    projectName: String(form.get("projectName") ?? ""),
    dueDate: String(form.get("dueDate") ?? "") || null,
    notes: String(form.get("notes") ?? "") || null,
  };
}

export function LogBidForm({
  gcs,
  startOpen = false,
  projectChoices = [],
  surface = "crm",
}: {
  gcs: { id: string; name: string }[];
  startOpen?: boolean;
  /** Projects already on file, so a second GC's invitation for the same job
   * can go on the same project instead of a new one. */
  projectChoices?: { id: string; label: string }[];
  /** Which product draws it: decides where "Add the GC" and "See it" go.
   * The default is the CRM, whose markup is unchanged. */
  surface?: Surface;
}) {
  const hrefs = surfaceHrefs(surface, "");
  const [open, setOpen] = useState(startOpen);
  const [pasted, setPasted] = useState("");
  const [suggestion, setSuggestion] = useState<BidInviteReadResult | null>(null);
  const [formKey, setFormKey] = useState(0);
  const [readError, setReadError] = useState<string | null>(null);
  const [isReading, startReading] = useTransition();
  const [matches, setMatches] = useState<SameJobMatch[]>([]);
  const formWrap = useRef<HTMLDivElement>(null);
  const checkTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const checkSeq = useRef(0);

  const runCheck = useCallback(() => {
    const form = formWrap.current?.querySelector("form");
    if (!form) return;
    const input = sameJobInputFromForm(new FormData(form));
    const seq = ++checkSeq.current;
    void checkSameJobFromOtherGc(input).then((result) => {
      // Only the newest answer is shown: an older one arriving late would
      // describe fields that are no longer on screen.
      if (seq !== checkSeq.current) return;
      setMatches(result.ok ? result.value : []);
    });
  }, []);

  const scheduleCheck = useCallback(() => {
    if (checkTimer.current) clearTimeout(checkTimer.current);
    checkTimer.current = setTimeout(runCheck, 400);
  }, [runCheck]);

  useEffect(() => () => {
    if (checkTimer.current) clearTimeout(checkTimer.current);
  }, []);

  // A filled form is checked as soon as it mounts — the paste is the moment
  // the duplicate is most likely, and nobody has typed anything to trigger it.
  useEffect(() => {
    if (formKey > 0) scheduleCheck();
  }, [formKey, scheduleCheck]);

  function read() {
    setReadError(null);
    startReading(async () => {
      const result = await readBidInvitationText(pasted);
      if (!result.ok) {
        setReadError(result.error);
        return;
      }
      setSuggestion(result.value);
      setFormKey((key) => key + 1);
    });
  }

  function close() {
    setOpen(false);
    setSuggestion(null);
    setMatches([]);
    setPasted("");
    setReadError(null);
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mb-6 inline-flex min-h-11 items-center rounded-md bg-brand px-4 py-2 text-sm font-semibold text-neutral-900 hover:bg-brand-hover mouse:min-h-9"
      >
        + Log a bid
      </button>
    );
  }

  return (
    <section className="mb-6 rounded-lg border border-line-card bg-surface p-4" data-bids="log-bid">
      <h2 className="mb-3 text-sm font-semibold text-ink-label">Log a bid invitation</h2>
      {gcs.length === 0 ? (
        <p className="text-sm text-ink-body">
          Bids are logged against the GC who invited you, and there are no contacts yet.{" "}
          <Link href={hrefs.addGc} className="text-link hover:underline">
            Add the GC
          </Link>{" "}
          first, then come back.
        </p>
      ) : (
        <>
          <div className="mb-4 flex flex-col gap-2" data-bids="paste-invite">
            <label className="flex flex-col gap-1 text-sm text-ink-label">
              Paste the invitation
              <textarea
                name="invitationText"
                value={pasted}
                onChange={(event) => setPasted(event.currentTarget.value)}
                rows={4}
                placeholder="Paste the GC's email, or a BuildingConnected or Dodge listing…"
                className={field}
              />
            </label>
            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={read}
                disabled={isReading || pasted.trim().length === 0}
                className="inline-flex min-h-11 items-center rounded-md border border-line-card px-4 py-2 text-sm font-medium text-ink-label hover:bg-rail-hover disabled:cursor-not-allowed disabled:opacity-60 mouse:min-h-9"
              >
                {isReading ? "Reading it…" : "Fill the form from it"}
              </button>
              <span className="text-xs text-ink-muted">
                C Stream fills the fields in and you check them. Nothing is saved until you press Log invitation.
              </span>
            </div>
            {readError && !isReading && (
              <p className="text-sm text-tag-amber-ink" data-bids="paste-error">
                {readError}
              </p>
            )}
            {suggestion && !isReading && !readError && (
              <div className="rounded-md border border-line-card bg-canvas p-3 text-sm text-ink-body" data-bids="paste-read">
                <p>{suggestion.note}</p>
                {suggestion.checks.length > 0 && (
                  <>
                    <p className="mt-2 font-medium text-ink-label">Check these before you save:</p>
                    <ul className="mt-1 list-disc pl-5">
                      {suggestion.checks.map((check) => (
                        <li key={check}>{check}</li>
                      ))}
                    </ul>
                  </>
                )}
              </div>
            )}
          </div>

          {matches.length > 0 && (
            <div
              role="status"
              className="mb-3 rounded-md border border-transparent bg-tag-amber p-3 text-sm text-tag-amber-ink"
              data-bids="same-job-warning"
            >
              <p className="font-medium">Looks like a job you already have from another GC:</p>
              <ul className="mt-1 list-disc pl-5">
                {matches.map((match) => (
                  <li key={match.id}>
                    {match.sentence}.{" "}
                    <a href={`${hrefs.bids}?view=all#${match.id}`} className="underline">
                      See it
                    </a>
                  </li>
                ))}
              </ul>
              <p className="mt-1">Each GC is still its own invitation — log this one too if it is.</p>
            </div>
          )}

          <div ref={formWrap} onChange={scheduleCheck}>
            <ActionForm key={formKey} action={logBid} onSuccess={close} className="flex flex-wrap items-end gap-3">
              <label className="flex flex-col gap-1 text-sm text-ink-label">
                GC
                <select name="contactId" required defaultValue={suggestion?.contactId ?? ""} className={field}>
                  <option value="" disabled>
                    Pick the GC…
                  </option>
                  {gcs.map((gc) => (
                    <option key={gc.id} value={gc.id}>
                      {gc.name}
                    </option>
                  ))}
                </select>
              </label>
              <BidDetailsFields
                defaults={{
                  projectName: suggestion?.projectName ?? "",
                  tradeScope: suggestion?.tradeScope ?? null,
                  dueDate: suggestion?.dueDate ?? null,
                  dueMinute: suggestion?.dueMinute ?? null,
                  notes: suggestion?.notes ?? null,
                }}
              />
              {projectChoices.length > 0 && (
                <label className="flex flex-col gap-1 text-sm text-ink-label">
                  Same job as…
                  <select name="bidProjectId" defaultValue="" className={`max-w-xs ${field}`}>
                    <option value="">A new job</option>
                    {projectChoices.map((choice) => (
                      <option key={choice.id} value={choice.id}>
                        {choice.label}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <label className="flex min-h-11 items-center gap-2 text-sm text-ink-label">
                <input type="checkbox" name="weReachedOut" className="h-5 w-5" />
                We reached out (they didn&rsquo;t invite us)
              </label>
              <div className="flex gap-2">
                <SubmitButton
                  type="submit"
                  className="inline-flex items-center justify-center rounded-md bg-brand px-4 py-2 text-sm font-semibold text-neutral-900 hover:bg-brand-hover"
                >
                  Log invitation
                </SubmitButton>
                <button
                  type="button"
                  onClick={close}
                  className="inline-flex min-h-11 items-center rounded-md border border-line-card px-4 py-2 text-sm text-ink-label hover:bg-rail-hover mouse:min-h-9"
                >
                  Cancel
                </button>
              </div>
            </ActionForm>
          </div>
        </>
      )}
    </section>
  );
}
