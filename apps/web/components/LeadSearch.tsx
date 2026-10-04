"use client";

import { Spinner } from "@/components/Spinner";
import { useState, useTransition } from "react";
import {
  LEAD_SIZE_BANDS,
  LEAD_TRADES,
  type LeadSizeBand,
  type LeadTrade,
} from "@prova/integrations";
import { createBidPursuit } from "@/lib/actions";
import { searchBidLeads, type PlacedLead } from "@/lib/actions/leadSearch";
import { BidPursuitFields } from "@/components/BidPursuitList";
import { localToday } from "@/components/localToday";

/**
 * FIND PUBLIC PROJECTS OUT TO BID.
 *
 * The other direction from the project look-up: that one answers a question
 * about a project somebody already named, this one answers "what should we be
 * bidding". `LEAD_SEARCH` had no control anywhere until this — it ran inside the
 * `find_bid_leads` Ask command and nowhere else.
 *
 * COLLAPSED BEHIND A BUTTON, which is the list-page convention in CLAUDE.md
 * ("add-form collapsed behind a button") and here it is also about crowding:
 * /pipeline's job is the chase list, and two open AI panels above it would bury
 * the thing the page is for. It is also a paid search per press, so a form that
 * is not open cannot be pressed by accident.
 *
 * EVERY FIELD IS A CHOICE, NOT A SENTENCE. Trades are checkboxes over the enum,
 * the state is a two-letter code, size is a band. That is `leads.ts`'s privacy
 * boundary showing through to the screen: the outgoing query is a template
 * instance over these values and cannot contain free text, so there is no box
 * here into which a person could type something about their own company. The
 * sentence under the form says so.
 */

const TRADE_LABELS: Record<LeadTrade, string> = {
  METAL_FRAMING_DRYWALL: "Metal framing / drywall",
  LATH_PLASTER: "Lath & plaster / stucco",
  EIFS: "EIFS",
  ACOUSTICAL_CEILINGS: "Acoustical ceilings",
  FIREPROOFING: "Fireproofing",
};

const SIZE_LABELS: Record<LeadSizeBand, string> = {
  UNDER_250K: "Under $250k",
  FROM_250K_TO_1M: "$250k – $1M",
  OVER_1M: "Over $1M",
};

const inputClass =
  "mt-1 w-full rounded-md border border-line-card bg-surface px-3 py-2 text-sm text-ink placeholder:text-ink-muted";

export function LeadSearch() {
  const [open, setOpen] = useState(false);
  const [leads, setLeads] = useState<PlacedLead[] | null>(null);
  const [searches, setSearches] = useState(0);
  const [alreadyKnown, setAlreadyKnown] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [tracking, setTracking] = useState<number | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [isSaving, startSaving] = useTransition();

  if (!open) {
    return (
      <div className="mb-6">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="rounded-md border border-line-card px-3 py-2 text-sm font-medium text-ink hover:bg-surface"
          data-pipeline="lead-search-open"
        >
          Find projects out to bid
        </button>
      </div>
    );
  }

  return (
    <section
      className="mb-6 rounded-lg border border-line-card bg-surface p-4"
      data-pipeline="lead-search"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-ink">
            Find projects out to bid
          </h2>
          <p className="mt-1 text-sm text-ink-body">
            Searches public bid boards and owners&apos; sites for work in your
            trades and area that nobody has invited you to yet. Every result
            links the page it came from.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="shrink-0 rounded-md border border-line-card px-3 py-1.5 text-sm text-ink hover:bg-surface"
        >
          Close
        </button>
      </div>

      <form
        // `onSubmit` + `preventDefault`, never `<form action={fn}>`:
        // `formActionCensus.test.ts` has the reason, and this action's refusals
        // ("give the state as a two-letter code") are its whole error path — a
        // React 19 reset would show each one over the boxes it had just cleared.
        onSubmit={(event) => {
          event.preventDefault();
          const formData = new FormData(event.currentTarget);
          setError(null);
          setSaveError(null);
          setTracking(null);
          startTransition(async () => {
            const result = await searchBidLeads(formData);
            if (!result.ok) {
              setError(result.error);
              setLeads(null);
              return;
            }
            setLeads(result.value.leads);
            setSearches(result.value.searches);
            setAlreadyKnown(result.value.hiddenAlreadyKnown);
          });
        }}
        className="mt-3"
      >
        <fieldset className="mt-1">
          <legend className="text-sm text-ink-label">Trades</legend>
          <div className="mt-1 flex flex-wrap gap-x-4 gap-y-2">
            {LEAD_TRADES.map((trade) => (
              <label
                key={trade}
                className="flex items-center gap-2 text-sm text-ink"
              >
                <input
                  type="checkbox"
                  name="trades"
                  value={trade}
                  className="h-4 w-4"
                />
                {TRADE_LABELS[trade]}
              </label>
            ))}
          </div>
        </fieldset>

        <div className="mt-3 grid gap-3 sm:grid-cols-4">
          <label className="block text-sm sm:col-span-2">
            <span className="text-ink-label">City</span>
            <input
              name="city"
              required
              maxLength={60}
              placeholder="Reno"
              className={inputClass}
            />
          </label>
          <label className="block text-sm">
            <span className="text-ink-label">State</span>
            <input
              name="state"
              required
              maxLength={2}
              placeholder="NV"
              className={inputClass}
            />
          </label>
          <label className="block text-sm">
            <span className="text-ink-label">Size (optional)</span>
            <select name="sizeBand" defaultValue="" className={inputClass}>
              <option value="">Any</option>
              {LEAD_SIZE_BANDS.map((band) => (
                <option key={band} value={band}>
                  {SIZE_LABELS[band]}
                </option>
              ))}
            </select>
          </label>
        </div>

        <label className="mt-3 flex items-center gap-2 text-sm text-ink">
          <input type="checkbox" name="publicWorkOnly" className="h-4 w-4" />
          Public work only
        </label>

        <button
          type="submit"
          // #19's shape: nothing here is idempotent and each press is a billed
          // set of web searches.
          disabled={isPending}
          className="mt-3 rounded-md bg-brand px-4 py-2 text-sm font-medium text-neutral-900 disabled:opacity-60"
        >
          {isPending ? "Searching…" : "Search"}
        </button>
      </form>

      <p className="mt-2 text-xs text-ink-muted">
        Only the trades, city, state and size band you chose above are used to
        build the search. Nothing about your company, your GCs or your jobs is
        sent — and there is deliberately no free-text box here, because that is
        what keeps it that way. Bid dates before today are skipped.
      </p>

      {error && (
        <p
          className="mt-3 rounded-md bg-tag-amber px-3 py-2 text-sm text-tag-amber-ink"
          role="status"
        >
          {error}
        </p>
      )}

      {leads !== null && leads.length === 0 && (
        <p className="mt-3 text-sm text-ink-body" role="status">
          {alreadyKnown > 0
            ? `Nothing new. ${alreadyKnown} ${alreadyKnown === 1 ? "project" : "projects"} came back in ${searches} ${
                searches === 1 ? "search" : "searches"
              } and you already have every one of them on your pipeline, jobs or bids.`
            : `Nothing came back with a source behind it, in ${searches} ${
                searches === 1 ? "search" : "searches"
              }. That is the honest answer rather than a guess — try a wider size band, or a bigger city nearby.`}
        </p>
      )}

      {leads !== null && leads.length > 0 && (
        <div className="mt-4 border-t border-line-card pt-3">
          {/* THE SEARCH COUNT IS ON SCREEN because it is the unit the bill is
              counted in — web search is charged per search on top of tokens.
              This panel shipped without it while the project look-up showed it,
              and a browser tester noticed before any test could. */}
          <p className="text-sm text-ink-body">
            {`Found in ${searches} ${searches === 1 ? "search" : "searches"}. Nothing is saved yet.`}
            {alreadyKnown > 0 &&
              ` ${alreadyKnown} more ${alreadyKnown === 1 ? "was" : "were"} left out — you already have ${
                alreadyKnown === 1 ? "it" : "them"
              }.`}
          </p>
          <ul className="mt-2 space-y-3">
            {leads.map((one, index) => {
              const lead = one.lead;
              return (
                <li key={`${lead.source.url}-${index}`} className="text-sm">
                  <p className="font-medium text-ink">
                    {lead.fields.projectName}
                  </p>
                  {/* A CLOSE-BUT-NOT-CERTAIN match against what the company already
                  has. An EXACT match never reaches here — the action drops those
                  and counts them, which is the hide/badge asymmetry the Ask
                  command already had and this panel was missing. */}
                  {one.already && (
                    <p className="mt-0.5 text-xs text-ink-body">
                      Looks like{" "}
                      <a
                        href={one.already.href}
                        className="underline hover:text-link"
                      >
                        {one.already.name}
                      </a>
                      ,{" "}
                      {one.already.kind === "pipeline"
                        ? "already on your pipeline"
                        : one.already.kind === "job"
                          ? "already one of your jobs"
                          : "already a logged bid invitation"}
                      . Check before you add it again.
                    </p>
                  )}
                  <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5">
                    {lead.fields.owner && (
                      <>
                        <dt className="text-ink-body">Owner</dt>
                        <dd className="min-w-0 break-words text-ink">
                          {lead.fields.owner}
                        </dd>
                      </>
                    )}
                    {lead.fields.location && (
                      <>
                        <dt className="text-ink-body">Location</dt>
                        <dd className="min-w-0 break-words text-ink">
                          {lead.fields.location}
                        </dd>
                      </>
                    )}
                    {lead.fields.bidDate && (
                      <>
                        <dt className="text-ink-body">Bid date</dt>
                        <dd className="min-w-0 break-words text-ink">
                          {lead.fields.bidDate}
                        </dd>
                      </>
                    )}
                    {lead.fields.sizeText && (
                      <>
                        <dt className="text-ink-body">Size</dt>
                        <dd className="min-w-0 break-words text-ink">
                          {lead.fields.sizeText}
                        </dd>
                      </>
                    )}
                    {lead.fields.deliveryMethod && (
                      <>
                        <dt className="text-ink-body">Delivery</dt>
                        <dd className="min-w-0 break-words text-ink">
                          {lead.fields.deliveryMethod}
                        </dd>
                      </>
                    )}
                    {lead.fields.scopeSummary && (
                      <>
                        <dt className="text-ink-body">Scope</dt>
                        <dd className="min-w-0 break-words text-ink">
                          {lead.fields.scopeSummary}
                        </dd>
                      </>
                    )}
                  </dl>
                  <p className="mt-1 text-xs">
                    <a
                      href={lead.source.url}
                      target="_blank"
                      rel="noopener noreferrer nofollow"
                      className="text-ink-body underline hover:text-link"
                    >
                      {lead.source.title || "source"}
                    </a>
                  </p>

                  {tracking === index ? (
                    <form
                      onSubmit={(event) => {
                        event.preventDefault();
                        const formData = new FormData(event.currentTarget);
                        setSaveError(null);
                        startSaving(async () => {
                          const result = await createBidPursuit(formData);
                          if (!result.ok) {
                            setSaveError(result.error);
                            return;
                          }
                          setTracking(null);
                        });
                      }}
                      className="mt-2 rounded-md border border-line-card p-3"
                    >
                      <p className="mb-3 text-sm text-ink-body">
                        The same form as &ldquo;Add a pursuit&rdquo; below.{" "}
                        {one.bidDay
                          ? "The bid date read as a whole day on the page, so it is filled in — check it against the source before you save."
                          : "The bid date is blank because the page did not state a whole day; what it did say is in the note, for you to read and type."}
                      </p>
                      <BidPursuitFields
                        prefill={{
                          projectName: lead.fields.projectName,
                          owner: lead.fields.owner ?? undefined,
                          note: one.note,
                          // ONLY a whole calendar day, decided on the server by
                          // `readBidDay` — "late spring" leaves this blank and
                          // stays in the note. Matches what the Ask card does.
                          expectedBidDate: one.bidDay ?? undefined,
                        }}
                        minBidDate={localToday()}
                      />
                      {saveError && (
                        <p
                          className="mt-3 rounded-md bg-tag-amber px-3 py-2 text-sm text-tag-amber-ink"
                          role="status"
                        >
                          {saveError}
                        </p>
                      )}
                      <div className="mt-3 flex gap-2">
                        <button
                          type="submit"
                          disabled={isSaving}
                          className="rounded-md bg-brand px-4 py-2 text-sm font-medium text-neutral-900 disabled:opacity-60"
                        >
                          {isSaving ? (
                            <span className="inline-flex items-center gap-1.5">
                              <Spinner />
                              Saving…
                            </span>
                          ) : (
                            "Add to the chase list"
                          )}
                        </button>
                        <button
                          type="button"
                          onClick={() => setTracking(null)}
                          className="rounded-md border border-line-card px-4 py-2 text-sm text-ink hover:bg-surface"
                        >
                          Cancel
                        </button>
                      </div>
                    </form>
                  ) : (
                    <button
                      type="button"
                      onClick={() => {
                        setSaveError(null);
                        setTracking(index);
                      }}
                      className="mt-2 rounded-md border border-line-card px-3 py-1.5 text-sm text-ink hover:bg-surface"
                    >
                      Track this as a pursuit
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </section>
  );
}
