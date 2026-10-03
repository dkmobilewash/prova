import Link from "next/link";
import { requireCapability } from "@/lib/authz";
import { NoAccess } from "@/components/NoAccess";
import { anthropicIsConfigured, ASK_DEFAULT_MODEL } from "@prova/integrations";
import { auditSummary, listAskProposals, OUTCOME_LABEL, type AuditOutcome } from "@/lib/ask/audit";
import { ASK_LIMITS, MIGRATE_COMMAND, usageSummary } from "@/lib/ask/usage";
import { loadCostReport } from "@/lib/ask/cost-query";
import { CostPanel, thirtyDaysAgo } from "@/components/AiCostPanel";
import { allowanceSummary } from "@/lib/ask/allowance";
import { AssistantConnectionCheck } from "@/components/AssistantConnectionCheck";
import { AiSettingsForm } from "@/components/AiSettingsForm";
import { aiSettingsFor } from "@/lib/ai/settings";
import { StatusLine } from "@/components/StatusLine";
import { assistantStatus } from "@/lib/status-sentences";

/**
 * Settings → Assistant: every card the Ask box has put in front of
 * somebody, newest first, with what became of it.
 *
 * Exists because a feature that can write rows on a prompt needs a place
 * where the owner can read what it wrote, who asked for it, and what was
 * refused — without opening a database. The rows are AskProposal
 * (ask.prisma), append-only and stamped.
 *
 * THIS PARAGRAPH SAID "nothing on this page writes" UNTIL 2026-09-26, and it
 * was true for as long as the page was only an audit log. The first section is
 * now the per-company AI switch (`AiSettingsForm`, `saveCompanyAiSettings`),
 * which is the one thing here that changes anything — so the sentence is gone
 * rather than left standing for somebody to rely on. Everything BELOW that
 * section still only reads.
 *
 * OWNER-ONLY on top of the route's MANAGE_COMPLIANCE, the same shape as
 * /settings itself: the list carries every member's questions and, for
 * money cards, amounts. The route capability gets a person to the
 * settings area; the role check decides who reads this. The switch asserts
 * both again in its own action, because a Server Action is a separate endpoint
 * that answers whoever posts to it whatever the page decided.
 */

const OUTCOME_CLASS: Record<AuditOutcome, string> = {
  OK: "text-tag-green-ink",
  REFUSED: "text-tag-amber-ink",
  FAILED: "text-tag-rose-ink",
  CANCELLED: "text-ink-body",
  PENDING: "text-tag-blue-ink",
  OPENED: "text-tag-blue-ink",
  EXPIRED: "text-ink-muted",
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
        <h1 className="mb-2 text-xl font-semibold text-ink">Assistant</h1>
        <p className="text-sm text-ink-body">Only the account owner can read what the assistant has proposed.</p>
      </div>
    );
  }

  const now = new Date();
  const [rows, usage, cost, allowance, aiSettings] = await Promise.all([
    listAskProposals(company.id, now),
    usageSummary(company.id, now),
    loadCostReport(company.id, thirtyDaysAgo(now)),
    allowanceSummary(company.id, now),
    aiSettingsFor(company.id),
  ]);
  const summary = auditSummary(rows, now);
  const configured = anthropicIsConfigured();

  return (
    <div className="mx-auto max-w-4xl px-6 py-8">
      <p className="mb-2 text-sm text-ink-body">
        <Link href="/settings" className="text-link hover:text-link-hover">
          Settings
        </Link>{" "}
        / Assistant
      </p>
      <h1 className="mb-2 text-xl font-semibold text-ink">What the Ask box has proposed</h1>
      <p className="mb-6 text-sm text-ink-body">
        Every card, newest first. A card is a proposal: nothing was written until the person tapped, and
        the right-hand label says what happened when they did. A tap that wrote nothing carries the
        app&apos;s own sentence for why; nothing here was decided by the model.
      </p>

      {/* WHAT AI IS ALLOWED TO DO — first, above everything, because it is the
          only section on this page that CHANGES anything, and because it is the
          answer to the question that brings most people here: whether this
          company's drawings and paperwork go to a model at all.

          It is also the section that makes this page's own header wrong. It read
          "nothing on this page writes" from the day it was built, which was true
          of an audit log and is not true any more. */}
      <section className="mb-6 rounded-lg border border-line-card bg-surface p-4" data-ask="ai-settings">
        <h2 className="mb-1 text-sm font-semibold text-ink">What AI is allowed to do</h2>
        <p className="mb-3 text-sm text-ink-body">
          Your company&apos;s choice, not ours. Switching something off here stops it for everyone in the
          company, and nothing from this company reaches a model through it while it is off.
        </p>
        <AiSettingsForm settings={aiSettings} />
      </section>

      {/* The screen half of the loop's failure log line: an owner can see
          whether a key exists and press one button to learn whether it
          works, instead of asking somebody to read runtime logs. */}
      <section className="mb-6 rounded-lg border border-line-card bg-surface p-4" data-ask="connection">
        <h2 className="mb-1 text-sm font-semibold text-ink">Connection</h2>
        <p className="mb-3 text-sm text-ink-body">
          API key on this server:{" "}
          {configured ? (
            <span className="text-tag-green-ink">configured</span>
          ) : (
            <span className="text-tag-rose-ink">not set — the box will say it isn&apos;t set up yet</span>
          )}
          . Model: <span className="text-ink-label">{ASK_DEFAULT_MODEL}</span>.
        </p>
        <AssistantConnectionCheck />
      </section>

      {/* THIS MONTH'S PAID ALLOWANCE — the hard stop, above the usage
          figures because it is the one an owner came here to find. It is a
          DIFFERENT THING from the section below it: that one counts what
          has been spent, in rolling windows, as a courtesy bound; this one
          is the ceiling attached to what the company pays for, and passing
          it stops the box rather than slowing it down.

          Shown BEFORE it runs out, which is the whole reason it is on a
          screen at all. A hard stop nobody could see coming is a support
          call, and the amber band exists so the call happens while there is
          still something left to do about it.

          The unreadable arm says the OPPOSITE of the one below: when the
          AskUsage rows cannot be read the box keeps answering unbounded,
          and when THIS ledger cannot be read the box refuses everything.
          Both sentences have to be on this page and they have to disagree,
          because the two checks genuinely behave differently — see
          lib/ask/allowance.ts. */}
      <section className="mb-6 rounded-lg border border-line-card bg-surface p-4" data-ask="allowance">
        <h2 className="mb-1 text-sm font-semibold text-ink">This month&apos;s AI allowance</h2>
        {allowance.readable ? (
          <>
            <p className="mb-3 text-sm text-ink-body" data-ask="allowance-left">
              <span className={allowance.low ? "text-tag-amber-ink" : "text-tag-green-ink"}>
                {allowance.questionsLeft} of {allowance.allowance.questions} questions
              </span>{" "}
              and{" "}
              <span className={allowance.low ? "text-tag-amber-ink" : "text-tag-green-ink"}>
                {allowance.pagesLeft} of {allowance.allowance.pages} document pages
              </span>{" "}
              left. Used so far: {allowance.questionsUsed}{" "}
              {allowance.questionsUsed === 1 ? "question" : "questions"} and {allowance.pagesUsed}{" "}
              {allowance.pagesUsed === 1 ? "page" : "pages"}. It starts again on {allowance.resetsOn}.
            </p>
            {allowance.low && (
              <p className="mb-3 text-sm text-tag-amber-ink" data-ask="allowance-low">
                Running low. When either number reaches zero the assistant stops answering and says so —
                it is a hard stop, not a slow-down, and <strong>nothing is ever billed for going over</strong>.
                Contact C Stream if you need more before {allowance.resetsOn}.
              </p>
            )}
            {/* THE OTHER TWO UNITS, and they were metered and never shown until
                2026-09-30. `planSheetSpend.ts` and `addendumSpend.ts` each tell a
                person on screen that "the account owner can see the month on
                Settings → Assistant" — and this page carried questions and
                document pages only, so for plan sheets (#551) and addendum pages
                both sentences were false. A browser click-through found it by
                looking for a figure it had been told would be here.

                A SEPARATE LINE rather than folded into the sentence above,
                because these are separate ceilings: running out of plan sheets
                does not stop the Ask box, and running out of questions does not
                stop a plan set being read. One sentence would imply one pot. */}
            <p className="mb-3 text-sm text-ink-body" data-ask="allowance-units">
              Separately, and on their own ceilings:{" "}
              <span className="text-ink-label">
                {allowance.planSheetsLeft} of {allowance.planSheetCeiling} plan sheets
              </span>{" "}
              and{" "}
              <span className="text-ink-label">
                {allowance.addendumPagesLeft} of {allowance.addendumPageCeiling} addendum pages
              </span>{", "}
              and{" "}
              <span className="text-ink-label">
                {allowance.specPagesLeft} of {allowance.specPageCeiling} spec pages
              </span>{" "}
              left. Used so far: {allowance.planSheetsUsed}{" "}
              {allowance.planSheetsUsed === 1 ? "sheet" : "sheets"}, {allowance.addendumPagesUsed}{" "}
              {allowance.addendumPagesUsed === 1 ? "addendum page" : "addendum pages"} and{" "}
              {allowance.specPagesUsed} {allowance.specPagesUsed === 1 ? "spec page" : "spec pages"}.
              These do not come out of the questions or document pages above, and they do not come out
              of each other — so reading a drawing set, a GC&apos;s addendum or a spec section cannot
              spend the allowance the same job&apos;s paperwork needs.
            </p>
            <p className="mb-3 text-sm text-ink-body">
              A question costs one question. A file costs its real page count on top — a PDF is counted
              page by page, a photo is one page, and a PDF whose page count can&apos;t be read is charged
              as a fixed number and says so at the time.
            </p>
            {(allowance.failedQuestions > 0 || allowance.failedPages > 0) && (
              <p className="mb-3 text-sm text-ink-body" data-ask="allowance-failed">
                {allowance.failedQuestions} {allowance.failedQuestions === 1 ? "question" : "questions"} and{" "}
                {allowance.failedPages} {allowance.failedPages === 1 ? "page" : "pages"} of that was claimed
                for something that then failed to answer. It is counted rather than quietly given back, because
                an allowance that hands itself back whenever a call fails is not a cap — contact C Stream and
                a person will credit it.
              </p>
            )}
            {/* The same disclosure for the other two units. Both ledgers MARK a
                failure rather than releasing it, and both tell the person so at
                the time — "the account owner can see them on Settings →
                Assistant". This is where that has to be true. */}
            {(allowance.failedPlanSheets > 0 ||
              allowance.failedAddendumPages > 0 ||
              allowance.failedSpecPages > 0) && (
              <p className="mb-3 text-sm text-ink-body" data-ask="allowance-failed-units">
                {allowance.failedPlanSheets}{" "}
                {allowance.failedPlanSheets === 1 ? "plan sheet" : "plan sheets"},{" "}
                {allowance.failedAddendumPages}{" "}
                {allowance.failedAddendumPages === 1 ? "addendum page" : "addendum pages"} and{" "}
                {allowance.failedSpecPages}{" "}
                {allowance.failedSpecPages === 1 ? "spec page" : "spec pages"} were claimed for
                a read that then failed. Counted rather than given back, for the same reason — contact
                C Stream and a person will credit it.
              </p>
            )}
          </>
        ) : (
          <p className="mb-3 text-sm text-red-300" data-ask="allowance-unreadable">
            This month&apos;s allowance can&apos;t be read on this deployment — the{" "}
            <code>AskAllowancePeriod</code> table is missing or unreadable, which means this database is behind
            the code. <strong>The assistant is refusing every question</strong> until it is fixed: this cap fails
            closed on purpose, because a paid ceiling that answers unbounded when it can&apos;t check itself is
            not a ceiling. Run <code>{MIGRATE_COMMAND}</code> against this database — or, on a preview, the{" "}
            <strong>Migrate demo database</strong> workflow.
          </p>
        )}
      </section>

      {/* Counted from AskUsage rows, the same rows the limits are counted
          from, so the figures here and the refusal a person sees at the
          limit cannot disagree.

          When those rows cannot be read the figures are NOT shown (#257).
          Zero questions is what a quiet month looks like, so printing the
          zeros would report a database one migration behind as good news
          — and this is the page somebody opens to find out why the box is
          behaving oddly, which makes it the worst place in the app to be
          reassuring by accident. */}
      <section className="mb-6 rounded-lg border border-line-card bg-surface p-4" data-ask="usage">
        <h2 className="mb-1 text-sm font-semibold text-ink">Usage, last 30 days</h2>
        {usage.readable ? (
          <>
          <p className="mb-3 text-sm text-ink-body">
            {usage.calls} model {usage.calls === 1 ? "call" : "calls"} ·{" "}
            {usage.inputTokens.toLocaleString("en-US")} tokens in, {usage.outputTokens.toLocaleString("en-US")} out
            — every feature that talks to the model, which is what the bill is.
          </p>
          <p className="mb-3 text-sm text-ink-body">
            {usage.questions} of those {usage.questions === 1 ? "was an Ask question" : "were Ask questions"}. Limits:{" "}
            {ASK_LIMITS.perPersonPerHour} questions per person per hour, {ASK_LIMITS.perCompanyPerDay} per company per
            day; past either, the box says so and sends nothing to the model. The other features are not counted
            against those limits — a document extraction costs many times what a question does, so a row count is the
            wrong instrument for it.
          </p>
          {/* THE NUMBER-PROVENANCE GUARD'S FIRING RATE (lib/ask/provenance.ts).
              Every figure an answer says out loud has to appear in a tool
              result of that same question or in the question itself; one
              that does not gets the whole answer held back.

              On the page because a guard whose firing rate nobody can see
              is a guard nobody trusts. Zero for a month is either "the
              model is behaving" or "the check is broken", and those are
              indistinguishable unless the number is somewhere a person
              looks — which is the same reasoning as the `readable` flag
              above, where printing a reassuring zero was the defect.

              The FIGURES are deliberately not here. What was held back was
              held back because this app could not vouch for it, and listing
              it on a screen would be showing it after all; the offending
              number and the question go to the runtime log. */}
          <p className="mb-3 text-sm text-ink-body" data-ask="usage-blocked">
            {usage.blockedAnswers === 0 ? (
              <>
                <span className="text-tag-green-ink">No answers were held back.</span> Every figure the
                assistant said out loud traced back to something it had read.
              </>
            ) : (
              <>
                <span className="text-tag-amber-ink">
                  {usage.blockedAnswers} {usage.blockedAnswers === 1 ? "answer was" : "answers were"} held back
                </span>{" "}
                because a number in {usage.blockedAnswers === 1 ? "it" : "them"} could not be traced back to
                your records. The person was told to ask again; nothing wrong was shown. The figure and the
                question are in this deployment&apos;s server log.
              </>
            )}
          </p>
          </>
        ) : (
          <p className="mb-3 text-sm text-red-300" data-ask="usage-unreadable">
            Usage can&apos;t be read on this deployment — the <code>AskUsage</code> table is missing or unreadable,
            which means this database is behind the code. The box still answers, but the{" "}
            {ASK_LIMITS.perPersonPerHour}-per-person-per-hour and {ASK_LIMITS.perCompanyPerDay}-per-company-per-day
            limits are <strong>not being enforced</strong> until it is fixed. Run <code>{MIGRATE_COMMAND}</code> against
            this database — or, on a preview, the <strong>Migrate demo database</strong> workflow.
          </p>
        )}
        {/* By feature before by person: the question this page is opened
            with is "what is the bill made of", and until the `feature`
            column was read nothing here could answer it. */}
        {usage.readable && usage.byFeature.length > 0 && (
          <ul className="mb-3 divide-y divide-line-row text-sm" data-ask="usage-by-feature">
            {usage.byFeature.map((row) => (
              <li key={row.feature} className="flex justify-between gap-3 py-1">
                <span className="text-ink-label">{row.label}</span>
                <span className="text-ink-muted">
                  {row.calls} {row.calls === 1 ? "call" : "calls"} · {row.tokens.toLocaleString("en-US")} tokens
                </span>
              </li>
            ))}
          </ul>
        )}
        {usage.readable && usage.byPerson.length > 0 && (
          <ul className="divide-y divide-line-row text-sm">
            {usage.byPerson.map((row) => (
              <li key={row.who} className="flex justify-between gap-3 py-1">
                <span className="text-ink-label">{row.who}</span>
                <span className="text-ink-muted">
                  {row.calls} {row.calls === 1 ? "call" : "calls"} · {row.tokens.toLocaleString("en-US")} tokens
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* STEP 2 OF THE AI PLAN. The section above says how many tokens; this
          one says what they cost, and what one unit of work costs — which is
          the figure `docs/ai/DECISIONS.md` says is needed to answer whether
          1,500 plan sheets and 600 addendum pages a month are sustainable.
          Both were written down as "a figure, not a measurement". */}
      <CostPanel report={cost} />

      <StatusLine report={assistantStatus({ proposed: summary.proposed, done: summary.done, notDone: summary.notDone })} />

      {rows.length === 0 ? (
        <p className="text-ink-body">
          Nothing yet. Ask the box on the dashboard to do something — &ldquo;create an estimate for
          Riverside for Turner&rdquo; — and the card it shows will be recorded here.
        </p>
      ) : (
        <ul className="divide-y divide-line-row rounded-lg border border-line-card bg-surface" data-ask="audit">
          {rows.map((row) => (
            <li key={row.id} className="flex flex-col gap-1 px-4 py-3 text-sm">
              <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                <span className="font-medium text-ink">{row.proposed}</span>
                <span className={`text-xs ${OUTCOME_CLASS[row.outcome]}`}>{OUTCOME_LABEL[row.outcome]}</span>
              </div>
              <p className="text-ink-label">&ldquo;{row.question}&rdquo;</p>
              <p className="text-xs text-ink-body">
                {row.who} · {when(row.when)} · {row.mode === "HANDOFF" ? "opens a form" : "one tap"}
                {row.target && (
                  <>
                    {" · "}
                    <Link href={row.target.href} className="text-link hover:text-link-hover">
                      {row.target.label}
                    </Link>
                  </>
                )}
              </p>
              {row.note && row.outcome !== "OK" && <p className="text-xs text-ink-body">{row.note}</p>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
