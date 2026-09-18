import Link from "next/link";
import { prisma } from "@prova/db";
import { requireCompanyContext } from "@/lib/auth";
import { emailSetupProblem } from "@prova/integrations";
import { MessageRow } from "@/components/MessageRow";
import { MessageComposer } from "@/components/MessageComposer";
import { AskDraftNotice } from "@/components/AskDraftNotice";
import { loadMessageDraft } from "@/lib/ask/drafts";
import { deliveryRate, needsAttention, stale } from "@/components/messageLabels";
import { StatusLine } from "@/components/StatusLine";
import { messagesStatus } from "@/lib/status-sentences";
import { toJobOption } from "@/components/jobLabels";
import { EmptyState } from "@/components/EmptyState";

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
  searchParams: Promise<{ show?: string; draft?: string }>;
}) {
  const context = await requireCompanyContext();
  const { company, ...currentUser } = context;
  const { show, draft } = await searchParams;
  const onlyProblems = show === "problems";

  const today = new Date().toISOString().slice(0, 10);
  const setupProblem = emailSetupProblem();

  // A card from the Ask box (lib/ask/drafts.ts): the composer opens
  // prefilled from the server-held row, and its own Send is the send.
  const askDraft = await loadMessageDraft(context, draft);
  const messageDraft = askDraft.kind === "draft" ? askDraft.draft : undefined;

  // status + contact, not just the name: issue #65 — seven jobs sharing one
  // placeholder name made every picker seven identical rows.
  const jobs = (
    await prisma.job.findMany({
      where: { companyId: company.id },
      select: { id: true, name: true, status: true, contact: { select: { name: true } } },
      orderBy: { name: "asc" },
    })
  ).map(toJobOption);

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
  const failed = rows
    .filter((r) => needsAttention(r.events))
    .map((r) => ({ to: r.toName ?? r.toAddress, subject: r.subject ?? "no subject" }));
  const unconfirmed = rows.filter((r) => stale(r, today)).length;
  const rate = deliveryRate(rows);
  const status = messagesStatus({ failed, unconfirmed, sent: rows.length, rate });

  const problems = rows.filter((r) => needsAttention(r.events) || stale(r, today));
  const problemCount = problems.length;
  const visible = onlyProblems ? problems : rows;

  const chip = (active: boolean) =>
    `rounded-md border px-3 py-1.5 text-sm ${
      active ? "border-brand text-link" : "border-line-card text-ink-label hover:bg-neutral-800"
    }`;

  return (
    <div className="mx-auto max-w-4xl px-6 py-8">
      <h1 className="mb-2 text-xl font-semibold text-ink">Messages</h1>
      <p className="mb-6 text-sm text-ink-body">
        Everything this company has sent, and whether it actually arrived. Mail that silently never
        lands is the failure nobody catches — you find out when the GC says they never heard from
        you, on a date that matters.
      </p>

      {setupProblem && (
        <div className="mb-6 rounded-lg border border-amber-700 bg-tag-amber p-4" data-tour="messages-setup">
          <p className="text-sm font-medium text-tag-amber-ink">Sending isn&apos;t set up yet</p>
          <p className="mt-1 text-sm text-tag-amber-ink/80">{setupProblem}</p>
          <p className="mt-2 text-xs text-tag-amber-ink/60">
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
        {askDraft.kind === "gone" && <AskDraftNotice what="email" />}
        <MessageComposer jobs={jobs} canSend={setupProblem === null} draft={messageDraft} />
      </div>

      {rows.length === 0 ? (
        <EmptyState
          data-tour="messages-empty"
          title="Nothing sent yet"
          purpose={
            <p>
              Your sent mail, with proof it arrived. Every email C Stream sends for you — a note to
              a homeowner, a question to the builder, a change of start date — is kept here with
              what happened to it: delivered, bounced, or no word back yet.
            </p>
          }
          actions={setupProblem === null ? [{ label: "Send an email", opens: "messages-compose" }] : []}
          ask={setupProblem === null ? "Email Jane Smith that we start on her kitchen Monday" : undefined}
          sources={
            <ul className="list-disc space-y-1 pl-5">
              <li>emails you write here, or ask the assistant to write for you;</li>
              <li>the alert digest, when you send it from Alerts;</li>
              <li>questions you send us from Help.</li>
            </ul>
          }
          example={{
            rows: [
              { title: "Jane Smith — Kitchen start date", tag: "Delivered", detail: "About Smith kitchen remodel", meta: "Sep 12" },
              { title: "Northside Builders — Header height on the back wall", tag: "No word back yet", detail: "About Oak Ave addition", meta: "Sep 10" },
              { title: "orders@example.com — Window order change", tag: "Bounced", detail: "Check the address and send it again", meta: "Sep 8" },
            ],
          }}
        />
      ) : (
        <>
          {truncated && (
            <p className="mb-2 text-xs text-ink-muted">
              Showing the most recent {MESSAGE_LIMIT} messages. The line below is counted over those{" "}
              {MESSAGE_LIMIT}, not over everything ever sent.
            </p>
          )}

          <StatusLine report={status} />

          <div className="mb-4 flex flex-wrap gap-2" data-tour="messages-filter">
            <Link href="/messages" className={chip(!onlyProblems)}>
              Everything ({rows.length})
            </Link>
            <Link href="/messages?show=problems" className={chip(onlyProblems)}>
              Needs attention ({problemCount})
            </Link>
          </div>

          <h2 className="mb-3 text-sm font-semibold text-ink-label">
            {visible.length} {visible.length === 1 ? "message" : "messages"}
          </h2>

          {visible.length === 0 ? (
            <p className="text-ink-body">
              Nothing needs attention — everything sent has either been delivered or is still in flight.
            </p>
          ) : (
            <ul className="divide-y divide-line-row rounded-lg border border-line-card bg-surface" data-tour="messages-list">
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
        </>
      )}
    </div>
  );
}
