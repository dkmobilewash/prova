"use client";

import { Spinner } from "@/components/Spinner";
import { useState, useTransition } from "react";
import { createBidPursuit } from "@/lib/actions";
import { lookUpProject } from "@/lib/actions/projectLookup";
import {
  BidPursuitFields,
  type BidPursuitPrefill,
} from "@/components/BidPursuitList";
import { localToday } from "@/components/localToday";
import type { WebSuggestion } from "@/lib/ask/webSuggestions";
import { pursuitPrefillFrom, NOTE_ONLY_FIELDS } from "@/lib/project-lookup";

/**
 * LOOK UP A PROJECT ON THE PUBLIC WEB, THEN START CHASING IT.
 *
 * `BID_RESEARCH` was built, gated and metered in step 0 and had no control
 * anywhere — it ran only inside one Ask command, so using it meant knowing to
 * type a sentence at the assistant. This is the button.
 *
 * WHAT GOES OUT IS ON SCREEN. The two inputs are the whole of what leaves this
 * app: the project name and the location, as typed. `research.ts` enforces that
 * by signature and `projectLookup.ts` restates why. The sentence under the form
 * says so to the person, because a feature that searches the public web on your
 * behalf should not have to be read about in a comment.
 *
 * NOTHING IS SAVED BY LOOKING. The suggestions are returned, not stored, so a
 * lookup nobody acts on leaves no row. Ticking and pressing "Track this" opens
 * the ORDINARY pursuit form, prefilled, and the save goes through
 * `createBidPursuit` — the same action and the same validation the hand-typed
 * form uses. There is no second writer.
 *
 * THE BID DATE IS NEVER PREFILLED INTO THE DATE FIELD, and that is the one place
 * this component deliberately does less than it could. A date printed on a plan
 * room page is not the user's assertion about when their bid is due; it is
 * something a web page said. `BidPursuitFields` says the same thing about its own
 * field, `bid-responsiveness.ts` exists because a wrong bid date is how a bid is
 * rejected unread, and this repo's rule is that dates that matter are ENTERED.
 * So a found bid date is offered as TEXT in the note, with its source, and the
 * person types the date they believe.
 */
export function ProjectLookup() {
  const [found, setFound] = useState<WebSuggestion[] | null>(null);
  const [searches, setSearches] = useState(0);
  const [error, setError] = useState<string | null>(null);
  /** Keys the person has UNticked. Ticked is the default, so an empty set means
   *  "keep everything" — and the browser can only ever remove, which is the
   *  property `webSuggestions.ts` gives the Ask card for the same reason. */
  const [dropped, setDropped] = useState<Set<string>>(new Set());
  const [tracking, setTracking] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [location, setLocation] = useState("");
  const [isPending, startTransition] = useTransition();
  const [isSaving, startSaving] = useTransition();

  const kept = (found ?? []).filter((one) => !dropped.has(one.key));

  /**
   * `onSubmit` + `preventDefault`, NEVER `<form action={fn}>`, and
   * `formActionCensus.test.ts` caught this file doing the wrong one.
   *
   * React 19 resets a client form BEFORE the action resolves, so every refusal
   * this action returns — "Give a city or state as well", the gate's own
   * sentence when an owner has the feature switched off — would have rendered
   * above two fields it had just emptied. The person would be told to add a
   * city with the project name gone too. Nothing here is reset at all: a
   * refusal keeps what was typed so it can be corrected, and a success clears
   * the box from the success branch instead.
   */
  function onLookUp(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    setError(null);
    setSaveError(null);
    setTracking(false);
    setDropped(new Set());
    startTransition(async () => {
      const result = await lookUpProject(formData);
      if (!result.ok) {
        setError(result.error);
        setFound(null);
        return;
      }
      setFound(result.value.suggestions);
      setSearches(result.value.searches);
    });
  }

  const prefill: BidPursuitPrefill = pursuitPrefillFrom(name, kept);

  return (
    <section
      className="mb-6 rounded-lg border border-line-card bg-surface p-4"
      data-pipeline="project-lookup"
    >
      <h2 className="text-sm font-semibold text-ink">Look up a project</h2>
      <p className="mt-1 text-sm text-ink-body">
        Heard about a job and have nothing but a name? This searches the public
        web for who owns it, who designed it, which GCs are bidding and where
        the plans are — and shows the page every answer came from, so you can
        check it yourself.
      </p>

      <form
        onSubmit={onLookUp}
        className="mt-3 grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end"
      >
        <label className="block text-sm">
          <span className="text-ink-label">Project name</span>
          <input
            name="projectName"
            required
            maxLength={200}
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Mercy Clinic expansion"
            className="mt-1 w-full rounded-md border border-line-card bg-surface px-3 py-2 text-sm text-ink placeholder:text-ink-muted"
          />
        </label>
        <label className="block text-sm">
          <span className="text-ink-label">City or state</span>
          <input
            name="location"
            required
            maxLength={200}
            value={location}
            onChange={(event) => setLocation(event.target.value)}
            placeholder="Reno, NV"
            className="mt-1 w-full rounded-md border border-line-card bg-surface px-3 py-2 text-sm text-ink placeholder:text-ink-muted"
          />
        </label>
        <button
          type="submit"
          // #19's shape: disabled in flight, because nothing here is idempotent
          // and a second press is a second billed web search.
          disabled={isPending}
          className="h-10 rounded-md bg-brand px-4 text-sm font-medium text-neutral-900 disabled:opacity-60"
        >
          {isPending ? (
            <span className="inline-flex items-center gap-1.5">
              <Spinner />
              Looking…
            </span>
          ) : (
            "Look it up"
          )}
        </button>
      </form>

      <p className="mt-2 text-xs text-ink-muted">
        Only the name and location you typed above are sent to the search —
        never your company name, your GCs, or anything from your jobs.
      </p>

      {error && (
        <p
          className="mt-3 rounded-md bg-tag-amber px-3 py-2 text-sm text-tag-amber-ink"
          role="status"
        >
          {error}
        </p>
      )}

      {found !== null && found.length === 0 && (
        <p className="mt-3 text-sm text-ink-body" role="status">
          Nothing solid came back for that — {searches}{" "}
          {searches === 1 ? "search" : "searches"} and no fact with a source
          behind it. That is the honest answer rather than a guess. Try the name
          as the owner or architect writes it, or add the city.
        </p>
      )}

      {found !== null && found.length > 0 && (
        <div className="mt-4 border-t border-line-card pt-3">
          <p className="text-sm text-ink-body">
            Found on the web in {searches}{" "}
            {searches === 1 ? "search" : "searches"}. Nothing is saved yet.
            Untick anything you do not believe — every line links the page it
            came from.
          </p>
          <ul className="mt-2 space-y-2">
            {found.map((one) => (
              <li key={one.key} className="text-sm">
                <label className="flex items-start gap-2">
                  <input
                    type="checkbox"
                    checked={!dropped.has(one.key)}
                    onChange={(event) =>
                      setDropped((previous) => {
                        const next = new Set(previous);
                        if (event.target.checked) next.delete(one.key);
                        else next.add(one.key);
                        return next;
                      })
                    }
                    className="mt-1 h-4 w-4 shrink-0"
                  />
                  <span className="min-w-0">
                    <span className="text-ink-label">{one.label}:</span>{" "}
                    <span className="break-words text-ink">{one.value}</span>{" "}
                    <span className="text-xs text-ink-body">
                      {one.sources.map((source, index) => (
                        <span key={source.url}>
                          {index > 0 && " · "}
                          <a
                            href={source.url}
                            target="_blank"
                            rel="noopener noreferrer nofollow"
                            className="underline hover:text-link"
                          >
                            {index === 0 ? "source" : `source ${index + 1}`}
                          </a>
                        </span>
                      ))}
                    </span>
                    {(NOTE_ONLY_FIELDS as readonly string[]).includes(
                      one.key,
                    ) && (
                      <span className="block text-xs text-ink-muted">
                        Goes in the note — the pursuit has no field of its own
                        for this.
                      </span>
                    )}
                    {one.key === "bidDate" && (
                      <span className="block text-xs text-ink-muted">
                        Goes in the note, not the date field. Type the date you
                        believe yourself — a date off a web page is not your bid
                        date.
                      </span>
                    )}
                  </span>
                </label>
              </li>
            ))}
          </ul>

          {!tracking ? (
            <button
              type="button"
              onClick={() => setTracking(true)}
              className="mt-3 rounded-md border border-line-card px-3 py-2 text-sm font-medium text-ink hover:bg-surface"
            >
              Track this as a pursuit
              {kept.length > 0
                ? ` — with the ${kept.length} ticked`
                : " — with nothing filled in"}
            </button>
          ) : (
            <form
              // Same rule as the lookup form above, and it matters more here:
              // `createBidPursuit` refuses a pursuit with no project name, and a
              // reset-then-refuse would throw away every field the person had
              // just checked over before showing them why.
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
                  // The page revalidates and the new row appears in the chase
                  // list below, so this panel goes back to being a search box.
                  setFound(null);
                  setTracking(false);
                  setName("");
                  setLocation("");
                });
              }}
              className="mt-3 rounded-md border border-line-card p-3"
            >
              <p className="mb-3 text-sm text-ink-body">
                Check it over — this is the same form as &ldquo;Add a
                pursuit&rdquo; below, filled in from what you ticked.
              </p>
              <BidPursuitFields prefill={prefill} minBidDate={localToday()} />
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
                  onClick={() => setTracking(false)}
                  className="rounded-md border border-line-card px-4 py-2 text-sm text-ink hover:bg-surface"
                >
                  Cancel
                </button>
              </div>
            </form>
          )}
        </div>
      )}
    </section>
  );
}
