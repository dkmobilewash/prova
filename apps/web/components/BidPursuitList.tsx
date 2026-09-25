"use client";

import { useOptimistic, useRef, useState, useSyncExternalStore, useTransition } from "react";
import Link from "next/link";
import { ConfirmDelete, RowActions } from "@/components/RowActions";
import { localToday } from "@/components/localToday";
import {
  createBidPursuit,
  deleteBidPursuit,
  linkBidPursuitToInvitation,
  setBidPursuitStage,
  updateBidPursuit,
} from "@/lib/actions";
import {
  BID_PURSUIT_STAGES,
  STAGE_LABELS,
  describeOpenPursuitValue,
  isOpenPursuit,
  openPursuitValue,
  type BidPursuitStage,
} from "@/lib/bid-pursuits";
import type { PursuitRow } from "@/lib/bid-pursuits-query";
import { money } from "@/lib/money";
import { ConceptualEstimateHelper } from "@/components/ConceptualEstimateHelper";
import {
  applyPursuitChanges,
  draftPursuit,
  heldOver,
  type HeldChange,
  type PursuitChange,
  type ShownPursuit,
} from "@/components/pursuitListChanges";

/**
 * What we are out chasing that nobody has invited us to bid yet.
 *
 * A client component rather than a server one with bound actions, for the
 * reason lib/actions/shared.ts exists: the actions RETURN their failures, and
 * "that invitation is already linked to another pursuit" is useless if
 * nothing renders it.
 *
 * RENDERED FROM PROPS, NEVER FROM A useState COPY. #304 shipped a list held
 * in `useState(rows)` and a successful create showed an empty list, because
 * useState ignores its argument after the first render. Every action here
 * revalidates /pipeline, which re-renders this with fresh props.
 *
 * WHAT IT DOES SHOW ON TOP OF THEM, and only until they catch up: the row a
 * save is making. The refreshed props arrive seconds after the action says
 * `ok` (see components/pursuitListChanges.ts), and in that gap the list used
 * to say "Nothing on the chase list yet" under a form that had just closed
 * — an invitation to click Save again. `useOptimistic` puts the typed row in
 * the list, marked "saving…", while the action is in flight, and takes it
 * away again if the action refuses; a confirmed change is then HELD against
 * the props it was made over, and dropped the moment the page's own list
 * replaces them. The props are still the truth — the held copy never
 * outlives one refresh.
 */

/** Ids for rows drawn from a form before the server has made the record. */
const DRAFT_ID_PREFIX = "saving-";

/** True in the browser once React has hydrated; false in server markup and
 * during hydration. A button whose onClick only exists after hydration is
 * rendered disabled until then, so a click that lands before it is visibly
 * refused instead of silently vanishing. */
const noSubscription = () => () => {};
function useHydrated(): boolean {
  return useSyncExternalStore(
    noSubscription,
    () => true,
    () => false,
  );
}

/** Starts holding a change made over the list that is on screen NOW; call
 * the returned function once the server has confirmed it. */
type BeginHold = () => (change: PursuitChange) => void;
/** Shows a change while its action is in flight (useOptimistic's setter). */
type ShowInFlight = (change: PursuitChange) => void;

export type LinkableInvitation = { id: string; label: string };

const STAGE_STYLE: Record<BidPursuitStage, string> = {
  WATCHING: "bg-neutral-800 text-ink-label",
  CONTACTED: "bg-tag-blue text-tag-blue-ink",
  EXPECTING_INVITE: "bg-tag-amber text-tag-amber-ink",
  INVITED: "bg-tag-green text-tag-green-ink",
  DROPPED: "bg-neutral-800 text-ink-muted",
};

const inputClass =
  "mt-1 w-full rounded-md border border-line-card bg-surface px-3 py-2 text-sm text-ink placeholder:text-ink-muted";

/** The one set of fields, for create AND edit — the list-page convention,
 * so the two forms cannot drift apart. */
function BidPursuitFields({ pursuit, minBidDate }: { pursuit?: PursuitRow; minBidDate?: string }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <label className="block text-sm sm:col-span-2">
        <span className="text-ink-label">Project</span>
        <input
          name="projectName"
          required
          maxLength={200}
          defaultValue={pursuit?.projectName}
          placeholder="St. Mary's Hospital east wing"
          className={inputClass}
        />
      </label>
      <label className="block text-sm">
        <span className="text-ink-label">Owner / developer (optional)</span>
        <input name="owner" maxLength={200} defaultValue={pursuit?.owner ?? ""} className={inputClass} />
      </label>
      <label className="block text-sm">
        <span className="text-ink-label">Architect (optional)</span>
        <input name="architect" maxLength={200} defaultValue={pursuit?.architect ?? ""} className={inputClass} />
      </label>
      <label className="block text-sm">
        <span className="text-ink-label">Expected GC(s) (optional)</span>
        <input
          name="expectedGcs"
          maxLength={300}
          defaultValue={pursuit?.expectedGcs ?? ""}
          placeholder="Nobody yet, or e.g. Turner, McCarthy"
          className={inputClass}
        />
      </label>
      <label className="block text-sm">
        <span className="text-ink-label">Stage</span>
        <select name="stage" defaultValue={pursuit?.stage ?? "WATCHING"} className={inputClass}>
          {BID_PURSUIT_STAGES.map((stage) => (
            <option key={stage} value={stage}>
              {STAGE_LABELS[stage]}
            </option>
          ))}
        </select>
      </label>
      <label className="block text-sm">
        <span className="text-ink-label">Expected bid date (optional)</span>
        <input
          type="date"
          name="expectedBidDate"
          defaultValue={pursuit?.expectedBidDate ?? ""}
          // NOT pre-filled: an expected bid date is somebody's estimate, and
          // today is never the right guess. On create the USER'S today is the
          // floor, since a new pursuit expecting a bid that already passed is
          // almost always a typo. "Passed" on /pipeline and in the Ask tool is
          // judged on the same calendar — viewerToday(), off the browser's own
          // zone cookie — so a date this floor allows does not read as passed
          // the moment it is saved. (Before that cookie exists, on a brand-new
          // browser's first page, viewerToday falls back to a geo-IP guess or
          // UTC and the two can differ by a day.) Edit has no floor — a date
          // that has gone by is exactly what "bid date passed, no invite" is for.
          min={minBidDate}
          className={inputClass}
        />
      </label>
      <label className="block text-sm">
        <span className="text-ink-label">Estimated value of our scope (optional)</span>
        <input
          name="estimatedValue"
          inputMode="decimal"
          defaultValue={pursuit?.estimatedValue ?? ""}
          placeholder="250,000"
          className={inputClass}
        />
        {/* BESIDE the field, never inside it. The helper fills in nothing —
            see ConceptualEstimateHelper for why a button that wrote into
            this field would make the pipeline total part guess and part
            quote, with nothing saying which rows were which. */}
        <span className="mt-1 block">
          <ConceptualEstimateHelper />
        </span>
      </label>
      <label className="block text-sm sm:col-span-2">
        <span className="text-ink-label">Note (optional)</span>
        <input
          name="note"
          maxLength={500}
          defaultValue={pursuit?.note ?? ""}
          placeholder="Met their PM at the AGC dinner; bid docs expected in spring"
          className={inputClass}
        />
      </label>
    </div>
  );
}

function PursuitRowView({
  pursuit,
  invitations,
  isOwner,
  beginHold,
  showInFlight,
  reportRefusal,
}: {
  pursuit: ShownPursuit;
  invitations: LinkableInvitation[];
  isOwner: boolean;
  beginHold: BeginHold;
  showInFlight: ShowInFlight;
  /** A refusal for a change that moved or removed this row on screen: the
   * row may have remounted in the other list, or be gone, by the time the
   * answer arrives, so its own error line could never be seen. */
  reportRefusal: (error: string) => void;
}) {
  const [mode, setMode] = useState<"view" | "edit" | "link">("view");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  // Bumped when a stage change is refused, to remount the (uncontrolled)
  // stage select back onto the saved stage. See the select below.
  const [stageRevert, setStageRevert] = useState(0);

  const run = (
    action: () => Promise<{ ok: true } | { ok: false; error: string }>,
    onOk?: () => void,
    onFail?: (error: string) => void,
    // Shown the moment the action starts, not when it answers — the answer
    // alone took 1.5s+ and the refreshed list seconds more. React withdraws
    // it when this transition ends; onOk holds it until the list catches up.
    inFlight?: PursuitChange,
  ) =>
    startTransition(async () => {
      if (inFlight) showInFlight(inFlight);
      const result = await action();
      if (result.ok) {
        setError(null);
        onOk?.();
      } else {
        setError(result.error);
        onFail?.(result.error);
      }
    });

  if (mode === "edit") {
    return (
      <li className="p-4">
        {/* onSubmit + preventDefault, NOT `action={…}`: React's form-action
            path resets the form before the action even runs, so a refused
            save ("Estimated value must be a number…") would arrive on a form
            that had already thrown away what was typed. Nothing is reset
            here on success either — the form closes. */}
        <form
          onSubmit={(event) => {
            event.preventDefault();
            const formData = new FormData(event.currentTarget);
            const hold = beginHold();
            const edited: PursuitChange = {
              kind: "edit",
              row: draftPursuit(formData, localToday(), { id: pursuit.id, invitation: pursuit.invitation }),
            };
            run(
              () => updateBidPursuit(pursuit.id, formData),
              () => {
                setMode("view");
                hold(edited);
              },
              undefined,
              edited,
            );
          }}
          className="space-y-3"
        >
          <BidPursuitFields pursuit={pursuit} />
          {error && (
            <p className="text-sm text-tag-rose-ink" role="alert">
              {error}
            </p>
          )}
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={pending}
              className="min-h-11 rounded-md bg-brand px-4 text-sm font-semibold text-neutral-900 hover:bg-yellow-500 disabled:opacity-50"
            >
              {pending ? "Saving…" : "Save"}
            </button>
            <button
              type="button"
              onClick={() => {
                setMode("view");
                setError(null);
              }}
              className="min-h-11 rounded-md border border-line-card px-4 text-sm text-ink-label hover:bg-neutral-800"
            >
              Cancel
            </button>
          </div>
        </form>
      </li>
    );
  }

  const details = [
    pursuit.owner && `Owner ${pursuit.owner}`,
    pursuit.architect && `Architect ${pursuit.architect}`,
    pursuit.expectedGcs ? `GC ${pursuit.expectedGcs}` : "No GC yet",
    pursuit.estimatedValue !== null ? `about ${money(pursuit.estimatedValue)}` : null,
  ].filter(Boolean);

  return (
    <li className="flex flex-col gap-2 p-4 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium text-ink">{pursuit.projectName}</span>
          <span className={`rounded px-1.5 py-0.5 text-xs ${STAGE_STYLE[pursuit.stage]}`}>
            {STAGE_LABELS[pursuit.stage]}
          </span>
          {pursuit.saving && (
            <span data-testid="pursuit-saving" className="text-xs italic text-ink-muted">
              saving…
            </span>
          )}
          {pursuit.bidDatePassed && (
            <span className="rounded bg-tag-rose px-1.5 py-0.5 text-xs text-tag-rose-ink">
              bid date passed, no invite
            </span>
          )}
          {pursuit.bidDateComingUp && (
            <span className="rounded bg-tag-amber px-1.5 py-0.5 text-xs text-tag-amber-ink">bid date soon</span>
          )}
          {pursuit.goneQuiet && (
            <span className="rounded bg-neutral-800 px-1.5 py-0.5 text-xs text-ink-muted">
              untouched {pursuit.daysSinceUpdate} days
            </span>
          )}
        </div>
        <p className="mt-1 text-sm text-ink-body">
          {details.join(" · ")}
          {pursuit.expectedBidDate && <> · bid expected {pursuit.expectedBidDate}</>}
        </p>
        {pursuit.invitation && (
          <p className="mt-1 text-sm text-ink-body">
            Became the invitation{" "}
            <Link href={`/contacts/${pursuit.invitation.contactId}`} className="text-link hover:underline">
              {pursuit.invitation.projectName} from {pursuit.invitation.contactName}
            </Link>
          </p>
        )}
        {pursuit.note && <p className="mt-1 text-sm text-ink-muted">{pursuit.note}</p>}

        {mode === "link" && (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              const formData = new FormData(event.currentTarget);
              run(
                () => linkBidPursuitToInvitation(pursuit.id, String(formData.get("bidInvitationId") ?? "")),
                () => setMode("view"),
              );
            }}
            className="mt-3 flex flex-wrap items-end gap-2"
          >
            <label className="block text-sm">
              <span className="text-ink-label">The invitation it became</span>
              <select name="bidInvitationId" defaultValue={pursuit.invitation?.id ?? ""} className={inputClass}>
                <option value="">{pursuit.invitation ? "Unlink — not this one" : "Pick an invitation"}</option>
                {pursuit.invitation && (
                  <option value={pursuit.invitation.id}>
                    {pursuit.invitation.projectName} — {pursuit.invitation.contactName}
                  </option>
                )}
                {invitations.map((inv) => (
                  <option key={inv.id} value={inv.id}>
                    {inv.label}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="submit"
              disabled={pending}
              className="min-h-11 rounded-md border border-line-card px-3 text-sm text-ink-label hover:border-link hover:text-link disabled:opacity-50"
            >
              {pending ? "Saving…" : "Save link"}
            </button>
            <button
              type="button"
              onClick={() => {
                setMode("view");
                setError(null);
              }}
              className="min-h-11 rounded-md border border-line-card px-3 text-sm text-ink-label hover:bg-neutral-800"
            >
              Cancel
            </button>
            {invitations.length === 0 && !pursuit.invitation && (
              <p className="w-full text-xs text-ink-muted">
                No unlinked invitations on file. Log the invitation on the GC&apos;s contact page first.
              </p>
            )}
          </form>
        )}

        {error && (
          <p className="mt-2 text-sm text-tag-rose-ink" role="alert">
            {error}
          </p>
        )}
      </div>

      {/* A row drawn from the create form has no id the server knows, so
          it has nothing to act on yet. Its real row replaces it in seconds. */}
      {!pursuit.id.startsWith(DRAFT_ID_PREFIX) && (
        <RowActions
          className="flex shrink-0 flex-wrap items-center gap-2"
          destructive={
            isOwner ? (
              <ConfirmDelete
                label="Delete"
                confirmLabel="Delete it"
                describe={`Deletes the pursuit "${pursuit.projectName}" for good. To stop chasing it but keep the record, set it to Dropped instead. A linked bid invitation is not touched.`}
                pinned="end"
                pending={pending}
                onConfirm={() => {
                  const hold = beginHold();
                  const removed: PursuitChange = { kind: "remove", id: pursuit.id };
                  run(
                    () => deleteBidPursuit(pursuit.id),
                    () => hold(removed),
                    // The row left the screen when the delete started.
                    (reason) => reportRefusal(`"${pursuit.projectName}" was not deleted. ${reason}`),
                    removed,
                  );
                }}
              />
            ) : undefined
          }
        >
          <label className="sr-only" htmlFor={`stage-${pursuit.id}`}>
            Stage
          </label>
          {/* UNCONTROLLED, keyed on the saved stage. A controlled
              `value={pursuit.stage}` snapped straight back to the old stage
              and sat there, disabled, until the refreshed page arrived
              (1.5-4.4s here) — which reads as a change that failed. Now the
              choice shows at once; the refreshed props change the key and
              remount it on what was saved, and a refusal bumps `stageRevert`
              to put the saved stage back beside the reason. */}
          <select
            key={`${pursuit.stage}:${stageRevert}`}
            id={`stage-${pursuit.id}`}
            defaultValue={pursuit.stage}
            disabled={pending}
            onChange={(event) => {
              const next = event.target.value as BidPursuitStage;
              const hold = beginHold();
              // Shown at once and held after, so a move to Invited or Dropped
              // leaves the open list on the click, not when the page refreshes.
              const moved: PursuitChange = {
                kind: "edit",
                row: { ...pursuit, stage: next, open: isOpenPursuit(next), saving: true },
              };
              run(
                () => setBidPursuitStage(pursuit.id, next),
                () => hold(moved),
                (reason) => {
                  setStageRevert((n) => n + 1);
                  // A move between the open and closed lists remounted this
                  // row, so say it where it will be seen.
                  if (moved.kind === "edit" && moved.row.open !== pursuit.open) {
                    reportRefusal(`"${pursuit.projectName}" was not moved. ${reason}`);
                  }
                },
                moved,
              );
            }}
            className="rounded-md border border-line-card bg-surface px-2 py-1.5 text-xs text-ink-label"
          >
            {BID_PURSUIT_STAGES.map((stage) => (
              <option key={stage} value={stage}>
                {STAGE_LABELS[stage]}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => {
              setMode("edit");
              setError(null);
            }}
            className="rounded-md border border-line-card px-3 py-1.5 text-xs text-ink-label hover:bg-neutral-800"
          >
            Edit
          </button>
          <button
            type="button"
            onClick={() => {
              setMode(mode === "link" ? "view" : "link");
              setError(null);
            }}
            className="rounded-md border border-line-card px-3 py-1.5 text-xs text-ink-label hover:bg-neutral-800"
          >
            {pursuit.invitation ? "Change link" : "Link invite"}
          </button>
        </RowActions>
      )}
    </li>
  );
}

export function BidPursuitList({
  pursuits,
  invitations,
  isOwner,
}: {
  pursuits: PursuitRow[];
  invitations: LinkableInvitation[];
  isOwner: boolean;
}) {
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const hydrated = useHydrated();
  const drafts = useRef(0);

  // Confirmed saves the refreshed props have not caught up with yet.
  const [held, setHeld] = useState<HeldChange[]>([]);
  // A row change refused after its row had already moved or left the screen.
  const [rowRefusal, setRowRefusal] = useState<string | null>(null);
  const settled = applyPursuitChanges(pursuits, heldOver(held, pursuits));
  // Plus, while an action is in flight, the row it is making.
  const [shown, showInFlight] = useOptimistic(settled, (rows: ShownPursuit[], change: PursuitChange) =>
    applyPursuitChanges(rows, [change]),
  );
  const beginHold: BeginHold = () => {
    const basis = pursuits;
    return (change) => setHeld((current) => [...heldOver(current, basis), { ...change, basis }]);
  };

  const open = shown.filter((p) => p.open);
  const closed = shown.filter((p) => !p.open);
  // The same sum the bid_pursuits Ask tool reports — openPursuitValue is the
  // only one. Over the rows on screen, so the line and the list agree while
  // a save is on its way; the server's figure replaces it with the list.
  const valueLine = describeOpenPursuitValue(openPursuitValue(shown));

  return (
    <section className="mb-10" data-tour="pipeline-chase-list">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-medium text-ink-label">Out chasing — not invited yet</h2>
          {valueLine && (
            <p data-testid="bid-pursuit-total" className="mt-0.5 text-sm text-ink-body">
              {valueLine}
            </p>
          )}
        </div>
        {/* Collapsed behind a button, like every list page in this app: a
            form open by default on a page you came to READ is noise. */}
        <button
          type="button"
          disabled={!hydrated}
          data-tour="pipeline-add-pursuit"
          onClick={() => {
            setAdding((value) => !value);
            setError(null);
          }}
          className="min-h-11 rounded-md border border-line-card px-3 text-sm text-ink-label hover:border-link hover:text-link disabled:opacity-50"
        >
          {adding ? "Cancel" : "Add a pursuit"}
        </button>
      </div>

      {adding && (
        // onSubmit, not `action={…}` — see the edit form above. On a refusal
        // everything typed stays; on success the form closes.
        <form
          data-testid="bid-pursuit-form"
          onSubmit={(event) => {
            event.preventDefault();
            const formData = new FormData(event.currentTarget);
            const draft = draftPursuit(formData, localToday(), {
              id: `${DRAFT_ID_PREFIX}${(drafts.current += 1)}`,
              invitation: null,
            });
            const hold = beginHold();
            startTransition(async () => {
              // In the list at once, marked "saving…"; withdrawn by React
              // when this transition ends unless it is held below.
              showInFlight({ kind: "create", row: draft });
              const result = await createBidPursuit(formData);
              if (result.ok) {
                hold({ kind: "create", row: draft });
                setError(null);
                setAdding(false);
              } else {
                setError(result.error);
              }
            });
          }}
          className="mb-4 space-y-3 rounded-lg border border-line-card bg-surface p-4"
        >
          {/* localToday(), not the server's day: at 17:00 in Los Angeles UTC
              is already tomorrow. Safe to call during render because this
              form only exists after a click, so it is never in
              server-rendered markup and cannot break hydration. */}
          <BidPursuitFields minBidDate={localToday()} />
          {error && (
            <p className="text-sm text-tag-rose-ink" role="alert">
              {error}
            </p>
          )}
          <button
            type="submit"
            disabled={pending}
            className="min-h-11 rounded-md bg-brand px-4 text-sm font-semibold text-neutral-900 hover:bg-yellow-500 disabled:opacity-50"
          >
            {pending ? "Adding…" : "Add pursuit"}
          </button>
        </form>
      )}

      {rowRefusal && (
        <p className="mb-3 text-sm text-tag-rose-ink" role="alert">
          {rowRefusal}{" "}
          <button type="button" onClick={() => setRowRefusal(null)} className="underline">
            Dismiss
          </button>
        </p>
      )}

      {shown.length === 0 ? (
        <div className="rounded-lg border border-line-card bg-surface p-6">
          <p className="text-ink-label">Nothing on the chase list yet.</p>
          <p className="mt-2 max-w-xl text-sm text-ink-body">
            This is the work you know is coming before any GC has asked you to price it — a project
            the owner has announced, an architect you have been talking to, a GC you expect to hear
            from. Nothing fills it in for you: it only knows what somebody here types. When the
            invitation arrives, log it on the GC&apos;s contact page and link it back here.
          </p>
          {!adding && (
            <button
              type="button"
              disabled={!hydrated}
              onClick={() => setAdding(true)}
              className="mt-3 text-sm text-link hover:underline disabled:opacity-50"
            >
              Add the first one
            </button>
          )}
        </div>
      ) : (
        <>
          {open.length === 0 ? (
            <p className="rounded-lg border border-line-card bg-surface p-4 text-sm text-ink-body">
              Nothing open — every pursuit on file has been invited or dropped.
            </p>
          ) : (
            <ul className="divide-y divide-line-row rounded-lg border border-line-card bg-surface" data-tour="pipeline-open-pursuits">
              {open.map((pursuit) => (
                <PursuitRowView
                  key={pursuit.id}
                  pursuit={pursuit}
                  invitations={invitations}
                  isOwner={isOwner}
                  beginHold={beginHold}
                  showInFlight={showInFlight}
                  reportRefusal={setRowRefusal}
                />
              ))}
            </ul>
          )}
          {closed.length > 0 && (
            <details className="mt-3">
              <summary className="cursor-pointer text-sm text-ink-body">
                Invited or dropped ({closed.length})
              </summary>
              <ul className="mt-2 divide-y divide-line-row rounded-lg border border-line-card bg-surface">
                {closed.map((pursuit) => (
                  <PursuitRowView
                  key={pursuit.id}
                  pursuit={pursuit}
                  invitations={invitations}
                  isOwner={isOwner}
                  beginHold={beginHold}
                  showInFlight={showInFlight}
                  reportRefusal={setRowRefusal}
                />
                ))}
              </ul>
            </details>
          )}
        </>
      )}
    </section>
  );
}
