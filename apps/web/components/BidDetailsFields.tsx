import { TRADE_SCOPE_OPTIONS } from "@/lib/trade-scopes";
import { timeInputValue } from "@/lib/bid-dates";

const field =
  "rounded-md border border-line-card bg-canvas px-3 py-2 text-base text-ink placeholder:text-ink-muted focus:border-link focus:outline-none sm:text-sm";

/** What the fields start with. Every value is a string a form input
 * round-trips (a date as YYYY-MM-DD, a time as HH:MM) so the create form
 * passes nothing and the edit form passes the stored row. */
export type BidDetailsDefaults = {
  projectName?: string;
  tradeScope?: string | null;
  dueDate?: string | null;
  dueMinute?: number | null;
  walkDate?: string | null;
  walkMinute?: number | null;
  rfiCutoffDate?: string | null;
  bidAmount?: string | null;
  notes?: string | null;
};

/**
 * The bid-details inputs, ONE component for create AND edit (the list-page
 * convention): project, trade, due day + time, job walk day + time, RFI cutoff,
 * amount, notes. Field names are the ones `createBidInvitation` and
 * `updateBidInvitationDetails` both read, so the two forms cannot drift.
 *
 * Deliberately has no "use client" and no state: plain uncontrolled inputs,
 * safe to render from either side. Times are WALL-CLOCK (see lib/bid-dates.ts)
 * — the label says so rather than leaving a reader to wonder which zone.
 */
export function BidDetailsFields({ defaults = {} }: { defaults?: BidDetailsDefaults }) {
  return (
    <>
      <label className="flex flex-col gap-1 text-sm text-ink-label">
        Project name
        <input
          name="projectName"
          required
          autoComplete="off"
          defaultValue={defaults.projectName ?? ""}
          placeholder="Downtown office build-out…"
          className={field}
        />
      </label>
      <label className="flex flex-col gap-1 text-sm text-ink-label">
        Trade
        <select name="tradeScope" defaultValue={defaults.tradeScope ?? ""} className={field}>
          <option value="">No trade tag</option>
          {TRADE_SCOPE_OPTIONS.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-sm text-ink-label">
        Bid due date
        <input name="dueDate" type="date" defaultValue={defaults.dueDate ?? ""} className={field} />
      </label>
      <label className="flex flex-col gap-1 text-sm text-ink-label">
        Due time (as the GC wrote it)
        <input name="dueTime" type="time" defaultValue={timeInputValue(defaults.dueMinute)} className={field} />
      </label>
      <label className="flex flex-col gap-1 text-sm text-ink-label">
        Job walk date
        <input name="walkDate" type="date" defaultValue={defaults.walkDate ?? ""} className={field} />
      </label>
      <label className="flex flex-col gap-1 text-sm text-ink-label">
        Job walk time
        <input name="walkTime" type="time" defaultValue={timeInputValue(defaults.walkMinute)} className={field} />
      </label>
      <label className="flex flex-col gap-1 text-sm text-ink-label">
        RFI cutoff date
        <input name="rfiCutoffDate" type="date" defaultValue={defaults.rfiCutoffDate ?? ""} className={field} />
      </label>
      <label className="flex flex-col gap-1 text-sm text-ink-label">
        Bid $ (if known)
        <input
          name="bidAmount"
          type="text"
          inputMode="decimal"
          autoComplete="off"
          defaultValue={defaults.bidAmount ?? ""}
          placeholder="Optional"
          className={`w-28 ${field}`}
        />
      </label>
      <label className="flex min-w-[180px] flex-1 flex-col gap-1 text-sm text-ink-label">
        Notes
        <input name="notes" autoComplete="off" defaultValue={defaults.notes ?? ""} placeholder="Optional" className={field} />
      </label>
    </>
  );
}
