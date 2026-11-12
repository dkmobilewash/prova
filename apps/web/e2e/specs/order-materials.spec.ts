import { test, expect } from "@playwright/test";
import { prisma } from "@prova/db";
import { signInAs } from "../lib/signIn";
import { PERSONAS } from "../lib/personas";
import { HealthMonitor, expectHealthy } from "../lib/health";

/**
 * ── "ORDER MATERIALS" ON A CONTRACTED JOB, INVENTED DATA (CI) ──
 *
 * The Baker walk (e2e/local/price-list-import.local.spec.ts) is local-only, real
 * drawings; this is its CI floor. A contracted job with three material lines, two of
 * them on the supplier's price list in boxes and pails: one press makes PO 1, a
 * draft, in whole packs, and names the line the list does not price. Send PO to supplier opens
 * a preview that sends nothing.
 */
const TAG = `ZZ-E2E Order ${Date.now()}`;

test("Order materials makes a draft PO in whole packs and names what it could not price", async ({ page }) => {
  const monitor = new HealthMonitor(page);
  await signInAs(page, PERSONAS.gcProposal.email);
  await page.goto("/dashboard");
  const { companyId } = await prisma.user.findFirstOrThrow({ where: { email: PERSONAS.gcProposal.email }, select: { companyId: true } });
  const gc = await prisma.contact.create({ data: { companyId, name: `${TAG} GC` } });
  const job = await prisma.job.create({ data: { companyId, contactId: gc.id, name: `${TAG} job`, status: "CONTRACTED" } });
  const vendor = await prisma.vendor.create({ data: { companyId, name: `${TAG} Supply` } });
  const material = async (description: string, unit: string, quantity: string, quote?: { description: string; unit: string; price: string }) => {
    const entry = await prisma.lineItemCatalogEntry.create({ data: { companyId, description: `${TAG} ${description}`, unit } });
    if (quote) await prisma.vendorPriceQuote.create({ data: { companyId, vendorId: vendor.id, catalogEntryId: entry.id, description: quote.description, unit: quote.unit, unitPrice: quote.price, quotedOn: new Date(), source: "PRICE_LIST" } });
    return prisma.jobLineItem.create({ data: { jobId: job.id, description, unit, quantity, costCategory: "MATERIAL", sourceCatalogEntryId: entry.id } });
  };
  await material("drywall screws, Type S, per 1,000", "M", "12.2", { description: "Drywall Screws Fine Thread #6 (5000/box)", unit: "BX", price: "42.50" });
  await material("joint compound", "LB", "130", { description: "All Purpose Joint Compound 4.5 gal / 61.7 lb", unit: "PAIL", price: "21.40" });
  await material("corner bead", "EA", "40");

  await page.goto(`/jobs/${job.id}/estimate`);
  await expectHealthy(page, "the contracted estimate", { monitor });
  await expect.poll(() => page.locator('[data-order="go"]').evaluate((el) => Object.keys(el).some((k) => k.startsWith("__reactFiber$")))).toBe(true);
  await page.locator('[data-order="supplier"]').selectOption({ label: `${TAG} Supply` });
  await page.locator('[data-order="go"]').click();
  // 12.2 thousand screws = 3 boxes of 5,000 ($127.50); 130 lb = 3 pails of 61.7 lb ($64.20).
  await expect(page.locator('[data-order="po"]')).toHaveText(["PO 1: 2 lines, $191.70, draft"], { timeout: 30_000 });
  await expect(page.locator('[data-order="skipped"]')).toContainText(`corner bead: not on ${TAG} Supply's price list`);
  const lines = await prisma.purchaseOrderLine.findMany({ where: { purchaseOrder: { jobId: job.id } }, orderBy: { unit: "asc" }, select: { unit: true, quantity: true, unitPrice: true } });
  expect(lines.map((l) => [l.unit, Number(l.quantity), Number(l.unitPrice)])).toEqual([
    ["BX", 3, 42.5],
    ["PAIL", 3, 21.4],
  ]);
  expect((await prisma.purchaseOrder.findFirstOrThrow({ where: { jobId: job.id } })).status).toBe("DRAFT");

  // Send PO to supplier: the first press is a preview and sends nothing. This supplier's list gave
  // no email, so it says so and cannot send until one is typed. (The send itself is walked against
  // a test inbox in the Baker walk; CI has no email to send through.)
  await page.locator('[data-po-send="open"]').click();
  await expect(page.locator('[data-po-send="preview"]')).toContainText("Preview: nothing has been sent yet.");
  await expect(page.locator('[data-po-send="summary"]')).toHaveText(`PO 1 to ${TAG} Supply: 2 lines, $191.70. Sending issues it on the date below.`);
  await expect(page.locator('[data-po-send="no-contact"]')).toBeVisible();
  await expect(page.locator('[data-po-send="send"]')).toBeDisabled();
  expect(await prisma.outboundMessage.count({ where: { jobId: job.id } })).toBe(0);
  expect((await prisma.purchaseOrder.findFirstOrThrow({ where: { jobId: job.id } })).status).toBe("DRAFT");

  // Pressed again while the draft is open: refused, nothing ordered twice.
  await page.locator('[data-order="go"]').click();
  await expect(page.locator('[data-order="panel"] [role="alert"]')).toContainText(`PO 1 from ${TAG} Supply is still a draft on this job.`);
  expect(await prisma.purchaseOrder.count({ where: { jobId: job.id } })).toBe(1);
  expect(monitor.crashes).toEqual([]);
});
