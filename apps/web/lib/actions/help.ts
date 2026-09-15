"use server";

import { prisma } from "@prova/db";
import { requireCompanyContext } from "@/lib/auth";
import { helpChannelFromEnv } from "@/lib/help-config";
import {
  helpBody,
  helpMessageProblem,
  helpSubject,
  jobIdFromPagePath,
  safePagePath,
} from "@/lib/help-request";
import { actionFail as fail, type ActionResult } from "./shared";
import { sendOutboundEmail } from "./messages";

/**
 * "Ask us" — the one thing this product promised on paper and had no way to
 * do from inside the app.
 *
 * NO NEW CHANNEL, and that is the main decision in this file. It builds a
 * form and hands it to `sendOutboundEmail`, which already gets the hard
 * part right: the message row and its handover event are written BEFORE
 * the provider is called, a failure is recorded with its reason instead of
 * vanishing, and a send the provider accepted-but-could-not-identify is
 * never reported as failed. Re-implementing that ordering here would be a
 * second, worse copy of it — and every one of those properties is exactly
 * what somebody asking for help at 6 AM needs: the question is either in
 * the log as sent, or in the log with a reason it did not go.
 *
 * The side effect of the reuse is the feature's best property: a help
 * request is a row on `/messages` like any other mail, so "did my question
 * actually reach them" is a question the contractor can answer without
 * asking us.
 *
 * WHAT IT SENDS is only what the panel showed the asker it would send:
 * their question, their company, the page they were on, the job that page
 * belongs to, and their name and address so we can reply. `helpBody` is
 * asserted whole in `help-request.test.ts` for that reason — a substring
 * test can prove what is present and never that nothing else is.
 */
export async function requestHelp(formData: FormData): Promise<ActionResult> {
  const { company, ...user } = await requireCompanyContext();

  // Read from the same place the panel read it, so the panel can never
  // offer a path this then refuses. Checked before the question is
  // examined: "nothing here can reach us" is the news, whatever they typed.
  const channel = helpChannelFromEnv();
  if (channel.kind !== "send") return fail(channel.reason);

  const message = String(formData.get("message") ?? "");
  const problem = helpMessageProblem(message);
  if (problem) return fail(problem);

  // Untrusted: this action answers whoever posts to it, not only the panel.
  // A path that is not a path becomes "not recorded" rather than a guess.
  const pagePath = safePagePath(String(formData.get("pagePath") ?? ""));

  // The ONLY way a job gets attached. Deliberately not a jobId field on the
  // form: the job is the one named by the page they chose to send, and it
  // is looked up scoped to their own company, so a posted id belonging to
  // somebody else finds nothing.
  const jobId = pagePath ? jobIdFromPagePath(pagePath) : null;
  const job = jobId
    ? await prisma.job.findFirst({
        where: { id: jobId, companyId: company.id },
        select: { id: true, name: true },
      })
    : null;

  const outbound = new FormData();
  outbound.set("toAddress", channel.to);
  outbound.set("subject", helpSubject({ companyName: company.name, pagePath }));
  outbound.set(
    "body",
    helpBody({
      message,
      companyName: company.name,
      pagePath,
      jobName: job?.name ?? null,
      askedBy: { name: user.name, email: user.email },
    }),
  );
  // Renders as "· about a help request" on /messages via relatedLabel's
  // SCREAMING_SNAKE fallback, which already produces exactly that.
  outbound.set("relatedType", "HELP_REQUEST");
  if (job) outbound.set("jobId", job.id);

  const result = await sendOutboundEmail(outbound);
  if (result.ok) return result;

  // Its error already says what the provider or the network did. What it
  // cannot know is that this particular message was a person asking for
  // help, so it is worth saying plainly that the question has not arrived
  // and naming the address that will work — the failure mode to avoid is
  // somebody assuming we have their question and waiting.
  return fail(
    `${result.error} Your question hasn't reached us — it's on /messages with the reason, ` +
      `and emailing ${channel.to} directly will get through.`,
  );
}
