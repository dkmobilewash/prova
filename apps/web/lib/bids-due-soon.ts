/**
 * The /bids "Due soon" view: invited bids due in the next DUE_SOON_DAYS days,
 * soonest first, with the days left. Read-only over BidInvitation — nothing
 * here touches a bid's status, outcome or decline.
 *
 * ux round 4: "which bids are due in the next 30 days" meant reading every
 * row of an unsorted ten-row history, because /bids had no other view.
 */
import { upcomingBidDates, type UpcomingBidDate } from "@/lib/bid-dates";

export const DUE_SOON_DAYS = 30;

export type DueSoonBid = {
  id: string;
  projectName: string;
  gcName: string;
  dueIso: string;
  /** Wall-clock minutes after midnight, when the invitation named a time. */
  dueMinute: number | null;
  daysLeft: number;
  /** A job walk or RFI cutoff in the next 7 days — see lib/bid-dates.ts. */
  upcoming: UpcomingBidDate[];
};

/** Whole days from `todayIso` to `dueIso`, both YYYY-MM-DD at UTC midnight. */
const daysFrom = (todayIso: string, dueIso: string) =>
  Math.round((Date.parse(`${dueIso}T00:00:00.000Z`) - Date.parse(`${todayIso}T00:00:00.000Z`)) / 86_400_000);

/** `todayIso` is the viewer's calendar day (viewerToday()). */
export function bidsDueSoon(
  bids: {
    id: string;
    projectName: string;
    status: string;
    dueDate: Date | null;
    dueMinute?: number | null;
    walkDate?: Date | null;
    walkMinute?: number | null;
    rfiCutoffDate?: Date | null;
    contact: { name: string };
  }[],
  todayIso: string,
): DueSoonBid[] {
  return bids
    .flatMap((bid) => {
      if (bid.status !== "INVITED" || !bid.dueDate) return [];
      const dueIso = bid.dueDate.toISOString().slice(0, 10);
      const daysLeft = daysFrom(todayIso, dueIso);
      return daysLeft >= 0 && daysLeft <= DUE_SOON_DAYS
        ? [
            {
              id: bid.id,
              projectName: bid.projectName,
              gcName: bid.contact.name,
              dueIso,
              dueMinute: bid.dueMinute ?? null,
              daysLeft,
              upcoming: upcomingBidDates(
                { walkDate: bid.walkDate ?? null, walkMinute: bid.walkMinute ?? null, rfiCutoffDate: bid.rfiCutoffDate ?? null },
                todayIso,
              ),
            },
          ]
        : [];
    })
    .sort((a, b) => a.daysLeft - b.daysLeft);
}

/** Which view /bids opens on. `?view=` decides when given; otherwise Due soon
 * whenever something is due soon and no history filter is set. */
export function bidsView(param: string | undefined, dueSoonCount: number, isFiltered: boolean): "due" | "all" {
  if (param === "due" || param === "all") return param;
  return dueSoonCount > 0 && !isFiltered ? "due" : "all";
}

export function daysLeftLabel(daysLeft: number) {
  return daysLeft === 0 ? "Due today" : `${daysLeft} day${daysLeft === 1 ? "" : "s"} left`;
}
