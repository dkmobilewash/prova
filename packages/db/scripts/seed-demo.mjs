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
  //
  // status / accountType / msaExpirationDate / prequalificationExpiresAt
  // are set deliberately, not left at their defaults. Every one of them is
  // read back as DERIVED state — "MSA lapsed", "prequal expiring", the
  // prospect/active split on /contacts — and a demo where all three GCs
  // carry the same defaults shows one row three times, which is the exact
  // failure this script exists to prevent.
  const gc = await prisma.contact.create({
    data: {
      companyId: company.id,
      name: `Brackett Construction ${MARK}`,
      email: "pm@brackettconstruction.example",
      phone: "(503) 555-0142",
      defaultRetainagePercent: "5",
      paymentTermsDays: 45,
      status: "ACTIVE",
      accountType: "GENERAL_CONTRACTOR",
      // In force, but the prequal renews well before it does — the two
      // dates are deliberately not the same date.
      msaExpirationDate: day(196),
      prequalificationExpiresAt: day(24),
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
      status: "ACTIVE",
      accountType: "GENERAL_CONTRACTOR",
      // Already lapsed. Nothing stores "lapsed" — it is worked out from
      // this date, so the only way to demo it is to put a past date here.
      msaExpirationDate: day(-19),
      prequalificationExpiresAt: null,
    },
  });
  // A GC we are bidding to and have never worked for. PROSPECT is
  // meaningless on a contact that owns jobs, so it needs its own row: this
  // one has bid invitations below and no Job anywhere.
  const gc3 = await prisma.contact.create({
    data: {
      companyId: company.id,
      name: `Pell Development Group ${MARK}`,
      email: "preconstruction@pelldevelopment.example",
      phone: "(503) 555-0119",
      status: "PROSPECT",
      accountType: "DEVELOPER",
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
  // say. The job lands OVERBILLED by about $10k against 48% complete, which
  // is the more interesting state to show: billed ahead of work in place is
  // good cash flow and a real exposure, and it is the number a GC's auditor
  // asks about.
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
      issuedAt: day(-38),
      dueAt: day(-12),
      status: "PAID",
      retainageWithheld: "13420",
    },
  });
  await prisma.payment.create({
    data: { invoiceId: cedarInvoice.id, amount: "134200", method: "ACH", receivedAt: day(-4) },
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
  // Billed per SOV line, which is what makes it a pay application rather
  // than a lump sum — without these the G702/G703 report renders nothing.
  await prisma.invoiceLineItem.createMany({
    data: [
      { invoiceId: inv1.id, lineItemId: riversideLines[0].id, thisPeriodBilled: "52000", materialsStoredValue: "0" },
      { invoiceId: inv1.id, lineItemId: riversideLines[1].id, thisPeriodBilled: "34450", materialsStoredValue: "8200" },
    ],
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
  await prisma.invoiceLineItem.createMany({
    data: [
      { invoiceId: inv2.id, lineItemId: riversideLines[1].id, thisPeriodBilled: "48300", materialsStoredValue: "-4000" },
      { invoiceId: inv2.id, lineItemId: riversideLines[3].id, thisPeriodBilled: "14000", materialsStoredValue: "0" },
    ],
  });

  // ---------------------------------------------------------- field reports
  // A fortnight of days with a deliberate gap: the missing-day banner and
  // the week summary are the whole point of that page and both need holes
  // to show. Weekends skipped, one weekday left unfiled.
  const reportDays = [-13, -12, -11, -10, -6, -5, -3, -2, -1];
  const work = [
    ["4 framers, 2 apprentices", "Layout and track, level 2 north", "Clear, 71F", null],
    ["4 framers, 2 apprentices", "Stud framing level 2 north complete", "Clear", null],
    ["5 framers", "Level 2 south framing, in-wall blocking", "Overcast", null],
    ["5 framers", "Framing inspection passed, level 2", "Rain pm", "Inspector 2h late, crew stood down"],
    ["6 hangers", "Board hung level 2 north", "Clear", null],
    ["6 hangers", "Board hung level 2 south", "Clear, windy", null],
    ["3 tapers", "Tape and first coat, level 2 north", "Clear", null],
    ["3 tapers", "Second coat level 2 north, first coat south", "Clear", null],
    ["3 tapers, 1 framer", "Sanding level 2 north; punch framing at corridor", "Rain am", "Board delivery 3h late"],
  ];
  for (let i = 0; i < reportDays.length; i += 1) {
    const [crew, performed, weather, delays] = work[i];
    await prisma.dailyFieldReport.create({
      data: {
        companyId: company.id,
        jobId: riverside.id,
        reportDate: day(reportDays[i]),
        crewPresent: crew,
        workPerformed: performed,
        weather,
        delays,
        filedByUserId: user?.id ?? null,
      },
    });
  }

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

  // ------------------------------------------------------------ change orders
  // A mid-flight job with no change orders is not believable to anyone who
  // has run one. Two here, deliberately in different states: one approved
  // and applied — its scope IS in the contract value above — and one still
  // submitted, whose money must NOT appear anywhere until the GC decides.
  const co1 = await prisma.changeOrder.create({
    data: {
      jobId: riverside.id,
      number: 1,
      title: "Added corridor soffits, level 2",
      description: "Architect's ASI 14 — soffits at corridor bulkheads not on the bid set.",
      status: "APPROVED",
      submittedOn: day(-34),
      decidedOn: day(-27),
      decisionNotes: "Approved at owner meeting, proceed.",
      appliedAt: day(-27),
    },
  });
  await prisma.changeOrderProposal.create({
    data: {
      changeOrderId: co1.id,
      changeType: "ADD",
      description: "Corridor soffits, framed and finished — level 2",
      unit: "LF",
      quantity: "310",
      unitPrice: "24.5",
      budgetedUnitCost: "16.8",
      currentEstimatedUnitCost: "16.8",
    },
  });

  const co2 = await prisma.changeOrder.create({
    data: {
      jobId: riverside.id,
      number: 2,
      title: "Upgrade to Type X at mechanical rooms",
      description: "RFI 3 response requires 2-hour rated assembly not shown on the bid drawings.",
      status: "SUBMITTED",
      submittedOn: day(-5),
    },
  });
  await prisma.changeOrderProposal.create({
    data: {
      changeOrderId: co2.id,
      changeType: "ADD",
      description: "2-hour rated assembly, mechanical rooms 2A and 2B",
      unit: "SF",
      quantity: "1850",
      unitPrice: "6.4",
      budgetedUnitCost: "4.35",
      currentEstimatedUnitCost: "4.35",
    },
  });

  // --------------------------------------------------------------- submittals
  // Numbers come from the counter row, never from a count of surviving
  // rows — the same rule the app enforces, and a seed that fakes them would
  // hand the next real submittal a number this one already used.
  const subCounter = await prisma.submittalCounter.upsert({
    where: { jobId: riverside.id },
    create: { jobId: riverside.id, lastNumber: 2 },
    update: { lastNumber: 2 },
  });
  const sub1 = await prisma.submittal.create({
    data: {
      companyId: company.id,
      jobId: riverside.id,
      number: 1,
      title: "Gypsum board and joint treatment",
      specSection: "09 29 00",
      submittedByUserId: user?.id ?? null,
    },
  });
  await prisma.submittalRevision.create({
    data: {
      submittalId: sub1.id,
      revisionNumber: 1,
      sentOn: day(-40),
      dueBack: day(-26),
      returnedOn: day(-24),
      outcome: "APPROVED_AS_NOTED",
      responseNotes: "Approved as noted — use Type X at rated assemblies only.",
    },
  });
  const sub2 = await prisma.submittal.create({
    data: {
      companyId: company.id,
      jobId: riverside.id,
      number: 2,
      title: "Acoustical ceiling tile and grid",
      specSection: "09 51 13",
      submittedByUserId: user?.id ?? null,
    },
  });
  // Revise-and-resubmit, still open: the ball is in our court and the page
  // should say so.
  await prisma.submittalRevision.create({
    data: {
      submittalId: sub2.id,
      revisionNumber: 1,
      sentOn: day(-19),
      dueBack: day(-5),
      returnedOn: day(-7),
      outcome: "REVISE_AND_RESUBMIT",
      responseNotes: "Substitute tile not equal to specified. Resubmit with basis of design.",
    },
  });
  await prisma.submittalCounter.update({
    where: { jobId: riverside.id },
    data: { lastNumber: 2 },
  });

  // -------------------------------------------------------------- punch list
  const punch = [
    ["Corridor 2-14: drywall corner bead damaged, repair and repaint", true, -6],
    ["Room 214: ceiling tile stained near VAV, replace", true, -3],
    ["Stair 2: fire caulk missing at top of wall penetration", false, null],
    ["Room 227: door frame out of plumb, adjust", false, null],
    ["Corridor 2-02: touch-up paint at return air grille", false, null],
  ];
  for (const [description, isDone, doneAt] of punch) {
    await prisma.punchListItem.create({
      data: {
        companyId: company.id,
        jobId: riverside.id,
        description,
        isDone,
        completedAt: doneAt === null ? null : day(doneAt),
        raisedByUserId: user?.id ?? null,
      },
    });
  }

  // ------------------------------------------------- closeout and warranty
  // On the finished job, so the checklist has a job whose closeout is real.
  const closeout = [
    ["Final unconditional lien waiver", true, -18],
    ["As-built drawings delivered", true, -16],
    ["O&M manuals delivered", true, -15],
    ["Warranty letter issued", true, -14],
    ["Final cleaning sign-off", false, null],
    ["Punch list sign-off from GC", false, null],
  ];
  for (const [name, done, at] of closeout) {
    await prisma.closeoutItem.create({
      data: {
        companyId: company.id,
        jobId: cedar.id,
        name,
        isRequired: true,
        completedOn: done ? day(at) : null,
      },
    });
  }
  await prisma.warrantyPeriod.create({
    data: {
      companyId: company.id,
      jobId: cedar.id,
      startsOn: day(-21),
      months: 12,
      note: "One-year workmanship warranty from substantial completion.",
    },
  });

  // ------------------------------------------------------------ toolbox talks
  const talks = [
    [-2, "Silica dust control when cutting board", "Hector Ramirez", "9 attended"],
    [-9, "Ladder safety and three points of contact", "Hector Ramirez", "11 attended"],
    [-16, "Fall protection at leading edge, level 3", "Dana Whitfield", "12 attended"],
  ];
  for (const [at, topic, presenter, attendees] of talks) {
    await prisma.toolboxTalk.create({
      data: {
        companyId: company.id,
        jobId: riverside.id,
        heldOn: day(at),
        topic,
        presenter,
        attendees,
        recordedByUserId: user?.id ?? null,
      },
    });
  }

  // ----------------------------------------------------------- material orders
  const supplier = await prisma.vendor.create({
    data: {
      companyId: company.id,
      name: `Bolt Building Supply ${MARK}`,
      tradeScope: "METAL_FRAMING_DRYWALL",
      contactName: "Marta Feld",
      phone: "(503) 555-0119",
      email: "orders@boltbuilding.example",
    },
  });
  await prisma.materialOrderCounter.upsert({
    where: { jobId: riverside.id },
    create: { jobId: riverside.id, lastNumber: 2 },
    update: { lastNumber: 2 },
  });
  const orders = [
    [1, "Level 2 board — 5/8 Type X, 4x12", -30, -22, -21],
    [2, "ACT grid and tile, level 2 north", -8, -1, null],
  ];
  for (const [number, description, ordered, promised, delivered] of orders) {
    const mo = await prisma.materialOrder.create({
      data: {
        companyId: company.id,
        jobId: riverside.id,
        number,
        vendorId: supplier.id,
        description,
        orderedOn: day(ordered),
        promisedFor: day(promised),
        orderedByUserId: user?.id ?? null,
      },
    });
    if (delivered !== null) {
      await prisma.materialOrderDelivery.create({
        data: {
          orderId: mo.id,
          deliveredOn: day(delivered),
          completesOrder: true,
          notes: "Full quantity received.",
        },
      });
    }
  }

  // ------------------------------------------------------------- drawing sets
  const archSet = await prisma.drawingSet.create({
    data: {
      companyId: company.id,
      jobId: riverside.id,
      name: "Architectural",
      description: "Issued by Vollmer Architects.",
    },
  });
  await prisma.drawingRevision.createMany({
    data: [
      { setId: archSet.id, label: "Rev 2 — Permit set", issuedOn: day(-95), receivedOn: day(-93) },
      { setId: archSet.id, label: "Rev 3 — ASI 14, corridor soffits", issuedOn: day(-36), receivedOn: day(-34) },
      // Issued but never received: the state that page exists to surface.
      { setId: archSet.id, label: "Rev 4 — ASI 18, mechanical room ratings", issuedOn: day(-4), receivedOn: null },
    ],
  });

  // -------------------------------------------------------------- time entries
  if (user) {
    for (let i = 1; i <= 8; i += 1) {
      await prisma.timeEntry.create({
        data: {
          jobId: riverside.id,
          lineItemId: riversideLines[1].id,
          employeeUserId: user.id,
          date: day(-i),
          hours: i % 5 === 0 ? "10" : "8",
          payType: i % 5 === 0 ? "OVERTIME" : "STRAIGHT",
        },
      });
    }
  }

  // ------------------------------------------------------- catalog + pricing
  // Both exist so the estimating story has something to show: a catalog
  // default that is UNDER what anyone will actually sell at, which is the
  // warning /vendors/pricing exists to raise.
  const catalogBoard = await prisma.lineItemCatalogEntry.create({
    data: {
      companyId: company.id,
      description: `5/8" Type X gypsum board, hung and finished ${MARK}`,
      unit: "SF",
      tradeScope: "METAL_FRAMING_DRYWALL",
      defaultUnitPrice: "3.40",
      defaultBudgetedUnitCost: "2.30",
    },
  });
  await prisma.lineItemCatalogEntry.create({
    data: {
      companyId: company.id,
      description: `20ga 3-5/8 metal stud framing, interior partitions ${MARK}`,
      unit: "SF",
      tradeScope: "METAL_FRAMING_DRYWALL",
      defaultUnitPrice: "4.15",
      defaultBudgetedUnitCost: "2.85",
    },
  });

  const rival = await prisma.vendor.create({
    data: {
      companyId: company.id,
      name: `Cascade Interior Supply ${MARK}`,
      tradeScope: "METAL_FRAMING_DRYWALL",
      contactName: "Ray Okonkwo",
      phone: "(503) 555-0164",
    },
  });
  // A rise from one supplier across two quotes, and a second supplier
  // cheaper today — so movement, spread and the catalog gap all render.
  const quotes = [
    [supplier.id, "5/8\" Type X, 4x12", "2.42", -95, "INVOICE"],
    [supplier.id, "5/8\" Type X, 4x12", "2.71", -12, "QUOTE"],
    [rival.id, "5/8 Type X board 4x12", "2.63", -6, "QUOTE"],
  ];
  for (const [vendorId, description, unitPrice, at, source] of quotes) {
    await prisma.vendorPriceQuote.create({
      data: {
        companyId: company.id,
        vendorId,
        catalogEntryId: catalogBoard.id,
        description: `${description} ${MARK}`,
        unit: "SF",
        unitPrice,
        quotedOn: day(at),
        source,
        recordedByUserId: user?.id ?? null,
      },
    });
  }

  // ---------------------------------------------------------------- RFIs
  await prisma.rfiCounter.upsert({
    where: { jobId: riverside.id },
    create: { jobId: riverside.id, lastNumber: 3 },
    update: { lastNumber: 3 },
  });
  const rfis = [
    [1, "Head-of-wall detail at level 2 corridor", "Detail 4/A502 shows a rigid connection at a rated wall. Confirm deflection track type.", -44, -37, "Use slotted deflection track, 2in movement. See ASI 12."],
    [2, "Ceiling height at reception", "RCP shows 9'-6\"; sections show 10'-0\". Which governs?", -21, -14, "10'-0\" governs. RCP to be revised."],
    [3, "Rated assembly at mechanical rooms 2A/2B", "No UL assembly called out. Confirm required rating.", -9, null, null],
  ];
  for (const [number, subject, question, sent, answered, answer] of rfis) {
    await prisma.rfi.create({
      data: {
        companyId: company.id,
        jobId: riverside.id,
        number,
        subject,
        question,
        status: answered === null ? "SENT" : "ANSWERED",
        sentOn: day(sent),
        answeredOn: answered === null ? null : day(answered),
        answer,
        askedByUserId: user?.id ?? null,
      },
    });
  }

  // ------------------------------------------------------------- safety
  const year = new Date().getUTCFullYear();
  await prisma.safetyCaseCounter.upsert({
    where: { companyId_caseYear: { companyId: company.id, caseYear: year } },
    create: { companyId: company.id, caseYear: year, lastCaseNumber: 2 },
    update: { lastCaseNumber: 2 },
  });
  const incidents = [
    [1, -63, "Luis Arredondo", "Laceration to forearm from track edge while loading", "INJURY", "FIRST_AID_ONLY", null],
    [2, -28, "Dane Whitfield", "Slip on wet deck, twisted ankle; two days off", "INJURY", "DAYS_AWAY", 2],
  ];
  for (const [caseNumber, at, employeeName, description, classification, outcome, daysAway] of incidents) {
    await prisma.safetyIncident.create({
      data: {
        companyId: company.id,
        jobId: riverside.id,
        caseNumber,
        caseYear: year,
        occurredAt: day(at),
        employeeName,
        location: "Level 2 north",
        description,
        classification,
        outcome,
        daysAway,
        reportedByUserId: user?.id ?? null,
      },
    });
  }

  // ------------------------------------------------------ bid invitations
  //
  // /bids lists these; /pipeline derives the relationship from them. The
  // spread is chosen to make the derivations show their edges rather than
  // an average:
  //   - Brackett has a decided record, including one WON bid with NO
  //     amount, so valueWon renders as a floor and not a total.
  //   - Halvorsen has one still outstanding PAST its due date.
  //   - Pell has nothing decided at all, so its win rate must read as
  //     "no bids decided yet" and NOT as 0%. A GC printed at 0% is how
  //     somebody drops a good customer.
  const bids = [
    [gc, "Cedar Hollow Apartments", "METAL_FRAMING_DRYWALL", "WON", -104, "412000.00"],
    [gc, "Fifth & Ivy Mixed Use", "ACOUSTICAL_CEILINGS", "WON", -71, null],
    [gc, "Whitfield Elementary Addition", "METAL_FRAMING_DRYWALL", "LOST", -47, "268500.00"],
    [gc, "Northbank Parking Structure", "FIREPROOFING", "DECLINED", -33, null],
    [gc, "Sellwood Clinic Fit-Out", "METAL_FRAMING_DRYWALL", "SUBMITTED", 9, "184250.00"],
    [gc2, "Halvorsen Row Townhomes", "LATH_PLASTER", "WON", -88, "97400.00"],
    // Past its due date and still open — this is what /pipeline counts as
    // overdue, and nothing shows it unless a row is actually late.
    [gc2, "Marquam Heights Phase 2", "EIFS", "SUBMITTED", -6, "233900.00"],
    [gc2, "Alder Street Retail", "ACOUSTICAL_CEILINGS", "INVITED", 17, null],
    [gc3, "Pell Riverfront Tower", "METAL_FRAMING_DRYWALL", "INVITED", 21, null],
    [gc3, "Pell Eastside Warehouse", "FIREPROOFING", "INVITED", -3, null],
  ];
  for (const [contact, projectName, tradeScope, status, due, bidAmount] of bids) {
    await prisma.bidInvitation.create({
      data: {
        companyId: company.id,
        contactId: contact.id,
        // Tagged so undo() can find it again without touching a row a
        // person entered — same rule as every other row this script writes.
        projectName: `${projectName} ${MARK}`,
        tradeScope,
        status,
        dueDate: day(due),
        bidAmount,
      },
    });
  }

  // -------------------------------------------------- contact interactions
  //
  // The follow-up date is the derived bit: overdue and upcoming follow-ups
  // are worked out from followUpOn, so one of these is deliberately in the
  // past and one in the future. followUpAssignedToUserId is a separate
  // field from loggedByUserId on purpose, and both are exercised here.
  const interactions = [
    [gc, "CALL", -12, "Called Dana about the level 3 ceiling grid RFI. She will chase the architect.", 2],
    [gc, "SITE_VISIT", -5, "Walked levels 1-2 with the super. Punch walk pencilled for the 20th.", null],
    [gc2, "EMAIL", -21, "Sent the updated MSA for signature. No reply yet.", -4],
    [gc2, "NOTE", -9, "Their AP has moved to net 30 in practice regardless of what the contract says.", null],
    [gc3, "CALL", -16, "Intro call on the Riverfront Tower package. Bid due in three weeks.", 5],
    [gc3, "EMAIL", -2, "Sent prequal packet and bonding letter.", null],
  ];
  for (const [contact, type, at, summary, followUp] of interactions) {
    await prisma.contactInteraction.create({
      data: {
        companyId: company.id,
        contactId: contact.id,
        type,
        occurredOn: day(at),
        summary: `${summary} ${MARK}`,
        followUpOn: followUp === null ? null : day(followUp),
        followUpAssignedToUserId: followUp === null ? null : (user?.id ?? null),
        loggedByUserId: user?.id ?? null,
      },
    });
  }

  console.log("seed: change orders, submittals, punch list, closeout, talks, orders, drawings, time, catalog, pricing, RFIs, safety, bids and interactions written");
  return { company, user, gc, gc2, gc3, riverside, northgate, lakeshore, riversideLines };
}

async function undo(companyId) {
  // Ordered children-first. Only rows this script tagged.
  const jobs = await prisma.job.findMany({
    where: { companyId, name: { contains: MARK } },
    select: { id: true },
  });
  const jobIds = jobs.map((j) => j.id);

  // Children of a demo CONTACT are scoped by the contact, not by their own
  // tag — the same way children of a demo JOB are scoped by jobIds above.
  // A bid invitation or an interaction someone adds by hand while clicking
  // through a preview hangs off a demo contact and is untagged; scoped by
  // tag it would survive, and then contact.deleteMany would fail on the
  // foreign key and leave the whole demo dataset half-removed.
  const contacts = await prisma.contact.findMany({
    where: { companyId, name: { contains: MARK } },
    select: { id: true },
  });
  const contactIds = contacts.map((c) => c.id);

  const counts = {};
  const failed = [];
  const del = async (label, fn) => {
    try {
      const r = await fn();
      counts[label] = r.count ?? 0;
    } catch (e) {
      const msg = e.message.split("\n")[0];
      // A model that doesn't exist on this branch is not a failed delete —
      // EquipmentAssignment lives on an unmerged branch, and there is
      // nothing of it here to remove.
      if (/reading 'deleteMany'/.test(msg)) {
        counts[label] = "n/a on this branch";
        return;
      }
      // Everything else is loud on purpose. A swallowed failure here left
      // two of every job behind and the next seed built a second set on top.
      counts[label] = `FAILED (${msg.slice(0, 70)})`;
      failed.push(label);
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
    // Children first, in dependency order. Adding rows without extending
    // this is how the second run left two of every job behind: the delete
    // failed on a foreign key, `del` swallowed it as "skipped", and the
    // next seed created a duplicate set. Anything added above must be
    // added here.
    await del("changeOrderProposal", () =>
      prisma.changeOrderProposal.deleteMany({ where: { changeOrder: { jobId: { in: jobIds } } } }),
    );
    await del("changeOrderLineItemEdit", () =>
      prisma.changeOrderLineItemEdit.deleteMany({ where: { changeOrder: { jobId: { in: jobIds } } } }),
    );
    await del("changeOrder", () =>
      prisma.changeOrder.deleteMany({ where: { jobId: { in: jobIds } } }),
    );
    await del("submittalRevision", () =>
      prisma.submittalRevision.deleteMany({ where: { submittal: { jobId: { in: jobIds } } } }),
    );
    await del("submittal", () => prisma.submittal.deleteMany({ where: { jobId: { in: jobIds } } }));
    await del("submittalCounter", () =>
      prisma.submittalCounter.deleteMany({ where: { jobId: { in: jobIds } } }),
    );
    await del("punchListItem", () =>
      prisma.punchListItem.deleteMany({ where: { jobId: { in: jobIds } } }),
    );
    await del("closeoutItem", () =>
      prisma.closeoutItem.deleteMany({ where: { jobId: { in: jobIds } } }),
    );
    await del("warrantyServiceRequest", () =>
      prisma.warrantyServiceRequest.deleteMany({ where: { jobId: { in: jobIds } } }),
    );
    await del("warrantyPeriod", () =>
      prisma.warrantyPeriod.deleteMany({ where: { jobId: { in: jobIds } } }),
    );
    await del("toolboxTalk", () =>
      prisma.toolboxTalk.deleteMany({ where: { jobId: { in: jobIds } } }),
    );
    await del("materialOrderDelivery", () =>
      prisma.materialOrderDelivery.deleteMany({ where: { order: { jobId: { in: jobIds } } } }),
    );
    await del("materialOrder", () =>
      prisma.materialOrder.deleteMany({ where: { jobId: { in: jobIds } } }),
    );
    await del("materialOrderCounter", () =>
      prisma.materialOrderCounter.deleteMany({ where: { jobId: { in: jobIds } } }),
    );
    await del("drawingRevision", () =>
      prisma.drawingRevision.deleteMany({ where: { set: { jobId: { in: jobIds } } } }),
    );
    await del("drawingSet", () => prisma.drawingSet.deleteMany({ where: { jobId: { in: jobIds } } }));
    await del("timeEntry", () => prisma.timeEntry.deleteMany({ where: { jobId: { in: jobIds } } }));
    await del("safetyIncident", () =>
      prisma.safetyIncident.deleteMany({ where: { jobId: { in: jobIds } } }),
    );
    await del("rfi", () => prisma.rfi.deleteMany({ where: { jobId: { in: jobIds } } }));
    await del("rfiCounter", () => prisma.rfiCounter.deleteMany({ where: { jobId: { in: jobIds } } }));
    await del("payment", () =>
      prisma.payment.deleteMany({ where: { invoice: { jobId: { in: jobIds } } } }),
    );
    // Before the invoices themselves, or the FK blocks the delete.
    await del("invoiceLineItem", () =>
      prisma.invoiceLineItem.deleteMany({ where: { invoice: { jobId: { in: jobIds } } } }),
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
  await del("safetyCaseCounter", () =>
    prisma.safetyCaseCounter.deleteMany({ where: { companyId } }),
  );
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
  // Both reference Contact, so both go before it.
  await del("bidInvitation", () =>
    prisma.bidInvitation.deleteMany({ where: { contactId: { in: contactIds } } }),
  );
  await del("contactInteraction", () =>
    prisma.contactInteraction.deleteMany({ where: { contactId: { in: contactIds } } }),
  );
  await del("contact", () => prisma.contact.deleteMany({ where: { id: { in: contactIds } } }));

  console.log("seed: removed —", JSON.stringify(counts));
  if (failed.length) {
    console.error(
      `\nseed: ${failed.length} delete(s) FAILED: ${failed.join(", ")}.\n` +
        "seed: rows are still there. Re-seeding now would DUPLICATE them.\n" +
        "seed: extend undo() to cover whatever was added, then run --undo again.",
    );
    process.exitCode = 1;
  }
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (err) => {
    console.error("\nseed: FAILED —", err.message);
    await prisma.$disconnect();
    process.exit(1);
  });
