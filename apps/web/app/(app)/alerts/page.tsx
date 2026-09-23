import Link from "next/link";
import { requireCompanyContext } from "@/lib/auth";
import { loadAlerts } from "@/lib/alerts-query";
import { summarizeAlerts } from "@/lib/alerts";
import { AlertRow } from "@/components/AlertRow";
import { EmptyState } from "@/components/EmptyState";
import { money } from "@/lib/money";
import { SendDigestButton } from "@/components/SendDigestButton";
import { sendMyAlertDigest } from "@/lib/actions/notifications";
import { viewerToday } from "@/lib/viewerToday";
import { StatusLine } from "@/components/StatusLine";
import { alertsStatus } from "@/lib/status-sentences";

export default async function AlertsPage({
  searchParams,
}: {
  searchParams: Promise<{ show?: string }>;
}) {
  const { company, ...currentUser } = await requireCompanyContext();
  const { show } = await searchParams;
  const showSilenced = show === "silenced";

  // The day on the READER'S calendar, not the server's. This line was
  // `new Date().toISOString()`, so at 18:00 in Los Angeles the engine was
  // already working in tomorrow: a follow-up due tomorrow read "Due today"
  // and one due today flipped to OVERDUE — issue #111 item 1.
  const today = await viewerToday();
  const { visible, silenced } = await loadAlerts(
    company.id,
    currentUser.id,
    today,
    {
      role: currentUser.role,
      jobFunction: currentUser.jobFunction,
    },
  );
  const summary = summarizeAlerts(visible);
  // Named, not owed. Several kinds carry no figure at all, and a backcharge
  // claim and retainage held are money moving in opposite directions —
  // presenting the sum as a balance would be a number nobody could
  // reconcile. The sentence says so.
  const status = alertsStatus({
    overdue: summary.overdue,
    dueSoon: summary.dueSoon,
    standing: summary.standing,
    amountNamed: summary.amountNamed > 0 ? money(summary.amountNamed) : null,
  });

  const rows = showSilenced ? silenced : visible;

  // Nothing derived at all, in either list. Four tiles reading 0, 0, 0 and
  // $0.00 are a summary of nothing, and this page's own point is that it
  // stores nothing — so on a new account they describe an engine that has
  // not been given anything to watch yet. Kept the moment a single alert
  // exists anywhere, because then the zeros are load-bearing: "0 past due"
  // beside "3 coming up" is the reassuring half of the answer.
  const nothingDerived = visible.length === 0 && silenced.length === 0;

  return (
    <div className="mx-auto max-w-4xl px-6 py-8">
      <h1 className="mb-2 text-xl font-semibold text-ink">Alerts</h1>
      <p className="mb-2 text-sm text-ink-body">
        Everything with a date on it that nobody has dealt with, in one place:
        cover about to lapse, a backcharge nobody has answered, retainage that
        has become collectable, a closeout package the GC is sitting on,
        certified payroll owed on a prevailing-wage week, a job forecast past
        its contract value. Worst first, and within that, most money first.
      </p>
      <p className="mb-6 text-xs text-ink-muted">
        Nothing here is stored. Every line is derived from the record it is
        about, every time this page loads — so fixing the thing removes the
        alert, and no alert can go stale against the data underneath it.{" "}
        <span className="text-ink-body">These can now be emailed to you</span>,
        once per thing per stage — not once a day until you deal with it. Fixing
        the thing is what stops the reminders.
      </p>

      <StatusLine report={status} />

      {currentUser.email && (
        <div className="mb-6" data-tour="alerts-email">
          <SendDigestButton
            sendMyAlertDigest={sendMyAlertDigest}
            recipientEmail={currentUser.email}
          />
        </div>
      )}

      <div className="mb-3 flex items-center justify-between" data-tour="alerts-silenced">
        <h2 className="text-sm font-semibold text-ink-label">
          {rows.length} {showSilenced ? "silenced" : "needing attention"}
        </h2>
        <Link
          href={showSilenced ? "/alerts" : "/alerts?show=silenced"}
          className="text-sm text-link"
        >
          {showSilenced
            ? "Back to open alerts"
            : `Show silenced (${silenced.length})`}
        </Link>
      </div>

      {rows.length === 0 ? (
        showSilenced ? (
          <p className="text-ink-body">
            Nothing silenced. Anything you mark as seen shows up here so you can put it back.
          </p>
        ) : (
          // The two places a brand-new account can put a date that this page
          // will watch: cover and licences need no job, and everything else —
          // retainage, closeout, backcharges, certified payroll — hangs off one.
          <EmptyState
            data-tour="alerts-empty"
            title={nothingDerived ? "Nothing to watch yet" : "Nothing needs attention"}
            purpose={
              <p>
                {nothingDerived
                  ? "Your early warning list: insurance or a licence about to lapse, a backcharge you have not answered, retainage you can now bill, a job running over its contract. It fills itself from dates you have already entered elsewhere — on day one it is empty because there are no dates in yet."
                  : "Everything with a date on it has either been dealt with or is not due yet. On a quiet day this page is right to be empty."}
              </p>
            }
            actions={[
              { label: "Record your cover and licence dates", href: "/settings" },
              { label: "Go to your jobs", href: "/jobs" },
            ]}
            sources={
              nothingDerived ? (
                <p>
                  Nothing is typed here. Each alert is worked out from a date on the record it is
                  about — an expiry date in Settings, a completion date on a job, a deadline on a
                  backcharge — and fixing that record is what clears it. A record with no date
                  raises nothing rather than a guess.
                </p>
              ) : undefined
            }
            example={
              nothingDerived
                ? {
                    rows: [
                      { title: "General liability insurance expires in 12 days", tag: "Due soon", detail: "Settings · renew before Sep 30" },
                      { title: "Retainage on the Oak Ave addition can be billed", tag: "Standing", detail: "Job complete Aug 29", meta: "$4,850.00" },
                      { title: "Backcharge #2 has no reply", tag: "Overdue", detail: "Oak Ave addition · objection window closes Sep 20", meta: "$450.00" },
                    ],
                  }
                : undefined
            }
          />
        )
      ) : (
        <ul className="divide-y divide-line-row rounded-lg border border-line-card bg-surface" data-tour="alerts-list">
          {rows.map((alert) => (
            <AlertRow key={alert.key} alert={alert} silenced={showSilenced} />
          ))}
        </ul>
      )}
    </div>
  );
}
