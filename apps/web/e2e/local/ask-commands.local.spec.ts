import { test, expect, type Page } from "@playwright/test";
import { prisma } from "@prova/db";
import { signInAs } from "../lib/signIn";
import { PERSONAS } from "../lib/personas";
import { HealthMonitor, expectHealthy } from "../lib/health";
import { FIXTURE_JOB, seedBillingClickFixture } from "../../scripts/billingClickFixture";
import { recordProposal } from "../../lib/ask/proposals";
import { startChangeOrderCommand } from "../../lib/ask/commands/changeOrders";
import { draftPurchaseOrderCommand } from "../../lib/ask/commands/purchaseOrders";
import { prepareLienWaiverCommand } from "../../lib/ask/commands/lienWaivers";
import { startPayApplicationCommand } from "../../lib/ask/commands/payApplications";
import { postTakeoffToEstimateCommand } from "../../lib/ask/commands/takeoff";
import type { CommandInput, HandoffCommandDefinition } from "../../lib/ask/commands";
import { WORKFLOW_EXAMPLES } from "../../components/askExamples";

/**
 * ASK COMMANDS, TYPED, CONFIRMED, AND CHECKED IN THE DATABASE. LOCAL ONLY:
 * `pnpm test:e2e -- --ask-click`.
 *
 * Each test types a sentence into Ask on /ai, taps the card's button, checks
 * the page opened with the form filled in, presses the page's own button,
 * and reads the record — and the card's settled row — back from this run's
 * throwaway database. The fixture is the billing click list's job.
 *
 * TWO MODES, and the run says which. With ANTHROPIC_API_KEY set, the
 * sentence goes to the real model and the card is whatever it proposed —
 * routing included. Without it (no key travels to a laptop by default),
 * POST /api/ask is answered with the card the server WOULD have sent: the
 * command's real `resolve` runs against this database, `recordProposal`
 * writes the real row, and the stream carries that row's id. Everything
 * after the typing — the card, the hand-off, the prefill, the save, the
 * settle — is the product. Only the model's choice of command is skipped,
 * and that is what the routing eval measures.
 */

const REAL_MODEL = Boolean(process.env.ANTHROPIC_API_KEY);
let page: Page;
let monitor: HealthMonitor;
let jobId = "";
let actor = { companyId: "", userId: "", principal: { role: "OWNER" as const, jobFunction: null } };

test.describe.configure({ timeout: 90_000 });
test.use({ actionTimeout: 15_000 });

test.beforeAll(async ({ browser }) => {
  test.info().annotations.push({ type: "mode", description: REAL_MODEL ? "real model" : "stubbed model, real card row" });
  const user = await prisma.user.findFirstOrThrow({ where: { email: PERSONAS.main.email } });
  actor = { companyId: user.companyId, userId: user.id, principal: { role: "OWNER", jobFunction: null } };
  const existing = await prisma.job.findFirst({ where: { companyId: user.companyId, name: FIXTURE_JOB }, select: { id: true } });
  jobId = existing?.id ?? (await seedBillingClickFixture(prisma, user.companyId)).jobId;
  page = await (await browser.newContext()).newPage();
  monitor = new HealthMonitor(page);
  await signInAs(page, PERSONAS.main.email);
});

/** Types `question` into Ask and returns the card's id once it is on screen. */
async function ask(question: string, command: HandoffCommandDefinition, input: CommandInput): Promise<string> {
  let cardId = "";
  if (!REAL_MODEL) {
    const today = new Date().toISOString().slice(0, 10);
    const resolution = await command.resolve({ ...actor, today }, input);
    if (resolution.kind !== "ready") throw new Error(`${command.name} resolved ${resolution.kind}: ${JSON.stringify(resolution)}`);
    const { id, expiresAt } = await recordProposal({
      actor,
      command: command.name,
      mode: command.mode,
      question,
      input,
      resolved: resolution.resolved,
      preview: resolution.preview,
      model: "e2e-stub",
      toolUseId: `e2e-${command.name}`,
      toolUseIdsInContext: [],
    });
    cardId = id;
    const proposal = {
      proposalId: id,
      command: command.name,
      title: command.title,
      button: command.button,
      mode: command.mode,
      handoffHref: command.handoffHref(id, resolution.resolved),
      preview: resolution.preview,
      warnings: resolution.warnings,
      alsoRequested: [],
      expiresAt: expiresAt.toISOString(),
    };
    await page.unroute("**/api/ask");
    await page.route("**/api/ask", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/x-ndjson",
        // Exactly what lib/ask/answer.ts streams: the halt, then the stream
        // ends. No `done` follows a card (a bare one crashed the panel).
        body: `${JSON.stringify({ type: "proposal", proposal })}\n`,
      }),
    );
  }
  await page.goto("/ai");
  await expectHealthy(page, "/ai", { monitor });
  const panel = page.locator("[data-tour=ai-chat]");
  await panel.getByLabel("Ask about your jobs").fill(question);
  await panel.getByRole("button", { name: "Ask", exact: true }).click();
  await expect(panel.getByText(command.title).first()).toBeVisible({ timeout: 60_000 });
  const link = panel.getByRole("link", { name: command.button });
  if (!cardId) cardId = new URL((await link.getAttribute("href"))!, "http://x").searchParams.get("draft") ?? "";
  await link.click();
  return cardId;
}

async function settled(cardId: string) {
  await expect.poll(async () => (await prisma.askProposal.findUnique({ where: { id: cardId } }))?.outcome, { message: "the card should settle" }).toBe("OK");
}

test("start a change order: the Estimate tab's form opens filled in, and Start draft creates it", async () => {
  const card = await ask("start a change order on ZZ Click Billing for 12 extra door frames", startChangeOrderCommand, {
    jobName: "ZZ Click Billing",
    title: "12 extra door frames",
  });
  await expect(page).toHaveURL(new RegExp(`/jobs/${jobId}/estimate\\?draft=`));
  const title = page.getByLabel("New change order");
  await expect(title).toHaveValue(/12 extra door frames/i);
  await page.getByRole("button", { name: "Start draft" }).click();
  await expect.poll(() => prisma.changeOrder.count({ where: { jobId, title: { contains: "door frames", mode: "insensitive" }, status: "DRAFT" } })).toBe(1);
  await settled(card);
});

test("make a PO: the Buyout row opens with vendor and quantity, and Add to draft PO creates the line", async () => {
  const card = await ask("make a PO to ZZ Click ABC Building for 200 sheets of five-eighths type X on ZZ Click Billing", draftPurchaseOrderCommand, {
    jobName: "ZZ Click Billing",
    vendorName: "ZZ Click ABC Building",
    material: "five-eighths type X",
    quantity: "200",
  });
  await expect(page).toHaveURL(new RegExp(`/jobs/${jobId}/buyout\\?draft=`));
  await expect(page.getByLabel("Quantity to buy of 5/8 type X board")).toHaveValue("200");
  const row = page.locator("li", { has: page.getByLabel("Quantity to buy of 5/8 type X board") });
  await expect(row.locator('select[name="vendorId"] option:checked')).toHaveText("ZZ Click ABC Building");
  await row.locator('input[name="unitPrice"]').fill("14.50");
  await row.getByRole("button", { name: "Add to draft PO" }).last().click();
  await expect
    .poll(() => prisma.purchaseOrderLine.count({ where: { purchaseOrder: { jobId, vendor: { name: "ZZ Click ABC Building" }, status: "DRAFT" }, quantity: 200 } }))
    .toBe(1);
  await settled(card);
});

test("send the lien waiver for pay app 2: the issue form opens with the application's figures and empty exceptions", async () => {
  const card = await ask("send the lien waiver for ZZ Click Billing pay app 2", prepareLienWaiverCommand, { jobName: "ZZ Click Billing", payAppNumber: "2" });
  await expect(page).toHaveURL(new RegExp(`/jobs/${jobId}/billing\\?draft=`));
  await expect(page.getByLabel("Form")).toHaveValue(/CONDITIONAL/i);
  await expect(page.getByLabel("Through date")).toHaveValue("2026-10-31");
  await expect(page.getByLabel(/^Amount/)).toHaveValue("19800.00");
  // The one figure the app never fills in.
  await expect(page.getByLabel(/^Excepted from this waiver/)).toHaveValue("");
  await page.getByLabel(/^Excepted from this waiver/).fill("0");
  await page.getByRole("button", { name: "Issue waiver", exact: true }).click();
  await expect.poll(() => prisma.lienWaiver.count({ where: { jobId, invoice: { number: 2 }, revokedAt: null } })).toBe(1);
  await settled(card);
});

test("bill for a month: the pay application form opens on that month's last day", async () => {
  // November, not October: the fixture's application #2 already runs to
  // 2026-10-31, and that card offers a link rather than a form.
  await ask("bill ZZ Click Billing for November 2026", startPayApplicationCommand, { jobName: "ZZ Click Billing", period: "November 2026" });
  await expect(page).toHaveURL(new RegExp(`/jobs/${jobId}/billing\\?draft=`));
  await expect(page.locator('form input[name="periodTo"]').first()).toHaveValue("2026-11-30");
  // Submitting needs per-line work the card deliberately does not carry; the
  // record half of this command is the person's typing, so it stops here.
});

test("update the estimate from takeoff: the takeoff tab opens with that sheet's unposted measurements ticked", async () => {
  // A sheet with two counts (a count needs no scale), neither on the estimate. The PDF is never
  // fetched: the list is rows, and this checks the list.
  const job = await prisma.job.findUniqueOrThrow({ where: { id: jobId }, select: { companyId: true } });
  const plan = await prisma.takeoffPlan.create({ data: { companyId: job.companyId, jobId, fileUrl: "https://example.test/ask-click.pdf", fileName: "ask-click.pdf" } });
  const page2 = await prisma.takeoffPlanPage.create({ data: { planId: plan.id, pageNumber: 1, label: "A101" } });
  for (const label of ["Corridor wall", "Unit demising"]) {
    await prisma.takeoffMeasurement.create({ data: { pageId: page2.id, kind: "COUNT", label, xs: [10], ys: [10] } });
  }
  await ask("update the ZZ Click Billing estimate from the takeoff", postTakeoffToEstimateCommand, { jobName: "ZZ Click Billing" });
  await expect(page).toHaveURL(new RegExp(`/jobs/${jobId}/takeoff\\?draft=`));
  for (const label of ["Corridor wall", "Unit demising"]) {
    await expect(page.locator("li", { hasText: label }).locator('input[type="checkbox"]')).toBeChecked();
  }
  // The control: without the card the same rows start unticked, so the ticks
  // above came from the draft and not from the list's default.
  await page.goto(`/jobs/${jobId}/takeoff`);
  await expect(page.locator("li", { hasText: "Corridor wall" }).locator('input[type="checkbox"]')).not.toBeChecked();
  // Adding them needs a wall type and a scale picked on the page; the card
  // stops at the ticks, which is the decision it hands over.
});

test("the empty panel lists what you can say by workflow, and a tap fills the box without sending", async () => {
  await page.goto("/ai");
  await expectHealthy(page, "/ai", { monitor });
  const panel = page.locator("[data-tour=ai-chat]");
  const say = panel.locator("[data-ask=what-you-can-say]");
  await expect(say.getByText("What you can say")).toBeVisible();
  for (const group of WORKFLOW_EXAMPLES) {
    const section = say.getByRole("region", { name: group.workflow });
    await expect(section.getByRole("button"), group.workflow).toHaveCount(2);
    for (const example of group.examples) await expect(section.getByRole("button", { name: example.say })).toBeVisible();
  }
  await say.screenshot({ path: test.info().outputPath("ask-what-you-can-say.png") });

  // Control first: nothing has asked yet, so a request seen after the tap
  // can only be the tap's.
  let asks = 0;
  page.on("request", (request) => {
    if (request.url().includes("/api/ask") && request.method() === "POST") asks += 1;
  });
  const box = panel.getByLabel("Ask about your jobs");
  await expect(box).toHaveValue("");
  await say.getByRole("button", { name: "Bill the retainage" }).click();
  await expect(box).toHaveValue("Bill the retainage ");
  await expect(box).toBeFocused();
  await page.waitForTimeout(1_000);
  expect(asks, "a workflow chip must fill the box, never send").toBe(0);
});
