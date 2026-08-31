import { PrismaClient } from "@prisma/client";
import { loadEnvFiles } from "./load-env.mjs";
import { describe } from "./connection-target.mjs";

/**
 * Builds a demonstrable company: a few jobs at genuinely different stages,
 * with the costs, dates and paperwork that make every screen show something
 * true.
 *
 * The problem this solves is not "the database is empty". It is that a
 * product whose whole argument is DERIVED state demos as blank without data
 * to derive from. The catalog's variance warning, the field report's missing
 * day, the vendor price movement, equipment utilisation, WIP over/under
 * billing, retainage held — every one of those is a good feature that shows
 * nothing at all against a job called "test" worth $0.00.
 *
 * SAFETY. This writes a lot of rows, so it refuses to run unless you name
 * the database you mean. It prints the host first and compares it against
 * SEED_EXPECT_HOST; a mismatch stops before a single write. The same
 * reasoning as migrate-deploy printing its target: the incident this
 * codebase remembers is not a command failing, it is a command succeeding
 * loudly against a database nobody was looking at.
 *
 *   SEED_EXPECT_HOST=ep-icy-hat-afqau56u node scripts/seed-demo.mjs
 *
 * It is scoped to ONE company — the first one, or SEED_COMPANY_ID — and
 * every row it writes is tagged in a way `--undo` can find again, so a demo
 * dataset can be removed without touching anything a person entered.
 */

loadEnvFiles();

const MARK = "[demo]";
const UNDO = process.argv.includes("--undo");

const target = describe(process.env.DATABASE_URL);
if (!target) {
  console.error("seed: DATABASE_URL is missing or unreadable. Nothing done.");
  process.exit(1);
}
console.log(`seed: writing to      ${target.label}`);

const expect = process.env.SEED_EXPECT_HOST?.trim();
if (!expect) {
  console.error(
    "\nseed: refusing to run without SEED_EXPECT_HOST.\n" +
      "seed: name the database you mean, e.g.\n" +
      `seed:   SEED_EXPECT_HOST=${target.host.split(".")[0]} node scripts/seed-demo.mjs\n` +
      "seed: this script writes a lot of rows and the one thing it must never\n" +
      "seed: do is write them somewhere nobody was looking.",
  );
  process.exit(1);
}
if (!target.host.includes(expect)) {
  console.error(
    `\nseed: REFUSING — you asked for "${expect}" and DATABASE_URL points at\n` +
      `seed: ${target.host}\n` +
      "seed: nothing has been written.",
  );
  process.exit(1);
}
console.log(`seed: host matches    "${expect}" ✓`);

const prisma = new PrismaClient();

/** Dates are stored at UTC midnight everywhere in this app. */
const day = (offsetDays) => {
  const d = new Date(Date.now() + offsetDays * 86_400_000);
  return new Date(`${d.toISOString().slice(0, 10)}T00:00:00.000Z`);
};
const iso = (d) => d.toISOString().slice(0, 10);

async function main() {
  const company = process.env.SEED_COMPANY_ID
    ? await prisma.company.findUnique({ where: { id: process.env.SEED_COMPANY_ID } })
    : await prisma.company.findFirst({ orderBy: { createdAt: "asc" } });
  if (!company) {
    console.error("seed: no company found. Sign in to the app once first.");
    process.exit(1);
  }
  const user = await prisma.user.findFirst({ where: { companyId: company.id } });
  console.log(`seed: company         ${company.name} (${company.id})`);

  if (UNDO) return undo(company.id);

  // ---------------------------------------------------------------- clients
  const gc = await prisma.contact.create({
    data: {
      companyId: company.id,
      name: `Brackett Construction ${MARK}`,
      email: "pm@brackettconstruction.example",
      phone: "(503) 555-0142",
      defaultRetainagePercent: "5",
      paymentTermsDays: 45,
    },
  });
  const gc2 = await prisma.contact.create({
    data: {
      companyId: company.id,
      name: `Halvorsen Builders ${MARK}`,
      email: "office@halvorsenbuilders.example",
      phone: "(503) 555-0188",
      defaultRetainagePercent: "10",
      paymentTermsDays: 30,
    },
  });

  // ------------------------------------------------------------------- jobs
  // Deliberately at four different stages, because a demo that shows four
  // jobs all in the same state shows one screen four times.
  const riverside = await prisma.job.create({
    data: {
      companyId: company.id,
      contactId: gc.id,
      name: `Riverside Medical Office Building ${MARK}`,
      scope: "Metal framing, drywall and ACT ceilings, levels 1–3.",
      status: "IN_PROGRESS",
      startDate: day(-52),
      endDate: day(38),
      retainagePercent: "5",
    },
  });
  const northgate = await prisma.job.create({
    data: {
      companyId: company.id,
      contactId: gc2.id,
      name: `Northgate Apartments Phase 2 ${MARK}`,
      scope: "Load-bearing metal stud framing and drywall, 48 units.",
      status: "CONTRACTED",
      startDate: day(21),
      endDate: day(180),
      retainagePercent: "10",
    },
  });
  const lakeshore = await prisma.job.create({
    data: {
      companyId: company.id,
      contactId: gc.id,
      name: `Lakeshore Retail Fit-Out ${MARK}`,
      scope: "Tenant improvement — partitions, soffits, level 5 finish.",
      status: "ESTIMATE",
      retainagePercent: "5",
    },
  });

  // -------------------------------------------------------------- line items
  const lines = async (jobId, rows) =>
    Promise.all(
      rows.map((r) =>
        prisma.jobLineItem.create({
          data: {
            jobId,
            description: r.d,
            quantity: String(r.q),
            unit: r.u,
            unitPrice: String(r.p),
            budgetedUnitCost: String(r.c),
            // The PM's live forecast. `budgetedUnitCost` alone is the frozen
            // baseline and job health/WIP read this one, so a job with five
            // cost entries and no forecast still reports "no cost estimate
            // yet" — found by walking the dashboard, not by reading code.
            currentEstimatedUnitCost: String(r.f ?? r.c),
            tradeScope: r.t ?? "METAL_FRAMING_DRYWALL",
          },
        }),
      ),
    );

  const riversideLines = await lines(riverside.id, [
    { d: "20ga 3-5/8 metal stud framing, interior partitions", q: 18400, u: "SF", p: 4.15, c: 2.9 },
    { d: '5/8" Type X gypsum board, hang and finish to level 4', q: 36800, u: "SF", p: 3.4, c: 2.35, f: 4.7 },
    { d: "ACT ceiling grid and tile, 2x2", q: 9600, u: "SF", p: 5.2, c: 3.6, t: "ACOUSTICAL_CEILINGS" },
    { d: "Sound attenuation batt insulation", q: 12200, u: "SF", p: 1.35, c: 0.82 },
  ]);
  await lines(northgate.id, [
    { d: "Load-bearing metal stud framing, 16ga", q: 42000, u: "SF", p: 5.6, c: 3.95 },
    { d: 'Gypsum board, 5/8" Type X, two sides', q: 84000, u: "SF", p: 3.25, c: 2.28 },
  ]);
  await lines(lakeshore.id, [
    { d: "Interior partitions, 20ga 3-5/8", q: 4200, u: "SF", p: 4.4, c: 3.05 },
    { d: "Soffits and bulkheads, framed and finished", q: 780, u: "LF", p: 22.5, c: 15.4 },
  ]);

  // ------------------------------------------------------- costs on the live job
  // Enough that WIP, percent-complete and margin all have something real to
  // say. Under-billed on purpose: it is the more interesting state to show.
  const costRows = [
    { line: 0, d: "Stud and track delivery — Bolt Building Supply", a: 31200, cat: "MATERIAL", at: -44 },
    { line: 0, d: "Framing labor, weeks 1–4", a: 21800, cat: "LABOR", at: -30 },
    { line: 1, d: "Board delivery, levels 1–2", a: 42600, cat: "MATERIAL", at: -26 },
    { line: 1, d: "Hang and finish labor, weeks 5–7", a: 28400, cat: "LABOR", at: -12 },
    { line: 3, d: "Insulation material", a: 6900, cat: "MATERIAL", at: -20 },
  ];
  for (const c of costRows) {
    await prisma.costEntry.create({
      data: {
        lineItemId: riversideLines[c.line].id,
        description: `${c.d} ${MARK}`,
        amount: String(c.a),
        category: c.cat,
        incurredAt: day(c.at),
      },
    });
  }

  const cedar = await prisma.job.create({
    data: {
      companyId: company.id,
      contactId: gc2.id,
      name: `Cedar Park Elementary ${MARK}`,
      scope: "Classroom wing — framing, drywall, ceilings. Substantially complete.",
      status: "COMPLETE",
      startDate: day(-240),
      endDate: day(-24),
      substantialCompletionDate: day(-21),
      retainagePercent: "10",
    },
  });
  const cedarLines = await lines(cedar.id, [
    { d: "Metal framing and drywall, classroom wing", q: 22000, u: "SF", p: 6.1, c: 4.2, f: 4.35 },
  ]);
  await prisma.costEntry.create({
    data: {
      lineItemId: cedarLines[0].id,
      description: `Framing and board, full scope ${MARK}`,
      amount: "95700",
      category: "MATERIAL",
      incurredAt: day(-60),
    },
  });
  // Billed in full, retainage still held — the money a sub actually chases.
  const cedarInvoice = await prisma.invoice.create({
    data: {
      jobId: cedar.id,
      number: 1,
      description: `Final pay application ${MARK}`,
      amount: "134200",
      issuedAt: day(-30),
      dueAt: day(-1),
      status: "PAID",
      retainageWithheld: "13420",
    },
  });
  await prisma.payment.create({
    data: { invoiceId: cedarInvoice.id, amount: "134200", method: "ACH", receivedAt: day(-3) },
  });

  // ------------------------------------------------------------- crew on site
  // "Crews today" reads JobAssignment; without it a live job shows
  // "Nobody assigned yet" next to four weeks of logged cost.
  if (user) {
    for (const jobId of [riverside.id, northgate.id]) {
      await prisma.jobAssignment.create({ data: { jobId, userId: user.id } });
    }
  }

  // ------------------------------------------------------------ billing
  // One invoice paid in full, one part-paid and overdue. The second is the
  // interesting one: it drives AR ageing, the GC payment-reliability read,
  // and the retainage held figure.
  const inv1 = await prisma.invoice.create({
    data: {
      jobId: riverside.id,
      number: 1,
      description: `Pay application 1 ${MARK}`,
      amount: "86450",
      issuedAt: day(-38),
      dueAt: day(-8),
      status: "PAID",
      retainageWithheld: "4550",
    },
  });
  await prisma.payment.create({
    data: { invoiceId: inv1.id, amount: "86450", method: "ACH", receivedAt: day(-11) },
  });

  const inv2 = await prisma.invoice.create({
    data: {
      jobId: riverside.id,
      number: 2,
      description: `Pay application 2 ${MARK}`,
      amount: "62300",
      issuedAt: day(-24),
      dueAt: day(-9),
      status: "PARTIALLY_PAID",
      retainageWithheld: "3279",
    },
  });
  await prisma.payment.create({
    data: { invoiceId: inv2.id, amount: "30000", method: "Check", receivedAt: day(-4) },
  });

  // -------------------------------------------------------------- compliance
  // Spread across the urgency ladder deliberately: one lapsed, one inside a
  // COI's 30-day horizon, one comfortably current. A demo where everything
  // is current shows an empty panel and proves nothing.
  const docs = [
    { t: "CERTIFICATE_OF_INSURANCE", p: "Western Mutual — General Liability", e: -6 },
    { t: "CERTIFICATE_OF_INSURANCE", p: "Cascade Surety — Workers Comp", e: 19 },
    { t: "LIEN_WAIVER", p: "Brackett Construction — conditional progress", e: null },
    { t: "CERTIFIED_PAYROLL", p: "Week ending " + iso(day(-7)), e: null },
  ];
  for (const d of docs) {
    await prisma.complianceDocument.create({
      data: {
        companyId: company.id,
        jobId: riverside.id,
        type: d.t,
        partyName: `${d.p} ${MARK}`,
        status: "RECEIVED",
        expiresAt: d.e === null ? null : day(d.e),
      },
    });
  }

  console.log("seed: jobs, line items, costs, crew, invoices and compliance written");
  return { company, user, gc, riverside, northgate, lakeshore, riversideLines };
}

async function undo(companyId) {
  // Ordered children-first. Only rows this script tagged.
  const jobs = await prisma.job.findMany({
    where: { companyId, name: { contains: MARK } },
    select: { id: true },
  });
  const jobIds = jobs.map((j) => j.id);

  const counts = {};
  const del = async (label, fn) => {
    try {
      const r = await fn();
      counts[label] = r.count ?? 0;
    } catch (e) {
      counts[label] = `skipped (${e.message.split("\n")[0].slice(0, 60)})`;
    }
  };

  if (jobIds.length) {
    const lineItems = await prisma.jobLineItem.findMany({
      where: { jobId: { in: jobIds } },
      select: { id: true },
    });
    const lineIds = lineItems.map((l) => l.id);
    await del("costEntry", () => prisma.costEntry.deleteMany({ where: { lineItemId: { in: lineIds } } }));
    await del("equipmentAssignment", () =>
      prisma.equipmentAssignment.deleteMany({ where: { jobId: { in: jobIds } } }),
    );
    await del("dailyFieldReport", () =>
      prisma.dailyFieldReport.deleteMany({ where: { jobId: { in: jobIds } } }),
    );
    await del("payment", () =>
      prisma.payment.deleteMany({ where: { invoice: { jobId: { in: jobIds } } } }),
    );
    await del("invoice", () => prisma.invoice.deleteMany({ where: { jobId: { in: jobIds } } }));
    await del("complianceDocument", () =>
      prisma.complianceDocument.deleteMany({ where: { jobId: { in: jobIds } } }),
    );
    await del("jobAssignment", () =>
      prisma.jobAssignment.deleteMany({ where: { jobId: { in: jobIds } } }),
    );
    await del("jobLineItem", () => prisma.jobLineItem.deleteMany({ where: { jobId: { in: jobIds } } }));
    await del("job", () => prisma.job.deleteMany({ where: { id: { in: jobIds } } }));
  }
  await del("vendorPriceQuote", () =>
    prisma.vendorPriceQuote.deleteMany({ where: { companyId, description: { contains: MARK } } }),
  );
  await del("vendor", () => prisma.vendor.deleteMany({ where: { companyId, name: { contains: MARK } } }));
  await del("equipment", () =>
    prisma.equipment.deleteMany({ where: { companyId, name: { contains: MARK } } }),
  );
  await del("lineItemCatalogEntry", () =>
    prisma.lineItemCatalogEntry.deleteMany({ where: { companyId, description: { contains: MARK } } }),
  );
  await del("contact", () => prisma.contact.deleteMany({ where: { companyId, name: { contains: MARK } } }));

  console.log("seed: removed —", JSON.stringify(counts));
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (err) => {
    console.error("\nseed: FAILED —", err.message);
    await prisma.$disconnect();
    process.exit(1);
  });
