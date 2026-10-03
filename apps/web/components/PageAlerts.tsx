import { AlertRow } from "@/components/AlertRow";
import { loadAlerts } from "@/lib/alerts-query";
import { viewerToday } from "@/lib/viewerToday";
import type { AlertKind } from "@/lib/alerts";

/**
 * THE ALERTS FOR THIS PAGE'S SUBJECT, ON THIS PAGE.
 *
 * Every derived alert reached exactly one surface: `/alerts`, behind a bell
 * with a count. That is a list you have to decide to go and read — and the
 * five kinds this was built for are the ones nobody goes looking for,
 * because their subject is somewhere else entirely. A licence expiring in
 * eleven days is a fact about the compliance tab, and the person on the
 * compliance tab was the one who could have fixed it.
 *
 * So the same alert now appears where its subject lives, from the SAME
 * `loadAlerts` call the list uses — not a second derivation. If the two ever
 * disagreed, one of them would be lying, and nobody would know which.
 *
 * **It renders nothing when there is nothing**, deliberately: an empty
 * state here would be a box on every clean page announcing that it has
 * nothing to say. The `/alerts` list is where "nothing outstanding" is the
 * useful answer, because being empty is the whole point of going there.
 *
 * Per-principal already: `loadAlerts` filters by capability and strips
 * figures the reader may not see, so this inherits that rather than
 * re-deciding it.
 */
export async function PageAlerts({
  companyId,
  user,
  kinds,
  /** Narrows to one job, where the page is about one job. Omitted shows
   * every alert of these kinds across the company — right for /wip and
   * /compliance, wrong for a job tab. */
  jobHref,
}: {
  companyId: string;
  user: { id: string; role: string; jobFunction: string | null };
  kinds: AlertKind[];
  jobHref?: string;
}) {
  const today = await viewerToday();
  const { visible } = await loadAlerts(companyId, user.id, today, {
    role: user.role as never,
    jobFunction: user.jobFunction as never,
  });

  const wanted = new Set(kinds);
  const mine = visible.filter(
    (alert) =>
      wanted.has(alert.kind) &&
      // A job page shows its own job's alerts. The href is what the alert
      // itself says to open, so matching on it needs no second mapping
      // from kind to job — and no mapping that could drift.
      (jobHref == null || alert.href.startsWith(jobHref)),
  );

  if (mine.length === 0) return null;

  return (
    <section className="mb-4" aria-label="Alerts about this">
      <ul className="flex flex-col gap-2">
        {mine.map((alert) => (
          <AlertRow key={alert.key} alert={alert} silenced={false} />
        ))}
      </ul>
    </section>
  );
}
