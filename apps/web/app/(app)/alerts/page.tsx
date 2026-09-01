import Link from "next/link";
import { requireCompanyContext } from "@/lib/auth";
import { loadAlerts } from "@/lib/alerts-query";
import { summarizeAlerts } from "@/lib/alerts";
import { AlertRow } from "@/components/AlertRow";
import { money } from "@/lib/money";

export default async function AlertsPage({
  searchParams,
}: {
  searchParams: Promise<{ show?: string }>;
}) {
  const { company, ...currentUser } = await requireCompanyContext();
  const { show } = await searchParams;
  const showSilenced = show === "silenced";

  const today = new Date().toISOString().slice(0, 10);
  const { visible, silenced } = await loadAlerts(company.id, currentUser.id, today);
  const summary = summarizeAlerts(visible);

  const rows = showSilenced ? silenced : visible;

  return (
    <div className="mx-auto max-w-4xl px-6 py-8">
      <h1 className="mb-2 text-xl font-semibold text-slate-100">Alerts</h1>
      <p className="mb-2 text-sm text-slate-400">
        Everything with a date on it that nobody has dealt with, in one place: cover about to lapse, a
        backcharge nobody has answered, retainage that has become collectable, a closeout package the
        GC is sitting on, certified payroll owed on a prevailing-wage week, a job forecast past its
        contract value. Worst first, and within that, most money first.
      </p>
      <p className="mb-6 text-xs text-slate-500">
        Nothing here is stored. Every line is derived from the record it is about, every time this page
        loads — so fixing the thing removes the alert, and no alert can go stale against the data
        underneath it. <span className="text-slate-400">This is not email or SMS.</span> It reaches
        whoever opens the app; there is no sender wired up to reach anyone who doesn&apos;t.
      </p>

      <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-lg border border-slate-800 bg-slate-900 p-4">
          <p className={`text-2xl font-semibold ${summary.overdue > 0 ? "text-red-300" : "text-slate-100"}`}>
            {summary.overdue}
          </p>
          <p className="text-xs text-slate-500">Past due</p>
        </div>
        <div className="rounded-lg border border-slate-800 bg-slate-900 p-4">
          <p className={`text-2xl font-semibold ${summary.dueSoon > 0 ? "text-amber-300" : "text-slate-100"}`}>
            {summary.dueSoon}
          </p>
          <p className="text-xs text-slate-500">Coming up</p>
        </div>
        <div className="rounded-lg border border-slate-800 bg-slate-900 p-4">
          <p className="text-2xl font-semibold text-slate-100">{summary.standing}</p>
          <p className="text-xs text-slate-500">Standing conditions, no date</p>
        </div>
        <div className="rounded-lg border border-slate-800 bg-slate-900 p-4">
          <p className="font-mono text-xl font-semibold text-slate-100">{money(summary.amountNamed)}</p>
          {/* Named, not owed. Several kinds carry no figure at all, and a
              backcharge claim and retainage held are money moving in
              opposite directions — presenting the sum as a balance would
              be a number nobody could reconcile. */}
          <p className="text-xs text-slate-500">Money named by these alerts, not a balance</p>
        </div>
      </div>

      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-slate-300">
          {rows.length} {showSilenced ? "silenced" : "needing attention"}
        </h2>
        <Link
          href={showSilenced ? "/alerts" : "/alerts?show=silenced"}
          className="text-sm text-blue-400"
        >
          {showSilenced ? "Back to open alerts" : `Show silenced (${silenced.length})`}
        </Link>
      </div>

      {rows.length === 0 ? (
        <p className="text-slate-400">
          {showSilenced
            ? "Nothing silenced. Anything you mark as seen shows up here so you can put it back."
            : "Nothing needs attention. Worth knowing this list only sees what has been recorded — a licence with no expiry date entered, or a backcharge with no deadline looked up, raises nothing rather than raising a guess."}
        </p>
      ) : (
        <ul className="divide-y divide-slate-800 rounded-lg border border-slate-800 bg-slate-900">
          {rows.map((alert) => (
            <AlertRow key={alert.key} alert={alert} silenced={showSilenced} />
          ))}
        </ul>
      )}
    </div>
  );
}
