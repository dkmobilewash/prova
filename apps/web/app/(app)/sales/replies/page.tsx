import Link from "next/link";
import { PageShell } from "@prova/ui";
import { prisma } from "@prova/db";
import { PageHeader } from "@/components/PageHeader";
import { ReplyReviewRow } from "@/components/ReplyReviewRow";
import { requireCompanyContext } from "@/lib/auth";
import { autosendEnabled } from "@/lib/replies/policy";

/**
 * THE REPLY AGENT'S INBOX — what it wants a person to answer, and what it
 * answered on its own today. Operator-owner only, the same two checks as
 * /sales, for the same reason: a capability would loosen it.
 *
 * Every row is the prospect's own words, the class the model gave them, and
 * the draft in a textarea the person can change before it goes. Three
 * buttons: send it, drop it, or say it was a stop the machine missed.
 */
export default async function RepliesPage() {
  const { company, ...currentUser } = await requireCompanyContext();
  if (!company.isProvaOperator) {
    return (
      <PageShell width="reading">
        <PageHeader route="/sales" parent={{ href: "/sales/replies", label: "Replies" }} title="Not part of your access" />
        <p className="text-sm text-ink-body">Nothing here for this account.</p>
      </PageShell>
    );
  }
  if (currentUser.role !== "OWNER") {
    return (
      <PageShell width="reading">
        <PageHeader route="/sales" parent={{ href: "/sales/replies", label: "Replies" }} title="Owner only" />
        <p className="text-sm text-ink-body">The sales CRM is restricted to the account owner.</p>
      </PageShell>
    );
  }

  const dayStart = new Date();
  dayStart.setUTCHours(0, 0, 0, 0);
  const [pending, autoSentToday, suppressedToday] = await Promise.all([
    prisma.outboundReply.findMany({
      where: { companyId: company.id, status: "PENDING_REVIEW" },
      orderBy: { receivedAt: "asc" },
      include: { lead: { select: { id: true, companyName: true, contactName: true } } },
    }),
    prisma.outboundReply.count({ where: { companyId: company.id, status: "AUTO_SENT", sentAt: { gte: dayStart } } }),
    prisma.outboundReply.count({ where: { companyId: company.id, status: "SUPPRESSED", updatedAt: { gte: dayStart } } }),
  ]);
  const autosend = autosendEnabled(process.env);

  return (
    <PageShell width="reading">
      <PageHeader
        route="/sales"
        parent={{ href: "/sales/replies", label: "Replies" }}
        title="Replies to answer"
        subtitle={
          <>
            {pending.length === 0 ? "Nothing waiting." : `${pending.length} waiting for you.`} The assistant sent{" "}
            {autoSentToday} on its own today (UTC) and stopped {suppressedToday}.{" "}
            {autosend
              ? "Auto-send is on: sure, safe classes go out signed as the assistant."
              : "Auto-send is off (REPLY_AGENT_AUTOSEND): every draft waits here for you."}
          </>
        }
      />

      {pending.length === 0 ? (
        <div className="rounded-lg border border-line-card bg-surface p-6 text-sm text-ink-body">
          <p>No reply is waiting. New ones land here as prospects write back to the sequence.</p>
          <Link href="/sales" className="mt-3 inline-block text-ink-label hover:underline">
            ← Back to the pipeline
          </Link>
        </div>
      ) : (
        <ul className="space-y-4">
          {pending.map((reply) => (
            <ReplyReviewRow
              key={reply.id}
              reply={{
                id: reply.id,
                leadId: reply.lead.id,
                company: reply.lead.companyName,
                contact: reply.lead.contactName,
                fromEmail: reply.fromEmail,
                subject: reply.subject,
                bodyText: reply.bodyText,
                receivedAt: reply.receivedAt.toISOString().slice(0, 10),
                classification: reply.classification,
                door: reply.door,
                confidence: reply.confidence,
                draft: reply.draft,
                draftRationale: reply.draftRationale,
              }}
            />
          ))}
        </ul>
      )}
    </PageShell>
  );
}
