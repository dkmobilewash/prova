"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  createBidInvitation,
  deleteBidInvitation,
  updateBidInvitationStatus,
} from "@/lib/actions";
import { money } from "@/lib/money";
import { TRADE_SCOPE_OPTIONS, tradeScopeLabel } from "@/lib/trade-scopes";

/**
 * Bid invitations on a contact: log one, record its outcome, remove one.
 *
 * A client component so the actions can REPORT rather than throw. Production
 * redacts a thrown Server Action message to a digest, so "Project name is
 * required" reached a real user as a reference number.
 *
 * Two things changed about what the form asks for, both from #133. Status and
 * Bid $ are on the create form, so a bid already submitted — or already won —
 * can be logged in one pass instead of created and then found again. Both
 * default to blank, which means the row falls to INVITED with no amount:
 * nothing is invented for a field nobody filled in.
 */

const inputClass =
  "rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100 placeholder:text-slate-500 focus:border-blue-500 focus:outline-none";
const labelClass = "flex flex-col gap-1 text-sm text-slate-300";

const BID_STATUS_OPTIONS = [
  { value: "INVITED", label: "Invited" },
  { value: "SUBMITTED", label: "Submitted" },
  { value: "WON", label: "Won" },
  { value: "LOST", label: "Lost" },
  { value: "DECLINED", label: "Declined" },
] as const;

const BID_STATUS_STYLE: Record<string, string> = {
  INVITED: "bg-slate-800 text-slate-300",
  SUBMITTED: "bg-blue-500/15 text-blue-300",
  WON: "bg-green-500/15 text-green-300",
  LOST: "bg-red-950 text-red-400",
  DECLINED: "bg-slate-800 text-slate-500",
};

export type BidInvitationView = {
  id: string;
  projectName: string;
  status: string;
  tradeScope: string | null;
  /** UTC-midnight day as an ISO date, or null. */
  dueDate: string | null;
  /** The amount bid, or null for "nobody has recorded one" — never 0. */
  bidAmount: string | null;
  notes: string | null;
};

/** Rendered in UTC. The stored value is UTC midnight, so local rendering
 * shows the previous day for anyone west of UTC — a bid due Friday that
 * reads Thursday is a worse error than an ugly date. */
function formatDueDate(iso: string) {
  return new Date(`${iso}T00:00:00.000Z`).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

/**
 * One invitation, with its outcome controls and a two-step delete.
 *
 * The delete used to be a single click on a bare button beside "Update",
 * with no confirm and no undo. What it removes is evidence: a won bid is
 * what /pipeline computes a win rate from and what the AI drafts are
 * grounded in, so a misclick quietly changes the record of how this GC
 * has treated us. Every other list in the app asks twice.
 */
function BidRow({ bid }: { bid: BidInvitationView }) {
  const router = useRouter();
  const [isConfirming, setIsConfirming] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function submitUpdate(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    const formData = new FormData(event.currentTarget);
    startTransition(async () => {
      try {
        const result = await updateBidInvitationStatus(bid.id, formData);
        if (!result.ok) {
          setError(result.error);
          return;
        }
        router.refresh();
      } catch {
        setError("Could not update this bid");
      }
    });
  }

  function handleDelete() {
    setError(null);
    startTransition(async () => {
      try {
        const result = await deleteBidInvitation(bid.id);
        if (!result.ok) {
          setError(result.error);
          return;
        }
        setIsConfirming(false);
        router.refresh();
      } catch {
        setError("Could not delete this bid");
      }
    });
  }

  return (
    <li className="flex flex-wrap items-center justify-between gap-3 py-3">
      <div>
        <div className="flex items-center gap-2">
          <p className="font-medium text-slate-100">{bid.projectName}</p>
          <span
            className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${BID_STATUS_STYLE[bid.status]}`}
          >
            {BID_STATUS_OPTIONS.find((o) => o.value === bid.status)?.label ?? bid.status}
          </span>
        </div>
        <p className="text-sm text-slate-400">
          {bid.tradeScope && <>{tradeScopeLabel(bid.tradeScope)} · </>}
          {bid.dueDate && <>Due {formatDueDate(bid.dueDate)}</>}
        </p>
        {/* Absent, not zero. A bid nobody has priced shows no figure at
            all rather than $0.00. */}
        {bid.bidAmount != null && (
          <p className="text-sm text-slate-300">{money(Number(bid.bidAmount))}</p>
        )}
        {bid.notes && <p className="text-sm text-slate-500">{bid.notes}</p>}
        {error && <p className="mt-1 text-sm text-red-400">{error}</p>}
      </div>

      <div className="flex items-center gap-2">
        <form onSubmit={submitUpdate} className="flex items-center gap-2">
          <select
            key={bid.status}
            name="status"
            defaultValue={bid.status}
            className="rounded-md border border-slate-700 bg-slate-950 px-2 py-1 text-sm text-slate-100 focus:border-blue-500 focus:outline-none"
          >
            {BID_STATUS_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          <input
            name="bidAmount"
            defaultValue={bid.bidAmount ?? ""}
            placeholder="Bid $"
            title="Amount bid, once known. Blank means not recorded."
            className="w-24 rounded-md border border-slate-700 bg-slate-950 px-2 py-1 text-sm text-slate-100 placeholder:text-slate-600 focus:border-blue-500 focus:outline-none"
          />
          <button
            type="submit"
            disabled={isPending}
            className="rounded-md bg-slate-800 px-2 py-1 text-xs font-medium text-slate-100 hover:bg-slate-700 disabled:opacity-50"
          >
            {isPending ? "Saving…" : "Update"}
          </button>
        </form>

        {isConfirming ? (
          <div className="flex flex-col items-end gap-1">
            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={isPending}
                onClick={handleDelete}
                className="rounded-md border border-red-500 px-2 py-1 text-xs text-red-400 hover:bg-red-500/10 disabled:opacity-50"
              >
                {isPending ? "Deleting…" : "Confirm delete"}
              </button>
              <button
                type="button"
                disabled={isPending}
                onClick={() => {
                  setIsConfirming(false);
                  setError(null);
                }}
                className="rounded-md border border-slate-700 px-2 py-1 text-xs text-slate-300 hover:border-slate-500 disabled:opacity-50"
              >
                Cancel
              </button>
            </div>
            <p className="max-w-[18rem] text-right text-xs text-amber-300">
              {bid.status === "WON"
                ? "This is a won bid. Deleting it removes it from your win rate with this GC, permanently."
                : "Deleted for good — bid history is what win rates and past pricing are read from."}
            </p>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setIsConfirming(true)}
            className="text-xs text-slate-400 hover:text-red-400 hover:underline"
          >
            Delete
          </button>
        )}
      </div>
    </li>
  );
}

export function BidInvitations({
  contactId,
  contactName,
  bids,
}: {
  contactId: string;
  contactName: string;
  bids: BidInvitationView[];
}) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function submitCreate(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    const form = event.currentTarget;
    const formData = new FormData(form);
    startTransition(async () => {
      try {
        const result = await createBidInvitation(contactId, formData);
        if (!result.ok) {
          setError(result.error);
          return;
        }
        formRef.current?.reset();
        router.refresh();
      } catch {
        setError("Could not log this invitation");
      }
    });
  }

  return (
    <section className="mb-10 rounded-lg border border-slate-800 bg-slate-900 p-6">
      <h2 className="mb-3 text-lg font-semibold text-slate-100">Bid invitations</h2>

      {bids.length === 0 ? (
        <p className="mb-4 text-sm text-slate-400">
          No bid invitations logged from {contactName} yet.
        </p>
      ) : (
        <ul className="mb-4 divide-y divide-slate-800 border-y border-slate-800">
          {bids.map((bid) => (
            <BidRow key={bid.id} bid={bid} />
          ))}
        </ul>
      )}

      <form ref={formRef} onSubmit={submitCreate} className="flex flex-wrap items-end gap-3">
        <label className={labelClass}>
          Project name
          <input
            name="projectName"
            required
            placeholder="Downtown office build-out"
            className={inputClass}
          />
        </label>
        <label className={labelClass}>
          Trade
          <select name="tradeScope" defaultValue="" className={inputClass}>
            <option value="">No trade tag</option>
            {TRADE_SCOPE_OPTIONS.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
        </label>
        <label className={labelClass}>
          Bid due date
          <input name="dueDate" type="date" className={inputClass} />
        </label>
        <label className={labelClass}>
          Status
          {/* Blank on purpose: an invitation you are simply logging has no
              outcome yet, and the row falls to INVITED on its own. */}
          <select name="status" defaultValue="" className={inputClass}>
            <option value="">Invited (not bid yet)</option>
            {BID_STATUS_OPTIONS.filter((o) => o.value !== "INVITED").map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <label className={labelClass}>
          Bid $
          <input
            name="bidAmount"
            placeholder="if already bid"
            title="What you bid, if you already have. Leave blank if you haven't."
            className={`${inputClass} w-32`}
          />
        </label>
        <label className="flex flex-1 min-w-[180px] flex-col gap-1 text-sm text-slate-300">
          Notes
          <input name="notes" placeholder="Optional" className={inputClass} />
        </label>
        <button
          type="submit"
          disabled={isPending}
          className="inline-flex items-center justify-center rounded-md bg-slate-800 px-4 py-2 text-sm font-medium text-slate-100 hover:bg-slate-700 disabled:opacity-50"
        >
          {isPending ? "Logging…" : "Log invitation"}
        </button>
        {error && <p className="w-full text-sm text-red-400">{error}</p>}
      </form>
    </section>
  );
}
