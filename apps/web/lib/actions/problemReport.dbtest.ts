import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@prova/db";

// "Report a problem": what reaches support, and the promise that another
// company's job, sheet or name never does, whatever the browser posts.
const context = { company: { id: "", name: "" }, id: "", name: "Dana Reporter" as string | null, email: "dana@ours.test", role: "OWNER" as string, jobFunction: null as string | null };
vi.mock("@/lib/auth", () => ({ requireCompanyContext: async () => context }));
const sent: { jobId: string | null; subject: string; body: string; attachments?: readonly { filename: string; content: Buffer }[] }[] = [];
vi.mock("./messages", () => ({
  sendHelpRequestEmail: async (params: (typeof sent)[number]) => {
    sent.push(params);
    return { ok: true };
  },
}));
const { reportProblem } = await import("./problemReport");

const env = { SUPPORT_EMAIL: process.env.SUPPORT_EMAIL, RESEND_API_KEY: process.env.RESEND_API_KEY, OUTBOUND_EMAIL_FROM: process.env.OUTBOUND_EMAIL_FROM, SUPPORT_SLACK_WEBHOOK_URL: process.env.SUPPORT_SLACK_WEBHOOK_URL };
const configure = () => {
  process.env.SUPPORT_EMAIL = "support@cstream.test";
  process.env.RESEND_API_KEY = "re_test_dummy";
  process.env.OUTBOUND_EMAIL_FROM = "noreply@cstream.test";
};
afterEach(() => {
  for (const [k, v] of Object.entries(env)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  sent.length = 0;
  vi.unstubAllGlobals();
});

let ourJob = "";
let theirJob = "";
const jpeg = `data:image/jpeg;base64,${Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]).toString("base64")}`;

async function companyWithSheet(name: string, jobName: string, label: string) {
  const companyId = (await prisma.company.create({ data: { name } })).id;
  const contact = await prisma.contact.create({ data: { companyId, name: `${name} GC` } });
  const job = await prisma.job.create({ data: { companyId, contactId: contact.id, name: jobName, status: "ESTIMATE" } });
  const plan = await prisma.takeoffPlan.create({ data: { companyId, jobId: job.id, fileUrl: "local:x.pdf", fileName: "x.pdf" } });
  await prisma.takeoffPlanPage.create({ data: { planId: plan.id, pageNumber: 3, label } });
  return { companyId, jobId: job.id };
}

beforeAll(async () => {
  const ours = await companyWithSheet("Ours Drywall", "Our Clinic", "A201");
  const theirs = await companyWithSheet("Theirs Framing", "THEIR SECRET JOB", "Z999");
  context.company = { id: ours.companyId, name: "Ours Drywall" };
  context.email = `dana_${Date.now()}@ours.test`;
  context.id = (await prisma.user.create({ data: { companyId: ours.companyId, clerkId: `report_${Date.now()}`, email: context.email, role: "OWNER" } })).id;
  ourJob = ours.jobId;
  theirJob = theirs.jobId;
});

const base = { message: "Run takeoff did nothing", consoleErrors: ["12:00:00 console.error boom ?token=1"], actions: ["12:00:00 click button [data-takeoff=find-walls]"], screenshot: jpeg, userAgent: "UA" };

describe("Report a problem", () => {
  it("sends the job, the sheet by its own label, the redacted lines and the picture, to support", async () => {
    configure();
    expect(await reportProblem({ ...base, pagePath: `/takeoff/${ourJob}`, pageNumber: 3 })).toEqual({ ok: true });
    expect(sent).toHaveLength(1);
    const mail = sent[0]!;
    expect(mail.jobId).toBe(ourJob);
    expect(mail.subject).toBe(`Problem report — Ours Drywall — /takeoff/${ourJob}`);
    expect(mail.body).toContain("Job: Our Clinic");
    expect(mail.body).toContain("Sheet: A201 (page 3)");
    expect(mail.body).toContain("Screenshot: attached (plan-view.jpg)");
    expect(mail.attachments?.[0]?.filename).toBe("plan-view.jpg");
    expect(mail.body).toContain("click button [data-takeoff=find-walls]");
  });

  it("ANOTHER COMPANY'S JOB IN THE PATH: no job, no sheet, nothing of theirs in the mail", async () => {
    configure();
    expect(await reportProblem({ ...base, pagePath: `/takeoff/${theirJob}`, pageNumber: 3 })).toEqual({ ok: true });
    const mail = sent[0]!;
    expect(mail.jobId).toBeNull();
    expect(mail.body).not.toContain("THEIR SECRET JOB");
    expect(mail.body).not.toContain("Z999");
    expect(mail.body).not.toContain("Theirs Framing");
    expect(mail.body).not.toMatch(/^Job:|^Sheet:/m);
  });

  it("posts one line to #prova-build when the webhook is set, and the report stands if Slack fails", async () => {
    configure();
    process.env.SUPPORT_SLACK_WEBHOOK_URL = "https://hooks.slack.com/services/T/B/x";
    const posts: string[] = [];
    vi.stubGlobal("fetch", async (_url: string, init: { body: string }) => {
      posts.push(JSON.parse(init.body).text);
      return new Response("no", { status: 500 });
    });
    expect(await reportProblem({ ...base, pagePath: `/jobs/${ourJob}/estimate`, screenshot: null })).toEqual({ ok: true });
    expect(posts).toEqual(["🐞 Problem report from Ours Drywall — Our Clinic · /jobs/" + ourJob + "/estimate: “Run takeoff did nothing” (1 console error; full report in the support inbox)"]);
    expect(sent[0]!.body).toContain("Screenshot: no screenshot (this page has no plan view)");
  });

  it("with no support address, says so and sends nothing", async () => {
    delete process.env.SUPPORT_EMAIL;
    const result = await reportProblem({ ...base, pagePath: `/takeoff/${ourJob}` });
    expect(result.ok).toBe(false);
    expect(sent).toHaveLength(0);
  });
});
