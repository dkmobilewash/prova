import Link from "next/link";
import { prisma } from "@prova/db";
import { requireCompanyContext } from "@/lib/auth";
import { emailSetupProblem } from "@prova/integrations";
import { MessageRow } from "@/components/MessageRow";
import { MessageComposer } from "@/components/MessageComposer";
import { deliveryRate, needsAttention, stale } from "@/components/messageLabels";

/** Stored at UTC midnight, rendered in UTC — same rule as every other date
 * in this app. */
function isoDate(date: Date | null) {
  return date ? date.toISOString().slice(0, 10) : null;
}

/** How many messages this page loads and counts over. */
const MESSAGE_LIMIT = 200;

export default async function MessagesPage({
  searchParams,
}: {
  searchParams: Promise<{ show?: string }>;
}) {
  const { company, ...currentUser } = await requireCompanyContext();
  const { show } = await searchParams;
  const onlyProblems = show === "problems";

  const today = new Date().toISOString().slice(0, 10);
  const setupProblem = emailSetupProblem();

  const jobs = await prisma.job.findMany({
    where: { companyId: company.id },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });

  const messages = await prisma.outboundMessage.findMany({
    where: { companyId: company.id },
    orderBy: { createdAt: "desc" },
    // One more than we render, so the page can TELL whether it is looking
    // at everything. See the counters below.
    take: MESSAGE_LIMIT + 1,
    include: {
      job: { select: { name: true } },
      sentBy: { select: { name: true } },
      events: { orderBy: { occurredAt: "desc" } },
    },
  });

  const truncated = messages.length > MESSAGE_LIMIT;
  const rows = (truncated ? messages.slice(0, MESSAGE_LIMIT) : messages).map((m) => ({
    id: m.id,
    channel: m.channel,
    toAddress: m.toAddress,
    toName: m.toName,
    subject: m.subject,
    fromAddress: m.fromAddress,
    sentAt: isoDate(m.createdAt) as string,
    body: m.body,
    jobName: m.job?.name ?? null,
    sentByName: m.sentBy?.name ?? null,
    relatedType: m.relatedType,
    wentOut: m.providerMessageId !== null,
    events: m.events.map((e) => ({
      id: e.id,
      type: e.type,
      occurredAt: e.occurredAt.toISOString(),
      detail: e.detail,
    })),
  }));

  // All derived, and counted over the whole LOADED set rather than the
  // filtered view — a filter that also changes the counters is how a number
  // quietly becomes meaningless.
  //
  // The loaded set is not necessarily every message. This comment used to
  // say "across every message", which the `take` above made untrue the
  // moment a company sent its 201st: the counters silently became "of the
  // most recent 200" and nothing on the page said so. The scope is now
  // rendered next to the numbers when it matters — see `truncated`.
  const problems = rows.filter((r) => needsAttention(r.events)).length;
  const unconfirmed = rows.filter((r) => stale(r, today)).length;
  const rate = deliveryRate(rows);

  const visible = onlyProblems
    ? rows.filter((r) => needsAttention(r.events) || stale(r, today))
    : rows;

  const chip = (active: boolean) =>
    `rounded-md border px-3 py-1.5 text-sm ${
      active ? "border-blue-500 text-blue-400" : "border-slate-700 text-slate-300 hover:border-slate-500"
    }`;

  return (
    <div className="mx-auto max-w-4xl px-6 py-8">
      <h1 className="mb-2 text-xl font-semibold text-slate-100">Messages</h1>
      <p className="mb-6 text-sm text-slate-400">
        Everything this company has sent, and whether it actually arrived. Mail that silently never
        lands is the failure nobody catches — you find out when the GC says they never heard from
        you, on a date that matters.
      </p>

      {setupProblem && (
        <div className="mb-6 rounded-lg border border-amber-700/60 bg-amber-500/10 p-4">
          <p className="text-sm font-medium text-amber-200">Sending isn&apos;t set up yet</p>
          <p className="mt-1 text-sm text-amber-100/80">{setupProblem}</p>
          <p className="mt-2 text-xs text-amber-100/60">
            It needs <span className="font-mono">RESEND_API_KEY</span> and{" "}
            <span className="font-mono">OUTBOUND_EMAIL_FROM</span> set to an address on your own
            domain, verified with the provider — plus{" "}
            <span className="font-mono">RESEND_WEBHOOK_SECRET</span>, without which no delivery
            events are accepted at all. Sending from your own domain rather than ours is the point:
            it&apos;s what keeps quotes out of spam.
          </p>
        </div>
      )}

      <div className="mb-6">
        <MessageComposer jobs={jobs} canSend={setupProblem === null} />
      </div>

      {truncated && (
        <p className="mb-2 text-xs text-slate-500">
          Showing the most recent {MESSAGE_LIMIT} messages. The three figures below are counted
          over those {MESSAGE_LIMIT}, not over everything ever sent.
        </p>
      )}

      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <div className="rounded-lg border border-slate-800 bg-slate-900 p-4">
          <p className={`text-2xl font-semibold ${problems > 0 ? "text-red-300" : "text-slate-100"}`}>
            {problems}
          </p>
          <p className="text-xs text-slate-500">Bounced, refused or spam-flagged</p>
        </div>
        <div className="rounded-lg border border-slate-800 bg-slate-900 p-4">
          <p className={`text-2xl font-semibold ${unconfirmed > 0 ? "text-amber-300" : "text-slate-100"}`}>
            {unconfirmed}
          </p>
          <p className="text-xs text-slate-500">Sent, never confirmed</p>
        </div>
        <div className="rounded-lg border border-slate-800 bg-slate-900 p-4">
          <p className="text-2xl font-semibold text-green-300">{rate === null ? "—" : `${rate}%`}</p>
          <p className="text-xs text-slate-500">
            {rate === null ? "Nothing confirmed yet" : "Reached the far end"}
          </p>
        </div>
      </div>

      <div className="mb-4 flex flex-wrap gap-2">
        <Link href="/messages" className={chip(!onlyProblems)}>
          Everything
        </Link>
        <Link href="/messages?show=problems" className={chip(onlyProblems)}>
          Needs attention
        </Link>
      </div>

      <h2 className="mb-3 text-sm font-semibold text-slate-300">
        {visible.length} {visible.length === 1 ? "message" : "messages"}
      </h2>

      {visible.length === 0 ? (
        <p className="text-slate-400">
          {rows.length === 0
            ? "Nothing sent yet. Once sending is set up, anything the app sends on your behalf is recorded here with what the provider said happened to it."
            : "Nothing needs attention — everything sent has either been delivered or is still in flight."}
        </p>
      ) : (
        <ul className="divide-y divide-slate-800 rounded-lg border border-slate-800 bg-slate-900">
          {visible.map((message) => (
            <MessageRow
              key={message.id}
              message={message}
              today={today}
              canDelete={currentUser.role === "OWNER"}
            />
          ))}
        </ul>
      )}
    </div>
  );
}
