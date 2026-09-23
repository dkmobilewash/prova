import { prisma } from "@prova/db";
import { requireCompanyContext } from "@/lib/auth";
import { formatInstant } from "@/lib/render-date";
import { viewerTimeZone } from "@/lib/viewerToday";
import {
  ACTIVE_WITHIN_DAYS,
  QUIET_AFTER_DAYS,
  USAGE_STATUSES,
  USAGE_STATUS_CONCERN,
  USAGE_STATUS_LABEL,
  daysSinceSeen,
  describeSeenAge,
  usageStatus,
  type UsageStatus,
} from "@/lib/last-seen";

/**
 * Who is still logging in — Prova's own instrument, not a tenant's.
 *
 * There was no usage visibility of any kind before this: no `lastSeenAt`,
 * no analytics, nothing. Five design partners have logins, and the one who
 * quietly stops signing in was invisible until somebody noticed on a
 * weekly call, which is after the decision to leave has been made.
 *
 * GATED THE SAME WAY /sales IS, and for the same two reasons a Capability
 * cannot express: this Company must be Prova's own operator
 * (Company.isProvaOperator) AND the person must be its OWNER. It reads
 * ACROSS companies — the only page in the app that does — so nothing
 * narrower would be honest. A tenant sees the same "nothing here" it would
 * see for any page it has not been given, which never names what the page
 * would have shown.
 *
 * EVERYTHING ON IT IS DERIVED AT RENDER. The only stored fact is
 * `User.lastSeenAt`, an instant. "Active", "going quiet" and "quiet" are
 * computed from that column and the clock on every load (lib/last-seen.ts),
 * the per-company figure is the newest of its people's timestamps, and the
 * ordering is computed too — nothing here is a flag that could disagree
 * with the column it came from.
 *
 * READ-ONLY on purpose, which is why the list-page conventions (collapsed
 * add form, inline edit, two-step delete, shared *Fields component) do not
 * appear: there is nothing here a person may create, edit or delete. The
 * only writer of this data is requireCompanyContext.
 */

function NothingHere() {
  return (
    <div className="mx-auto max-w-2xl px-6 py-16">
      <h1 className="mb-2 text-xl font-semibold text-slate-100">Not part of your access</h1>
      <p className="text-sm text-slate-400">Nothing here for this account.</p>
    </div>
  );
}

const BADGE: Record<UsageStatus, string> = {
  ACTIVE: "border-emerald-800 bg-emerald-950 text-emerald-300",
  SLIPPING: "border-amber-800 bg-amber-950 text-amber-300",
  QUIET: "border-red-900 bg-red-950 text-red-300",
  NEVER: "border-slate-700 bg-slate-900 text-slate-400",
};

function StatusBadge({ status }: { status: UsageStatus }) {
  return (
    <span
      className={`inline-block whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-medium ${BADGE[status]}`}
    >
      {USAGE_STATUS_LABEL[status]}
    </span>
  );
}

export default async function InternalUsagePage() {
  const { company, ...currentUser } = await requireCompanyContext();

  if (!company.isProvaOperator) {
    return <NothingHere />;
  }

  if (currentUser.role !== "OWNER") {
    return (
      <div className="mx-auto max-w-2xl px-6 py-16">
        <h1 className="mb-2 text-xl font-semibold text-slate-100">Owner only</h1>
        <p className="text-sm text-slate-400">
          Usage across companies is restricted to the account owner, same as the sales CRM.
        </p>
      </div>
    );
  }

  const [rows, timeZone] = await Promise.all([
    // Every company and every person in it. The one deliberately
    // cross-tenant read in the app, which is what the gate above is for.
    // `select` rather than `include`: a usage page has no business
    // loading a tenant's jobs or money, and naming the columns keeps it
    // that way as the schema grows.
    prisma.company.findMany({
      select: {
        id: true,
        name: true,
        createdAt: true,
        isProvaOperator: true,
        users: {
          select: {
            id: true,
            name: true,
            email: true,
            role: true,
            createdAt: true,
            lastSeenAt: true,
          },
        },
      },
    }),
    viewerTimeZone(),
  ]);

  // One clock for the whole render, so two rows cannot be judged against
  // two different "now"s.
  const now = new Date();

  const companies = rows
    .map((row) => {
      const people = row.users
        .map((user) => ({ ...user, status: usageStatus(user.lastSeenAt, now) }))
        .sort(
          (a, b) =>
            USAGE_STATUS_CONCERN[a.status] - USAGE_STATUS_CONCERN[b.status] ||
            (a.lastSeenAt?.getTime() ?? 0) - (b.lastSeenAt?.getTime() ?? 0) ||
            a.email.localeCompare(b.email),
        );

      // A company's own last-seen is the NEWEST of its people's — if
      // anybody is still using it, the account is alive, whatever the rest
      // of the roster looks like.
      const seenAt = people.reduce<Date | null>(
        (newest, person) =>
          person.lastSeenAt && (!newest || person.lastSeenAt > newest) ? person.lastSeenAt : newest,
        null,
      );

      return { ...row, people, seenAt, status: usageStatus(seenAt, now) };
    })
    // Quietest first: the rows worth a phone call are the ones that must
    // not need scrolling to. Ties break on the older timestamp, then name.
    .sort(
      (a, b) =>
        USAGE_STATUS_CONCERN[a.status] - USAGE_STATUS_CONCERN[b.status] ||
        (a.seenAt?.getTime() ?? 0) - (b.seenAt?.getTime() ?? 0) ||
        a.name.localeCompare(b.name),
    );

  const everyone = companies.flatMap((row) => row.people);
  // Counted by iterating the status list rather than by hand, so a status
  // added later cannot be silently left out of the summary — a band nobody
  // counts reads exactly like a count of zero.
  const tally = USAGE_STATUSES.map((status) => ({
    status,
    count: everyone.filter((person) => person.status === status).length,
  }));

  return (
    <div className="mx-auto max-w-4xl px-6 py-8">
      <h1 className="mb-2 text-xl font-semibold text-slate-100">Usage — who is still logging in</h1>
      <p className="mb-4 text-sm text-slate-400">
        C Stream&apos;s own instrument, across every company on this database. One recorded fact per
        person — the last time their browser made a signed-in request, written at most once every 15
        minutes. Everything else on this page is worked out from that timestamp and the clock when
        the page loads.
      </p>
      <p className="mb-6 text-xs text-ink-muted">
        <span className="text-slate-400">Active</span> = seen in the last {ACTIVE_WITHIN_DAYS} days.{" "}
        <span className="text-slate-400">Going quiet</span> = {ACTIVE_WITHIN_DAYS}–
        {QUIET_AFTER_DAYS - 1} days. <span className="text-slate-400">Quiet</span> ={" "}
        {QUIET_AFTER_DAYS} days or more.{" "}
        <span className="text-slate-400">Never seen</span> means nothing has been recorded for them
        since this page shipped — which is not the same as never having used the product, and for
        anyone who signed up before it shipped it says nothing at all yet.
      </p>

      <section className="mb-8 flex flex-wrap gap-3">
        {tally.map(({ status, count }) => (
          <div
            key={status}
            className="min-w-[7rem] flex-1 rounded-lg border border-slate-800 bg-slate-900 px-4 py-3"
          >
            <p className="text-2xl font-semibold text-slate-100">{count}</p>
            <p className="text-xs text-slate-400">{USAGE_STATUS_LABEL[status]}</p>
          </div>
        ))}
      </section>

      {companies.length === 0 ? (
        <p className="rounded-lg border border-slate-800 bg-slate-900 p-6 text-sm text-slate-400">
          No companies on this database yet. If you are reading this on a preview, it is talking to
          the demo project — run the <span className="text-slate-300">Seed demo data</span> workflow.
        </p>
      ) : (
        <ul className="space-y-4">
          {companies.map((row) => (
            <li key={row.id} className="rounded-lg border border-slate-800 bg-slate-900">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 px-4 py-3">
                <div className="min-w-0">
                  <p className="font-medium text-slate-100">
                    {row.name}
                    {row.isProvaOperator && (
                      <span className="ml-2 text-xs font-normal text-ink-muted">(us)</span>
                    )}
                  </p>
                  <p className="text-xs text-ink-muted">
                    {row.people.length} {row.people.length === 1 ? "person" : "people"} · signed up{" "}
                    {formatInstant(row.createdAt, timeZone)}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-3">
                  <span className="text-xs text-slate-400">
                    {row.seenAt
                      ? `Last activity ${describeSeenAge(daysSinceSeen(row.seenAt, now))}`
                      : "No activity recorded"}
                  </span>
                  <StatusBadge status={row.status} />
                </div>
              </div>

              {row.people.length === 0 ? (
                <p className="px-4 py-3 text-sm text-ink-muted">
                  No logins on this company at all — nobody has ever signed in to create one.
                </p>
              ) : (
                <ul className="divide-y divide-slate-800">
                  {row.people.map((person) => (
                    <li
                      key={person.id}
                      className="flex flex-col gap-1 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm text-slate-100">
                          {person.name ?? person.email}
                        </p>
                        <p className="truncate text-xs text-ink-muted">
                          {person.email} · {person.role}
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-3">
                        {/* For a NEVER row the login's own date is the
                            only thing that makes it readable: "created
                            yesterday, not used yet" and "created three
                            weeks ago, never used" are the same badge and
                            two completely different conversations. */}
                        <span className="text-xs text-slate-400">
                          {person.lastSeenAt
                            ? `${formatInstant(person.lastSeenAt, timeZone)} · ${describeSeenAge(
                                daysSinceSeen(person.lastSeenAt, now),
                              )}`
                            : `nothing recorded · login created ${formatInstant(
                                person.createdAt,
                                timeZone,
                              )}`}
                        </span>
                        <StatusBadge status={person.status} />
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
      )}

      <p className="mt-6 text-xs text-ink-muted">
        Dates are on your own calendar ({timeZone}), not the server&apos;s.
      </p>
    </div>
  );
}
