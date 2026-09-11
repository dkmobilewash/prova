import Link from "next/link";
import { requireCapability } from "@/lib/authz";
import { NoAccess } from "@/components/NoAccess";
import { anthropicIsConfigured, ASK_DEFAULT_MODEL } from "@prova/integrations";
import { auditSummary, listAskProposals, OUTCOME_LABEL, type AuditOutcome } from "@/lib/ask/audit";
import { ASK_LIMITS, usageSummary } from "@/lib/ask/usage";
import { AssistantConnectionCheck } from "@/components/AssistantConnectionCheck";
import { StatusLine } from "@/components/StatusLine";
import { assistantStatus } from "@/lib/status-sentences";

/**
 * Settings → Assistant: every card the Ask box has put in front of
 * somebody, newest first, with what became of it.
 *
 * Exists because a feature that can write rows on a prompt needs a place
 * where the owner can read what it wrote, who asked for it, and what was
 * refused — without opening a database. The rows are AskProposal
 * (ask.prisma), append-only and stamped; nothing on this page writes.
 *
 * OWNER-ONLY on top of the route's MANAGE_COMPLIANCE, the same shape as
 * /settings itself: the list carries every member's questions and, for
 * money cards, amounts. The route capability gets a person to the
 * settings area; the role check decides who reads this.
 */

const OUTCOME_CLASS: Record<AuditOutcome, string> = {
  OK: "text-emerald-300",
  REFUSED: "text-amber-300",
  FAILED: "text-red-300",
  CANCELLED: "text-slate-400",
  PENDING: "text-blue-300",
  OPENED: "text-blue-300",
  EXPIRED: "text-slate-500",
};

function when(date: Date) {
  return date.toISOString().replace("T", " ").slice(0, 16) + " UTC";
}

export default async function AssistantAuditPage() {
  const { context, allowed } = await requireCapability("MANAGE_COMPLIANCE");
  if (!allowed) return <NoAccess capability="MANAGE_COMPLIANCE" />;
  const { company, ...currentUser } = context;

  if (currentUser.role !== "OWNER") {
    return (
      <div className="mx-auto max-w-3xl px-6 py-8">
        <h1 className="mb-2 text-xl font-semibold text-slate-100">Assistant</h1>
        <p className="text-sm text-slate-400">Only the account owner can read what the assistant has proposed.</p>
      </div>
    );
  }

  const now = new Date();
  const [rows, usage] = await Promise.all([listAskProposals(company.id, now), usageSummary(company.id, now)]);
  const summary = auditSummary(rows, now);
  const configured = anthropicIsConfigured();

  return (
    <div className="mx-auto max-w-4xl px-6 py-8">
      <p className="mb-2 text-sm text-slate-400">
        <Link href="/settings" className="text-blue-400 hover:text-blue-300">
          Settings
        </Link>{" "}
        / Assistant
      </p>
      <h1 className="mb-2 text-xl font-semibold text-slate-100">What the Ask box has proposed</h1>
      <p className="mb-6 text-sm text-slate-400">
        Every card, newest first. A card is a proposal: nothing was written until the person tapped, and
        the right-hand label says what happened when they did. A tap that wrote nothing carries the
        app&apos;s own sentence for why; nothing here was decided by the model.
      </p>

      {/* The screen half of the loop's failure log line: an owner can see
          whether a key exists and press one button to learn whether it
          works, instead of asking somebody to read runtime logs. */}
      <section className="mb-6 rounded-lg border border-slate-800 bg-slate-900 p-4" data-ask="connection">
        <h2 className="mb-1 text-sm font-semibold text-slate-100">Connection</h2>
        <p className="mb-3 text-sm text-slate-400">
          API key on this server:{" "}
          {configured ? (
            <span className="text-emerald-300">configured</span>
          ) : (
            <span className="text-red-300">not set — the box will say it isn&apos;t set up yet</span>
          )}
          . Model: <span className="text-slate-300">{ASK_DEFAULT_MODEL}</span>.
        </p>
        <AssistantConnectionCheck />
      </section>

      {/* Counted from AskUsage rows, the same rows the limits are counted
          from, so the figures here and the refusal a person sees at the
          limit cannot disagree. */}
      <section className="mb-6 rounded-lg border border-slate-800 bg-slate-900 p-4" data-ask="usage">
        <h2 className="mb-1 text-sm font-semibold text-slate-100">Usage, last 30 days</h2>
        <p className="mb-3 text-sm text-slate-400">
          {usage.questions} questions sent to the model · {usage.inputTokens.toLocaleString("en-US")} tokens in,{" "}
          {usage.outputTokens.toLocaleString("en-US")} out. Limits: {ASK_LIMITS.perPersonPerHour} questions per person per hour,{" "}
          {ASK_LIMITS.perCompanyPerDay} per company per day; past either, the box says so and sends nothing to the model.
        </p>
        {usage.byPerson.length > 0 && (
          <ul className="divide-y divide-slate-800 text-sm">
            {usage.byPerson.map((row) => (
              <li key={row.who} className="flex justify-between gap-3 py-1">
                <span className="text-slate-300">{row.who}</span>
                <span className="text-slate-400">
                  {row.questions} {row.questions === 1 ? "question" : "questions"} · {row.tokens.toLocaleString("en-US")} tokens
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <StatusLine report={assistantStatus({ proposed: summary.proposed, done: summary.done, notDone: summary.notDone })} />

      {rows.length === 0 ? (
        <p className="text-slate-400">
          Nothing yet. Ask the box on the dashboard to do something — &ldquo;create an estimate for
          Riverside for Turner&rdquo; — and the card it shows will be recorded here.
        </p>
      ) : (
        <ul className="divide-y divide-slate-800 rounded-lg border border-slate-800 bg-slate-900" data-ask="audit">
          {rows.map((row) => (
            <li key={row.id} className="flex flex-col gap-1 px-4 py-3 text-sm">
              <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                <span className="font-medium text-slate-100">{row.proposed}</span>
                <span className={`text-xs ${OUTCOME_CLASS[row.outcome]}`}>{OUTCOME_LABEL[row.outcome]}</span>
              </div>
              <p className="text-slate-300">&ldquo;{row.question}&rdquo;</p>
              <p className="text-xs text-slate-400">
                {row.who} · {when(row.when)} · {row.mode === "HANDOFF" ? "opens a form" : "one tap"}
                {row.target && (
                  <>
                    {" · "}
                    <Link href={row.target.href} className="text-blue-400 hover:text-blue-300">
                      {row.target.label}
                    </Link>
                  </>
                )}
              </p>
              {row.note && row.outcome !== "OK" && <p className="text-xs text-slate-400">{row.note}</p>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
