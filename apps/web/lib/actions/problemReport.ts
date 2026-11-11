"use server";

import { prisma } from "@prova/db";
import { requireCompanyContext } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { helpChannelFromEnv } from "@/lib/help-config";
import { safePagePath } from "@/lib/help-request";
import {
  MAX_REPORT_MESSAGE,
  cleanLines,
  jobIdFromReportPath,
  reportBody,
  reportSlackText,
  reportSubject,
  screenshotBytes,
} from "@/lib/problem-report";
import { actionFail as fail, type ActionResult } from "./shared";
import { sendHelpRequestEmail } from "./messages";

export type ProblemReportInput = {
  pagePath: string;
  /** The sheet on screen in the takeoff workspace; its label is looked up here, never sent. */
  pageNumber?: number | null;
  message: string;
  consoleErrors: string[];
  actions: string[];
  /** A JPEG data URL of the plan view, or null where there is none. */
  screenshot: string | null;
  userAgent?: string | null;
};

/**
 * "Report a problem" from the takeoff workspace and the estimate: one press sends
 * support what was on the screen.
 *
 * THE HELP REQUEST'S CHANNEL, NOT A NEW ONE (`requestHelp` in help.ts): the message
 * row is written before the provider is called, so a report is on /messages as sent
 * or with the reason it did not go, and it can only ever reach the configured
 * support address. #prova-build gets one line on top when SUPPORT_SLACK_WEBHOOK_URL
 * is set; that post is best effort and never decides what the person is told.
 *
 * NEVER ANOTHER COMPANY'S DATA. Every lookup is scoped to the reporter's company:
 * the job comes from the page they were on and is found only among their own jobs,
 * and the sheet's label only on that job's plans. Nothing the client posts is used
 * as an id. The browser's own lines are redacted (`lib/problem-report.ts`).
 */
export async function reportProblem(input: ProblemReportInput): Promise<ActionResult> {
  const context = await requireCompanyContext();
  // The two pages that carry the button are the estimate's and the workspace's, both VIEW_JOB_COSTS.
  if (!can(context, "VIEW_JOB_COSTS")) return fail("Reporting from the estimate or the takeoff isn't part of your job function. Use Help instead.");
  const { company, ...user } = context;
  const channel = helpChannelFromEnv();
  if (channel.kind !== "send") return fail(channel.reason);

  const message = typeof input?.message === "string" ? input.message.trim() : "";
  if (message.length > MAX_REPORT_MESSAGE) return fail(`That's ${message.length} characters and the limit is ${MAX_REPORT_MESSAGE}. Send the short version and we'll ask for the rest.`);

  const pagePath = safePagePath(typeof input?.pagePath === "string" ? input.pagePath : "");
  const candidate = pagePath ? jobIdFromReportPath(pagePath) : null;
  const job = candidate ? await prisma.job.findFirst({ where: { id: candidate, companyId: company.id }, select: { id: true, name: true } }) : null;
  const pageNumber = Number.isInteger(input?.pageNumber) && (input.pageNumber as number) > 0 ? (input.pageNumber as number) : null;
  const sheetRow =
    job && pageNumber !== null
      ? await prisma.takeoffPlanPage.findFirst({
          where: { pageNumber, plan: { jobId: job.id, companyId: company.id } },
          orderBy: { plan: { createdAt: "desc" } },
          select: { label: true },
        })
      : null;
  const sheet = pageNumber === null || job === null ? null : sheetRow?.label ? `${sheetRow.label} (page ${pageNumber})` : `page ${pageNumber}`;

  const consoleErrors = cleanLines(input?.consoleErrors);
  const actions = cleanLines(input?.actions);
  const shot = screenshotBytes(input?.screenshot);
  const userAgent = typeof input?.userAgent === "string" ? input.userAgent.slice(0, 300) : null;

  const sent = await sendHelpRequestEmail({
    companyId: company.id,
    jobId: job?.id ?? null,
    subject: reportSubject({ companyName: company.name, pagePath }),
    body: reportBody({
      message,
      companyName: company.name,
      pagePath,
      jobName: job?.name ?? null,
      sheet,
      reportedBy: { name: user.name, email: user.email },
      consoleErrors,
      actions,
      screenshot: shot.ok ? "attached (plan-view.jpg)" : shot.why,
      userAgent,
    }),
    sentByUserId: user.id,
    attachments: shot.ok ? [{ filename: "plan-view.jpg", content: shot.bytes }] : undefined,
  });
  if (!sent.ok) return fail(`${sent.error} Your report hasn't reached us. It's on /messages with the reason, and emailing ${channel.to} will get through.`);

  await postToSupportSlack(reportSlackText({ companyName: company.name, jobName: job?.name ?? null, sheet, pagePath, message, consoleErrors: consoleErrors.length }));
  return sent;
}

/** One line to #prova-build, when the webhook is configured. Never throws, never fails the report. */
async function postToSupportSlack(text: string): Promise<void> {
  const hook = process.env.SUPPORT_SLACK_WEBHOOK_URL?.trim();
  if (!hook || !hook.startsWith("https://hooks.slack.com/")) return;
  try {
    const response = await fetch(hook, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text }) });
    if (!response.ok) console.error("[problem-report] Slack refused the post", { status: response.status });
  } catch (error) {
    console.error("[problem-report] the Slack post failed", { error: String(error) });
  }
}
