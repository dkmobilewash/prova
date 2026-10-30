import { PDFDocument, StandardFonts } from "pdf-lib";
import type { PrismaClient } from "@prova/db";

/**
 * One job holding everything the billing click test walks through. Invented
 * data; every name starts with `ZZ Click` so it reads as a test row and so a
 * re-run can find and replace exactly its own rows and nothing else.
 *
 * Writes rows directly, because a local fixture has no signed-in user to run
 * the actions as. What the click test proves is the screens, and those read
 * these rows through the real code. Run it through billing-click-fixture.ts,
 * which holds the local-only refusal.
 *
 * It uses no column added by the unmerged branches, so the script itself can
 * merge first; the CLI refuses a database that lacks their migrations.
 */

export const FIXTURE_JOB = "ZZ Click Billing Test";
const VENDOR_PREFIX = "ZZ Click ";
const LOCAL_NUMBER = "ZZ-CLICK";
const BURDEN_NOTE = "ZZ Click billing test";

const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

export async function removeBillingClickFixture(prisma: PrismaClient, companyId: string) {
  for (const job of await prisma.job.findMany({ where: { companyId, name: FIXTURE_JOB }, select: { id: true } })) {
    const jobId = job.id;
    // Raw, because the PO models reach main after this file may; the CLI has
    // already refused a database without those tables.
    await prisma.$executeRaw`DELETE FROM "PurchaseOrderLine" WHERE "purchaseOrderId" IN (SELECT id FROM "PurchaseOrder" WHERE "jobId" = ${jobId})`;
    await prisma.$executeRaw`DELETE FROM "PurchaseOrder" WHERE "jobId" = ${jobId}`;
    await prisma.$executeRaw`DELETE FROM "PurchaseOrderCounter" WHERE "jobId" = ${jobId}`;
    await prisma.lienWaiver.deleteMany({ where: { jobId } });
    await prisma.complianceDocument.deleteMany({ where: { jobId } });
    await prisma.payment.deleteMany({ where: { invoice: { jobId } } });
    await prisma.invoiceLineItem.deleteMany({ where: { invoice: { jobId } } });
    await prisma.invoice.deleteMany({ where: { jobId } });
    await prisma.invoiceCounter.deleteMany({ where: { jobId } });
    await prisma.tmTicket.deleteMany({ where: { jobId } });
    await prisma.submittalRevision.deleteMany({ where: { submittal: { jobId } } });
    await prisma.submittal.deleteMany({ where: { jobId } });
    await prisma.submittalCounter.deleteMany({ where: { jobId } });
    await prisma.materialOrderDelivery.deleteMany({ where: { order: { jobId } } });
    await prisma.materialOrder.deleteMany({ where: { jobId } });
    await prisma.materialOrderCounter.deleteMany({ where: { jobId } });
    await prisma.jobLineItem.deleteMany({ where: { jobId } });
    await prisma.changeOrderLineItemEdit.deleteMany({ where: { changeOrder: { jobId } } });
    await prisma.changeOrder.deleteMany({ where: { jobId } });
    await prisma.changeOrderCounter.deleteMany({ where: { jobId } });
    await prisma.jobBidRecap.deleteMany({ where: { jobId } });
    await prisma.job.delete({ where: { id: jobId } });
  }
  await prisma.vendor.deleteMany({ where: { companyId, name: { startsWith: VENDOR_PREFIX } } });
  await prisma.lineItemCatalogEntry.deleteMany({ where: { companyId, description: { startsWith: VENDOR_PREFIX } } });
  await prisma.contact.deleteMany({ where: { companyId, name: { startsWith: VENDOR_PREFIX } } });
  await prisma.fringeRateSchedule.deleteMany({ where: { companyId, craftClassification: { unionLocal: { localNumber: LOCAL_NUMBER } } } });
  await prisma.craftClassification.deleteMany({ where: { companyId, unionLocal: { localNumber: LOCAL_NUMBER } } });
  await prisma.unionLocal.deleteMany({ where: { companyId, localNumber: LOCAL_NUMBER } });
  await prisma.employerBurdenRate.deleteMany({ where: { companyId, note: BURDEN_NOTE } });
}

export async function seedBillingClickFixture(prisma: PrismaClient, companyId: string) {
  await removeBillingClickFixture(prisma, companyId);

  const contact = await prisma.contact.create({
    data: { companyId, name: "ZZ Click General Contractors", address: "100 Test Plaza, Denver, CO 80202" },
  });
  const job = await prisma.job.create({
    data: {
      companyId,
      contactId: contact.id,
      name: FIXTURE_JOB,
      status: "CONTRACTED",
      scope: "Framing, drywall and fireproofing",
      projectLocation: "1 Fixture Way, Denver, CO",
      contractNumber: "SC-1001",
      retainagePercent: "10",
      siteTimeZone: "America/Denver",
    },
  });
  const jobId = job.id;

  // The bid's rates. The burden is company-wide, so it is added only when the
  // company has none; an existing rate would change the expected figures, and
  // the CLI says so.
  await prisma.jobBidRecap.create({
    data: {
      companyId,
      jobId,
      laborMarkupPercent: "15",
      materialMarkupPercent: "12",
      subcontractorMarkupPercent: "5",
      equipmentMarkupPercent: "20",
      overheadPercent: "10",
      profitPercent: "8",
    },
  });
  const burdens = await prisma.employerBurdenRate.count({ where: { companyId } });
  if (burdens === 0) {
    await prisma.employerBurdenRate.create({
      data: { companyId, effectiveDate: day("2026-01-01"), percent: "31.250", note: BURDEN_NOTE },
    });
  }
  const local = await prisma.unionLocal.create({
    data: { companyId, parentInternational: "UBC", localNumber: LOCAL_NUMBER, jurisdictionName: "Test" },
  });
  const craft = await prisma.craftClassification.create({
    data: { companyId, unionLocalId: local.id, name: "ZZ Click Carpenter JM" },
  });
  await prisma.craftClassification.create({ data: { companyId, unionLocalId: local.id, name: "ZZ Click Laborer" } });
  await prisma.fringeRateSchedule.create({
    data: {
      companyId,
      craftClassificationId: craft.id,
      baseWage: "42.10",
      pensionRate: "6.50",
      vacationRate: "2.20",
      healthWelfareRate: "9.80",
      trainingRate: "0.60",
      effectiveFrom: day("2026-01-01"),
    },
  });

  const board = await prisma.lineItemCatalogEntry.create({
    data: { companyId, description: "ZZ Click 5/8 type X board", unit: "SF", defaultBudgetedUnitCost: "0.80", defaultUnitPrice: "1.50" },
  });

  // $100,000 contract, plus a $5,000 approved change order.
  const framing = await prisma.jobLineItem.create({
    data: { jobId, description: "Framing labor", unit: "LS", quantity: "1", unitPrice: "60000", budgetedUnitCost: "40000", costCategory: "LABOR" },
  });
  const boardLine = await prisma.jobLineItem.create({
    data: { jobId, description: "5/8 type X board", unit: "SF", quantity: "10000", unitPrice: "1.50", budgetedUnitCost: "0.80", costCategory: "MATERIAL", sourceCatalogEntryId: board.id },
  });
  const fireproofing = await prisma.jobLineItem.create({
    data: { jobId, description: "Spray fireproofing", unit: "LS", quantity: "1", unitPrice: "25000", budgetedUnitCost: "18000", costCategory: "SUBCONTRACTOR" },
  });
  await prisma.$transaction(async (tx) => {
    await tx.changeOrderCounter.upsert({ where: { jobId }, create: { jobId, lastNumber: 1 }, update: { lastNumber: 1 } });
    const co = await tx.changeOrder.create({
      data: {
        jobId,
        number: 1,
        title: "Added soffit at L2",
        status: "APPROVED",
        submittedOn: day("2026-08-20"),
        decidedOn: day("2026-08-25"),
        appliedAt: day("2026-08-25"),
        proposals: {
          create: { changeType: "ADD", description: "Added soffit", unit: "LS", quantity: "1", unitPrice: "5000", budgetedUnitCost: "3500" },
        },
      },
    });
    await tx.jobLineItem.create({
      data: { jobId, description: "Added soffit", unit: "LS", quantity: "1", unitPrice: "5000", budgetedUnitCost: "3500", costCategory: "LABOR", originChangeOrderId: co.id },
    });
  });

  // Two applications. The second releases $1,000 of stored material.
  const apps = [
    { number: 1, period: "2026-09-30", issued: "2026-10-01T15:00:00Z", amount: "25000.00", held: "2500.00", rows: [[framing.id, "20000", "0"], [boardLine.id, "3000", "2000"]] },
    { number: 2, period: "2026-10-31", issued: "2026-10-30T15:00:00Z", amount: "22000.00", held: "2200.00", rows: [[framing.id, "15000", "0"], [boardLine.id, "3000", "-1000"], [fireproofing.id, "5000", "0"]] },
  ] as const;
  const invoiceIds: string[] = [];
  await prisma.$transaction(async (tx) => {
    await tx.invoiceCounter.upsert({ where: { jobId }, create: { jobId, lastNumber: apps.length }, update: { lastNumber: apps.length } });
    for (const app of apps) {
      const invoice = await tx.invoice.create({
        data: {
          jobId,
          number: app.number,
          amount: app.amount,
          retainageWithheld: app.held,
          issuedAt: new Date(app.issued),
          periodTo: day(app.period),
          lineItems: {
            create: app.rows.map(([lineItemId, thisPeriodBilled, materialsStoredValue]) => ({ lineItemId, thisPeriodBilled, materialsStoredValue })),
          },
        },
      });
      invoiceIds.push(invoice.id);
    }
  });
  // Application 1 has its waiver, so the offer is about application 2.
  await prisma.lienWaiver.create({
    data: {
      companyId,
      jobId,
      invoiceId: invoiceIds[0],
      condition: "CONDITIONAL",
      stage: "PROGRESS",
      throughDate: day("2026-09-30"),
      amount: "22500",
      exceptedAmount: "0",
    },
  });

  const foundation = await prisma.vendor.create({ data: { companyId, name: "ZZ Click Foundation Supply" } });
  const spray = await prisma.vendor.create({ data: { companyId, name: "ZZ Click Spray Sub" } });
  const abc = await prisma.vendor.create({ data: { companyId, name: "ZZ Click ABC Building" } });
  const metric = await prisma.vendor.create({ data: { companyId, name: "ZZ Click Metric Board" } });
  await prisma.$transaction(async (tx) => {
    await tx.materialOrderCounter.upsert({ where: { jobId }, create: { jobId, lastNumber: 2 }, update: { lastNumber: 2 } });
    await tx.materialOrder.create({ data: { companyId, jobId, number: 1, vendorId: foundation.id, description: "Board, first drop", orderedOn: day("2026-09-03"), lineItemId: boardLine.id } });
    await tx.materialOrder.create({ data: { companyId, jobId, number: 2, vendorId: spray.id, description: "Fireproofing material", orderedOn: day("2026-09-12"), lineItemId: fireproofing.id } });
  });
  // Foundation sent September's waiver. Spray Sub sent nothing, so it is the
  // name the warning has to print on application 2.
  await prisma.complianceDocument.create({
    data: { companyId, jobId, type: "LIEN_WAIVER", partyName: foundation.name, status: "RECEIVED", periodEnd: day("2026-09-30") },
  });

  const quotedOn = day("2026-10-15");
  for (const [vendorId, unit, unitPrice] of [
    [foundation.id, "SF", "0.75"],
    [abc.id, "SF", "0.85"],
    [metric.id, "MSF", "700"],
  ] as const) {
    await prisma.vendorPriceQuote.create({
      data: { companyId, vendorId, catalogEntryId: board.id, description: board.description, unit, unitPrice, quotedOn },
    });
  }

  await prisma.tmTicket.create({
    data: {
      companyId,
      jobId,
      workDate: day("2026-10-20"),
      workDescription: "Reframed the L3 corridor soffit after the duct moved",
      snapshot: {
        labor: [
          { workerName: "Ana Ruiz", hours: "8", payType: "STRAIGHT", craftLabel: "ZZ Click Carpenter JM", lineItemDescription: "Framing labor" },
          { workerName: "Luis Ortega", hours: "2.5", payType: "OVERTIME", craftLabel: "ZZ Click Laborer", lineItemDescription: null },
        ],
        materials: [{ description: "12 lengths 20ga track", vendorName: foundation.name, orderedOn: "2026-10-20" }],
      },
      signerName: "Sam Patel (GC super)",
      signedAt: new Date("2026-10-20T22:12:00Z"),
      signaturePath: "M10 80L60 40L110 90L160 50L210 80",
    },
  });

  await prisma.$transaction(async (tx) => {
    await tx.submittalCounter.upsert({ where: { jobId }, create: { jobId, lastNumber: 2 }, update: { lastNumber: 2 } });
    await tx.submittal.create({
      data: {
        companyId,
        jobId,
        number: 1,
        title: "Metal stud and track",
        specSection: "09 22 16",
        drawingReference: "A-501",
        lastRevision: 1,
        revisions: {
          create: { revisionNumber: 1, sentOn: day("2026-09-15"), returnedOn: day("2026-09-25"), outcome: "REVISE_AND_RESUBMIT", responseNotes: "Show 20ga at the soffit" },
        },
      },
    });
    await tx.submittal.create({
      data: { companyId, jobId, number: 2, title: "Fire-rated gypsum board", specSection: "09 29 00", drawingReference: "A-502" },
    });
  });

  return { jobId, invoiceIds, burdenPreexisted: burdens > 0 };
}

/** Invented PDFs of a known length, for the submittal package's file picker. */
export async function samplePdf(label: string, pages: number): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let page = 1; page <= pages; page++) {
    doc.addPage([612, 792]).drawText(`${label}, page ${page} of ${pages}`, { x: 72, y: 700, size: 14, font });
  }
  return doc.save();
}
