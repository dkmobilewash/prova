"use client";

import { useState, useTransition } from "react";
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
import { BID_PURSUIT_STAGES, STAGE_LABELS, type BidPursuitStage } from "@/lib/bid-pursuits";
import type { PursuitRow } from "@/lib/bid-pursuits-query";
import { money } from "@/lib/money";

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
 */

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
          // almost always a typo. Edit has no floor — a date that has gone by
          // is exactly what "bid date passed, no invite" is for.
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
}: {
  pursuit: PursuitRow;
  invitations: LinkableInvitation[];
  isOwner: boolean;
}) {
  const [mode, setMode] = useState<"view" | "edit" | "link">("view");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const run = (action: () => Promise<{ ok: true } | { ok: false; error: string }>, onOk?: () => void) =>
    startTransition(async () => {
      const result = await action();
      if (result.ok) {
        setError(null);
        onOk?.();
      } else {
        setError(result.error);
      }
    });

  if (mode === "edit") {
    return (
      <li className="p-4">
        <form
          action={(formData) => run(() => updateBidPursuit(pursuit.id, formData), () => setMode("view"))}
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
            action={(formData) =>
              run(
                () => linkBidPursuitToInvitation(pursuit.id, String(formData.get("bidInvitationId") ?? "")),
                () => setMode("view"),
              )
            }
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
              onConfirm={() => run(() => deleteBidPursuit(pursuit.id))}
            />
          ) : undefined
        }
      >
        <label className="sr-only" htmlFor={`stage-${pursuit.id}`}>
          Stage
        </label>
        <select
          id={`stage-${pursuit.id}`}
          value={pursuit.stage}
          disabled={pending}
          onChange={(event) => run(() => setBidPursuitStage(pursuit.id, event.target.value))}
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

  const open = pursuits.filter((p) => p.open);
  const closed = pursuits.filter((p) => !p.open);

  return (
    <section className="mb-10">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="text-sm font-medium text-ink-label">Out chasing — not invited yet</h2>
        {/* Collapsed behind a button, like every list page in this app: a
            form open by default on a page you came to READ is noise. */}
        <button
          type="button"
          onClick={() => {
            setAdding((value) => !value);
            setError(null);
          }}
          className="min-h-11 rounded-md border border-line-card px-3 text-sm text-ink-label hover:border-link hover:text-link"
        >
          {adding ? "Cancel" : "Add a pursuit"}
        </button>
      </div>

      {adding && (
        <form
          data-testid="bid-pursuit-form"
          action={(formData) =>
            startTransition(async () => {
              const result = await createBidPursuit(formData);
              if (result.ok) {
                setError(null);
                setAdding(false);
              } else {
                setError(result.error);
              }
            })
          }
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

      {pursuits.length === 0 ? (
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
              onClick={() => setAdding(true)}
              className="mt-3 text-sm text-link hover:underline"
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
            <ul className="divide-y divide-line-row rounded-lg border border-line-card bg-surface">
              {open.map((pursuit) => (
                <PursuitRowView key={pursuit.id} pursuit={pursuit} invitations={invitations} isOwner={isOwner} />
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
                  <PursuitRowView key={pursuit.id} pursuit={pursuit} invitations={invitations} isOwner={isOwner} />
                ))}
              </ul>
            </details>
          )}
        </>
      )}
    </section>
  );
}
