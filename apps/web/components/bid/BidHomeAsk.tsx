"use client";

import { useRef, useState, useTransition } from "react";
import Link from "next/link";
import { createBidInvitation, readBidInvitationText } from "@/lib/actions";
import type { BidInviteReadResult } from "@/lib/actions/bidInviteRead";
import { ActionForm } from "@/components/ActionForm";
import { SubmitButton } from "@/components/SubmitButton";
import { BidDetailsFields } from "@/components/BidDetailsFields";

const field =
  "rounded-md border border-line-card bg-canvas px-3 py-2 text-base text-ink placeholder:text-ink-muted focus:border-link focus:outline-none sm:text-sm";

/**
 * THE ONE BIG BOX on the Bid home: "What are we bidding today?"
 *
 * It does two things, and both reuse something that already exists rather than
 * adding a path:
 *
 *   - PASTE A GC's INVITE. The text goes to `readBidInvitationText` — the same
 *     reader "Log a bid" uses, behind the same Bid research AI switch and the
 *     same monthly allowance — which returns a PROPOSAL and writes nothing. The
 *     fields it found are shown here to be checked, and only the person pressing
 *     "Log this bid" saves, through `createBidInvitation`, the very action
 *     "Log a bid" posts to. Nothing is created on the paste.
 *   - ATTACH DRAWINGS. A link to Bid's existing "Start an estimate" screen,
 *     which creates the job (`createJob`, `returnTo=bid`) and lands on its
 *     takeoff, where the drawing set is uploaded. No second upload pipeline.
 *
 * A link, not a component: every href in this file is a literal `/bid` path, so
 * `bidLinkCensus.test.ts` reads each one.
 */

/** The picked GC is the action's bound first argument on a contact page; here it
 * rides in the form, exactly as `LogBidForm`'s `logBid` does. */
const logBid = (formData: FormData) => createBidInvitation(String(formData.get("contactId") ?? ""), formData);

type Stage = "paste" | "confirm" | "logged";

export function BidHomeAsk({ gcs }: { gcs: { id: string; name: string }[] }) {
  const [stage, setStage] = useState<Stage>("paste");
  const [pasted, setPasted] = useState("");
  const [suggestion, setSuggestion] = useState<BidInviteReadResult | null>(null);
  const [readError, setReadError] = useState<string | null>(null);
  const [formKey, setFormKey] = useState(0);
  const [isReading, startReading] = useTransition();
  const loggedName = useRef("");
  const noGcs = gcs.length === 0;

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
      setStage("confirm");
    });
  }

  function startOver() {
    setStage("paste");
    setSuggestion(null);
    setReadError(null);
  }

  function another() {
    startOver();
    setPasted("");
  }

  if (stage === "logged") {
    return (
      <section
        className="rounded-2xl border border-line-card bg-surface p-5"
        role="status"
        data-bid="home-logged"
      >
        <p className="text-base font-semibold text-ink">Logged: {loggedName.current || "the bid"}</p>
        <p className="mt-1 text-sm text-ink-body">
          It is on your bid log. Start its estimate from there, or paste the next invite.
        </p>
        <div className="mt-4 flex flex-col gap-3 sm:flex-row">
          <Link
            href="/bid/bids?view=all"
            className="inline-flex min-h-12 items-center justify-center rounded-md bg-brand px-4 text-sm font-semibold text-neutral-900 hover:bg-brand-hover"
          >
            See it in your bids
          </Link>
          <button
            type="button"
            onClick={another}
            className="inline-flex min-h-12 items-center justify-center rounded-md border border-line-card px-4 text-sm font-medium text-ink-label hover:bg-rail-hover"
          >
            Paste another invite
          </button>
        </div>
      </section>
    );
  }

  return (
    <div data-bid="home-ask">
      <div className="rounded-2xl border border-line-card bg-surface p-3 sm:p-4">
        <label htmlFor="bid-home-paste" className="sr-only">
          Paste a GC&rsquo;s invite email
        </label>
        <textarea
          id="bid-home-paste"
          name="invitationText"
          value={pasted}
          onChange={(event) => setPasted(event.currentTarget.value)}
          rows={4}
          placeholder="Paste a GC's invite email, or attach the drawings…"
          className="block w-full resize-y rounded-md border border-transparent bg-transparent p-2 text-base text-ink placeholder:text-ink-muted focus:border-link focus:outline-none"
        />
        <div className="mt-2 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <Link
            href="/bid/estimates/new"
            data-bid="home-attach"
            className="inline-flex min-h-12 items-center justify-center rounded-md border border-line-card px-4 text-sm font-medium text-ink-label hover:bg-rail-hover"
          >
            Attach drawings
          </Link>
          <button
            type="button"
            onClick={read}
            disabled={isReading || noGcs || pasted.trim().length === 0}
            data-bid="home-start"
            className="inline-flex min-h-14 items-center justify-center rounded-md bg-brand px-6 text-base font-semibold text-neutral-900 hover:bg-brand-hover disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isReading ? "Reading it…" : "Start →"}
          </button>
        </div>
      </div>

      {noGcs ? (
        <p className="mt-3 text-sm text-ink-body" data-bid="home-no-gcs">
          A bid is logged against the GC who invited you, and none is on file yet.{" "}
          <Link href="/bid/settings#gcs" className="inline-flex min-h-11 items-center text-link hover:underline">
            Add the GC
          </Link>{" "}
          first, then paste the invite.
        </p>
      ) : (
        <p className="mt-3 text-xs text-ink-muted">
          C Stream reads the invite and fills the fields in. Nothing is saved until you check them and press Log this
          bid.
        </p>
      )}

      {readError && !isReading && (
        <div className="mt-3 text-sm text-tag-amber-ink" role="alert" data-bid="home-read-error">
          <p>{readError}</p>
          <p className="mt-1">
            <Link href="/bid/bids?new=1" className="inline-flex min-h-11 items-center text-link hover:underline">
              Log it by hand instead
            </Link>
          </p>
        </div>
      )}

      {stage === "confirm" && suggestion && (
        <section
          className="mt-4 rounded-2xl border border-brand/40 bg-surface p-4"
          aria-label="Check the bid before it is logged"
          data-bid="home-confirm"
        >
          <h2 className="text-sm font-semibold text-ink-label">Here is what the invite says</h2>
          <p className="mt-1 text-sm text-ink-body">{suggestion.note}</p>
          {suggestion.checks.length > 0 && (
            <>
              <p className="mt-2 text-sm font-medium text-ink-label">Check these before you save:</p>
              <ul className="mt-1 list-disc pl-5 text-sm text-ink-body">
                {suggestion.checks.map((check) => (
                  <li key={check}>{check}</li>
                ))}
              </ul>
            </>
          )}
          <ActionForm
            key={formKey}
            action={(formData) => {
              loggedName.current = String(formData.get("projectName") ?? "").trim();
              return logBid(formData);
            }}
            onSuccess={() => setStage("logged")}
            // The shared detail fields are 40px tall; a gloved thumb gets 44 here.
            className="mt-4 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end [&_input]:min-h-11 [&_select]:min-h-11"
          >
            <label className="flex flex-col gap-1 text-sm text-ink-label">
              GC
              <select name="contactId" required defaultValue={suggestion.contactId ?? ""} className={field}>
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
                projectName: suggestion.projectName ?? "",
                tradeScope: suggestion.tradeScope ?? null,
                dueDate: suggestion.dueDate ?? null,
                dueMinute: suggestion.dueMinute ?? null,
                notes: suggestion.notes ?? null,
              }}
            />
            <div className="flex flex-col gap-3 sm:flex-row">
              <SubmitButton
                type="submit"
                className="inline-flex min-h-14 items-center justify-center rounded-md bg-brand px-6 text-base font-semibold text-neutral-900 hover:bg-brand-hover"
              >
                Log this bid
              </SubmitButton>
              <button
                type="button"
                onClick={startOver}
                className="inline-flex min-h-12 items-center justify-center rounded-md border border-line-card px-4 text-sm text-ink-label hover:bg-rail-hover"
              >
                Not right — start over
              </button>
            </div>
          </ActionForm>
        </section>
      )}
    </div>
  );
}
