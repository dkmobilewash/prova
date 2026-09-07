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
 * day, the vendor price movement, the equipment still sitting on a closed
 * job, the backcharge nobody answered in time, WIP over/under billing,
 * retainage held — every one of those is a good feature that shows nothing
 * at all against a job called "test" worth $0.00.
 *
 * This docstring promised "equipment utilisation" for a while when nothing
 * computed one; then something did, and the seed still wrote only the
 * deprecated `Equipment.assignedJobId`, so the promise stayed unkept for a
 * second, different reason and the demo showed eight machines in an empty
 * yard. /equipment and /deployment both derive location and utilisation
 * from `EquipmentAssignment`, and the seed writes those rows now.
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
  //
  // Case numbers come OUT of the counter, incremented, instead of being
  // written as a hardcoded 1 and 2. Two reasons, both with teeth on a
  // company that is not empty. `SafetyIncident` is unique on
  // (companyId, caseYear, caseNumber), so a literal 1 collides with any
  // real case already filed this year and the whole seed dies. And
  // `update: { lastCaseNumber: 2 }` SET the counter to 2 — on a company
  // that had climbed past 2 that is a reset downwards, and every number in
  // between gets reissued to a future case. The counter only ever
  // increments. Mirrors `issueCaseNumber` in apps/web/lib/actions/safety.ts,
  // which is the reference implementation of this rule.
  const year = new Date().getUTCFullYear();
  const incidents = [
    [-63, "Luis Arredondo", "Laceration to forearm from track edge while loading", "INJURY", "FIRST_AID_ONLY", null],
    [-28, "Dane Whitfield", "Slip on wet deck, twisted ankle; two days off", "INJURY", "DAYS_AWAY", 2],
  ];
  const caseCounter = await prisma.safetyCaseCounter.upsert({
    where: { companyId_caseYear: { companyId: company.id, caseYear: year } },
    create: { companyId: company.id, caseYear: year, lastCaseNumber: incidents.length },
    update: { lastCaseNumber: { increment: incidents.length } },
    select: { lastCaseNumber: true },
  });
  // The block just reserved is [last - n + 1 .. last]. Reserving the whole
  // run in one increment rather than one at a time keeps the numbers
  // contiguous even if somebody files a real case while this is running.
  const firstCaseNumber = caseCounter.lastCaseNumber - incidents.length + 1;
  for (const [i, [at, employeeName, description, classification, outcome, daysAway]] of incidents.entries()) {
    await prisma.safetyIncident.create({
      data: {
        companyId: company.id,
        jobId: riverside.id,
        caseNumber: firstCaseNumber + i,
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

  // ---------------------------------------------------------------- equipment
  //
  // Where a piece is NOW is DERIVED — the newest stay in EquipmentAssignment
  // that nobody closed. `Equipment.assignedJobId` is deprecated and read by
  // nothing. This seed wrote only that column and created zero assignments,
  // so a fresh demo showed "8 items, 8 in the yard", every utilisation
  // blank, and /deployment saying "Equipment: none on site" for every job.
  // The row that exists specifically to demo the feature — the texture rig
  // still on Cedar after closeout — was the one that vanished. Issue #147.
  //
  // Two things this data has to get right, both easy to miss:
  //
  //   - `createdAt` is BACKDATED, deliberately. Utilisation clamps its
  //     window to the day the record was created ("since we started
  //     tracking it"), so a row created a moment ago has a ZERO-day window
  //     and reads "too new to say how used it is" no matter how many stays
  //     hang off it. A seed that leaves createdAt at now() cannot show a
  //     percentage at all — not a low one, none.
  //   - No two stays for one piece may OVERLAP. Overlapping records are the
  //     contradiction /deployment reports in a red banner, and seeding one
  //     would ship a demo that opens on an error. Every range below is
  //     disjoint per piece. (Nothing here demonstrates that banner; if it
  //     should be demoed, that is a decision to make on purpose, not a
  //     side effect of seed data.)
  //
  // `type` and `assetTag` stay nullable on purpose ("plenty of small
  // equipment has neither") rather than inventing an asset tag for a
  // wheelbarrow. The spread puts a row on every branch of the two screens:
  // out on a running job, due out on one that hasn't started, still out on
  // a FINISHED one, back in the yard with a history behind it, never used,
  // and too new to judge.
  //
  // `known` is the createdAt offset; each stay is [job, sentOut, returned].
  const equipment = [
    {
      name: "Genie S-45 boom lift",
      type: "Lift",
      assetTag: "EQ-1042",
      notes: "Certified through next spring.",
      known: -200,
      stays: [
        [cedar, -80, -60, "Punch list access, classroom wing."],
        [riverside, -35, null, null],
      ],
    },
    {
      name: "Genie GS-1930 scissor lift",
      type: "Lift",
      assetTag: "EQ-1043",
      notes: null,
      known: -200,
      stays: [[riverside, -21, null, null]],
    },
    {
      name: "Baker scaffold set (12 frames)",
      type: "Scaffolding",
      assetTag: null,
      notes: null,
      known: -200,
      stays: [[riverside, -46, null, null]],
    },
    {
      name: "Stud crimper, Malco",
      type: null,
      assetTag: null,
      notes: null,
      known: -200,
      // The second stay is dated FORWARD on purpose. Northgate is
      // CONTRACTED and does not start for three weeks; a stay in the
      // future is a plan, not a deployment, and `stayLength` says "due
      // out" rather than reporting a machine as on site while it is still
      // sitting in the yard. That branch has no other row exercising it.
      stays: [
        [riverside, -70, -50, null],
        [northgate, 21, null, "Goes out with the first framing load."],
      ],
    },
    {
      name: "Graco Mark V texture rig",
      type: "Sprayer",
      assetTag: "EQ-2011",
      notes: "Still on Cedar after closeout — needs collecting.",
      known: -240,
      // Open, on a job that FINISHED. The whole "out on a job that isn't
      // running" section on /deployment exists for this row, and the
      // section cannot appear unless the seed puts it there.
      stays: [[cedar, -120, null, "Left after the final walkthrough. No return logged."]],
    },
    {
      name: "Mud mixer, 1/2in drill",
      type: "Mixer",
      assetTag: "EQ-2044",
      notes: null,
      known: -200,
      stays: [[riverside, -60, -40, null]],
    },
    {
      name: "Laser level, Hilti PM 30-MG",
      type: "Layout",
      assetTag: "EQ-3001",
      notes: "In the yard. Calibration due.",
      known: -200,
      stays: [],
    },
    {
      name: "Wheelbarrow (x3)",
      type: null,
      assetTag: null,
      notes: null,
      // Created today, so its window is zero days long and the page says
      // "too new to say how used it is" — the honest answer, and not the
      // same thing as a confident 0%.
      known: 0,
      stays: [],
    },
  ];
  let equipmentStays = 0;
  for (const item of equipment) {
    const row = await prisma.equipment.create({
      data: {
        companyId: company.id,
        name: `${item.name} ${MARK}`,
        type: item.type,
        assetTag: item.assetTag,
        notes: item.notes,
        // Explicit, overriding @default(now()). See the note above: the
        // utilisation denominator is measured from this date.
        createdAt: day(item.known),
      },
    });
    for (const [job, sentOut, returned, note] of item.stays) {
      await prisma.equipmentAssignment.create({
        data: {
          companyId: company.id,
          equipmentId: row.id,
          jobId: job.id,
          sentOutOn: day(sentOut),
          returnedOn: returned === null ? null : day(returned),
          notes: note,
          recordedByUserId: user?.id ?? null,
        },
      });
      equipmentStays += 1;
    }
  }
  console.log(
    `seed: equipment       ${equipment.length} items, ${equipmentStays} assignment(s), ` +
      `${equipment.filter((e) => !e.stays.some((s) => s[2] === null)).length} in the yard`,
  );

  // -------------------------------------------------- prevailing wage rules
  //
  // Effective-dated, and the pair on the same jurisdiction is the point:
  // reviewing last year's timesheet has to use the rule in force THEN. The
  // database enforces non-overlap per company+jurisdiction with a gist
  // EXCLUDE constraint, so these two ranges are half-open and adjacent
  // rather than merely "different" — [-730, -180) then [-180, ∞).
  //
  // The county row records nothing but its own existence. Null thresholds
  // mean "nobody has looked this up", which the review reports as unchecked
  // rather than assuming a figure — a state that cannot be demonstrated by
  // a row with sensible numbers in it.
  const oregonPrior = await prisma.prevailingWageRuleSet.create({
    data: {
      companyId: company.id,
      name: `Oregon BOLI — prior determination ${MARK}`,
      jurisdiction: "Oregon",
      authority: "STATE",
      dailyOvertimeAfterHours: "8",
      weeklyOvertimeAfterHours: "40",
      filingFrequency: "WEEKLY",
      filingDueDays: 5,
      formName: "WH-38",
      effectiveFrom: day(-730),
      effectiveTo: day(-180),
      note: "Superseded. Kept so weeks worked under it still review correctly.",
    },
  });
  const oregonCurrent = await prisma.prevailingWageRuleSet.create({
    data: {
      companyId: company.id,
      name: `Oregon BOLI — current ${MARK}`,
      jurisdiction: "Oregon",
      authority: "STATE",
      dailyOvertimeAfterHours: "8",
      dailyDoubleTimeAfterHours: "12",
      weeklyOvertimeAfterHours: "40",
      seventhDayOvertimeAfterHours: "0",
      filingFrequency: "WEEKLY",
      filingDueDays: 5,
      formName: "WH-38",
      portalUrl: "https://www.oregon.gov/boli/example",
      sourceUrl: "https://www.oregon.gov/boli/example/rates",
      effectiveFrom: day(-180),
      effectiveTo: null,
    },
  });
  await prisma.prevailingWageRuleSet.create({
    data: {
      companyId: company.id,
      name: `Clark County, WA — not yet researched ${MARK}`,
      jurisdiction: "Clark County, WA",
      authority: "COUNTY",
      // Every threshold null on purpose. See above.
      filingFrequency: "MONTHLY",
      effectiveFrom: day(-90),
      note: "Recorded so the jurisdiction is not invisible. Thresholds still to be read off the determination.",
    },
  });
  // Attaches the current Oregon rules to the job that has time entries, so
  // /prevailing-wage has a week to review rather than an empty selector.
  await prisma.prevailingWageDetermination.create({
    data: {
      jobId: riverside.id,
      jurisdiction: "Oregon",
      ruleSetId: oregonCurrent.id,
      fileName: "boli-determination-riverside.pdf",
      sourceUrl: "https://www.oregon.gov/boli/example/rates",
      note: `Public works — BOLI rates apply. ${MARK}`,
      uploadedByUserId: user?.id ?? null,
    },
  });

  // -------------------------------------------------------------- backcharges
  //
  // Numbers come from BackchargeCounter, never from a count of the rows
  // that happen to survive — same rule as RFIs and submittals.
  //
  // The spread is chosen around what /backcharges DERIVES. `overdueCount`
  // is RECEIVED + a respondByDate in the past, so one row is exactly that
  // and one is RECEIVED with the deadline still ahead; without both, the
  // red counter is either always zero or always alarming. `concededAmount`
  // returns the claim for ACCEPTED, zero for WITHDRAWN, and the negotiated
  // figure only for SETTLED — so all three are here, and the settled one
  // came down from the claim, which is the "we argued them down" the log
  // exists to prove. One row has no GC reference and no deadline at all:
  // that reads as "not recorded", and it is the commonest real shape.
  const backcharges = [
    // [job, number, category, description, claimed, issued, received, respondBy,
    //  status, disputedOn, disputeReason, resolvedOn, resolvedAmount, note, gcRef]
    [riverside, 1, "CLEANUP", "Common-area cleanup, weeks of the 6th and 13th — GC crew.", "2450.00", -38, -31, -17, "RECEIVED", null, null, null, null, null, "BC-0417"],
    [riverside, 2, "DAMAGE_TO_OTHER_TRADES", "Sprinkler drop damaged at level 2 during ceiling grid.", "6120.00", -12, -10, 9, "RECEIVED", null, null, null, null, null, "BC-0431"],
    [riverside, 3, "COMPLETION_BY_OTHERS", "Soffit framing at grid F completed by GC carpenters.", "9800.00", -26, -24, -9, "DISPUTED", -13, "Scope was deleted by ASI 09. Backup requested and not provided.", null, null, null, "BC-0426"],
    [riverside, 4, "SUPERVISION", "Additional GC supervision, no backup provided.", "1875.00", -20, null, null, "WITHDRAWN", null, null, -6, null, "Withdrawn after we asked for the daily reports behind it.", null],
    [cedar, 1, "SCHEDULE_DELAY", "Two-day delay to the finish trades at the west stair.", "14500.00", -64, -60, -46, "SETTLED", -52, "Delay was the elevator subcontractor's; our crew was released on time.", -34, "4000.00", "Settled at $4,000 against a $14,500 claim after the daily reports were produced.", "BC-0388"],
    [cedar, 2, "MATERIAL_OR_EQUIPMENT_SUPPLIED", "Hoisting and material handling, three days.", "3200.00", -58, -55, -41, "ACCEPTED", null, null, -40, null, "Legitimate — our hoist was down.", "BC-0391"],
  ];
  const backchargeHighest = {};
  for (const [job, number, category, description, claimed, issued, received, respondBy, status, disputedOn, disputeReason, resolvedOn, resolvedAmount, resolutionNote, gcReference] of backcharges) {
    await prisma.backcharge.create({
      data: {
        companyId: company.id,
        jobId: job.id,
        number,
        gcReference,
        category,
        description: `${description} ${MARK}`,
        claimedAmount: claimed,
        issuedOn: day(issued),
        receivedOn: received === null ? null : day(received),
        respondByDate: respondBy === null ? null : day(respondBy),
        status,
        disputedOn: disputedOn === null ? null : day(disputedOn),
        disputeReason,
        resolvedOn: resolvedOn === null ? null : day(resolvedOn),
        resolvedAmount,
        resolutionNote,
        loggedByUserId: user?.id ?? null,
      },
    });
    backchargeHighest[job.id] = Math.max(backchargeHighest[job.id] ?? 0, number);
  }
  for (const [jobId, lastNumber] of Object.entries(backchargeHighest)) {
    await prisma.backchargeCounter.upsert({
      where: { jobId },
      create: { jobId, lastNumber },
      update: { lastNumber },
    });
  }

  // ------------------------------------------------- closeout submissions
  //
  // Two attempts on the finished job, which is the history the model was
  // added for: sent, bounced, sent again. Collapsing that into one row
  // would erase the fact that we made the first date.
  //
  // The second attempt has respondedOn NULL deliberately — that is the
  // state `daysWithGc` counts, and it is the difference between "nobody
  // sent the package" and "the GC is sitting on it", which is the entire
  // question the panel exists to answer. Attempt numbers come from the
  // counter.
  const submissions = [
    [1, -29, "Emailed to PM and uploaded to Procore", "REJECTED", -22, "Returned — final unconditional lien waiver missing and as-builts were the wrong revision.", null],
    [2, -14, "Emailed to PM and uploaded to Procore", "SUBMITTED", null, null, "Re-sent with the corrected as-builts and the executed waiver."],
  ];
  for (const [attempt, submittedOn, method, status, respondedOn, gcResponse, note] of submissions) {
    await prisma.closeoutSubmission.create({
      data: {
        companyId: company.id,
        jobId: cedar.id,
        attempt,
        submittedOn: day(submittedOn),
        method,
        status,
        respondedOn: respondedOn === null ? null : day(respondedOn),
        gcResponse,
        note: note === null ? MARK : `${note} ${MARK}`,
        submittedByUserId: user?.id ?? null,
      },
    });
  }
  await prisma.closeoutSubmissionCounter.upsert({
    where: { jobId: cedar.id },
    create: { jobId: cedar.id, lastAttempt: submissions.length },
    update: { lastAttempt: submissions.length },
  });

  // ------------------------------------------------------ outbound messages
  //
  // /messages derives three figures and each needs a different shape to
  // show at all. `problems` counts BOUNCED/FAILED/COMPLAINED. `unconfirmed`
  // counts messages whose last event is QUEUED or SENT (or which have no
  // events) AND that are at least a day old — which is why createdAt is set
  // explicitly here rather than left to default to now(): a message created
  // this second can never be stale, so a seed that lets the default stand
  // demos that counter permanently at zero.
  //
  // `deliveryRate` counts only messages the provider has decided on, so the
  // in-flight ones below deliberately do NOT drag it down.
  const fromAddress = "office@example-drywall.com";
  // Events need DISTINCT, ORDERED timestamps within the day. messageState
  // walks them newest-first and returns the first decisive one, so three
  // events sharing one occurredAt make the derived state depend on the
  // order Postgres happens to return — which is not stable. Seeded at
  // UTC midnight with all three equal, a delivered message read as
  // "Handed over, not confirmed" on one run and "Delivered" on the next.
  // The schema says as much in its own words: "the sequence itself carries
  // meaning".
  const eventAt = (daysAgo, minutes) => new Date(day(daysAgo).getTime() + minutes * 60_000);
  const messages = [
    // [job, to, toName, subject, body, sentDaysAgo, relatedType, events]
    // events: [type, daysAgo, minutesPastMidnight, detail]
    [riverside, "dana@brackettconstruction.example", "Dana Whitfield", "RFI 3 — rated assembly at mechanical rooms 2A/2B", "Dana, following up on RFI 3. We need the UL assembly before we can close those walls. Framing is holding.", -9, "RFI", [["QUEUED", -9, 494, null], ["SENT", -9, 495, null], ["DELIVERED", -9, 498, null]]],
    [riverside, "dana@brackettconstruction.example", "Dana Whitfield", "Submittal 2 — ceiling grid, revision B", "Revision B attached, incorporating the seismic bracing comments.", -20, "SUBMITTAL", [["QUEUED", -20, 601, null], ["SENT", -20, 602, null], ["DELIVERED", -20, 604, null]]],
    [cedar, "ap@brackettconstruction.example", null, "Closeout package — Cedar, second submission", "Full package attached with the corrected as-builts and the executed unconditional waiver.", -14, "CLOSEOUT", [["QUEUED", -14, 933, null], ["SENT", -14, 934, null], ["DELIVERED", -14, 941, null]]],
    // Bounced: a real, fixable problem, and the detail is what makes it fixable.
    [northgate, "j.reyes@halvorsenbuilders.example", "Joel Reyes", "Northgate Phase 2 — schedule of values for review", "Attached the SOV for the 48 units, broken out by building.", -6, null, [["QUEUED", -6, 545, null], ["SENT", -6, 546, null], ["BOUNCED", -6, 549, "550 5.1.1 recipient address rejected: user unknown"]]],
    // Handed to the provider six days ago and never confirmed. The state
    // /messages calls "unconfirmed", which needs a message at least a day
    // old — hence the explicit createdAt below.
    [riverside, "super@brackettconstruction.example", "Marco Silva", "Level 3 ceiling grid — start date", "Confirming we start the level 3 grid Monday, assuming the mechanical rough-in is signed off.", -6, null, [["QUEUED", -6, 1012, null], ["SENT", -6, 1013, null]]],
    // Never reached the provider at all: no events, no providerMessageId.
    // Reads as "Never sent" rather than as an empty log.
    [cedar, "ap@brackettconstruction.example", null, "Retainage release — Cedar", "The closeout package went in on the 14th. Confirming the retainage release schedule.", -3, null, []],
  ];
  for (const [job, toAddress, toName, subject, body, sentAt, relatedType, events] of messages) {
    const wentOut = events.length > 0;
    const message = await prisma.outboundMessage.create({
      data: {
        companyId: company.id,
        jobId: job.id,
        channel: "EMAIL",
        toAddress,
        toName,
        subject,
        body: `${body}\n\n${MARK}`,
        fromAddress,
        // Explicit, not defaulted — see the note above about `stale`.
        createdAt: day(sentAt),
        // Null means it never reached the provider, which is a different
        // failure from bouncing and reads differently on the page.
        providerMessageId: wentOut ? `demo-${MARK}-${toAddress}-${sentAt}` : null,
        relatedType,
        relatedId: relatedType === null ? null : job.id,
        sentByUserId: user?.id ?? null,
      },
    });
    for (const [type, at, minutes, detail] of events) {
      await prisma.outboundMessageEvent.create({
        data: { messageId: message.id, type, occurredAt: eventAt(at, minutes), detail },
      });
    }
  }

  console.log("seed: change orders, submittals, punch list, closeout, talks, orders, drawings, time, catalog, pricing, RFIs, safety, bids, interactions, equipment, prevailing wage, backcharges, closeout submissions and messages written");
  return { company, user, gc, gc2, gc3, riverside, northgate, lakeshore, riversideLines, oregonPrior, oregonCurrent };
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
      // Loud, with no exceptions. This used to swallow "reading
      // 'deleteMany'" as "n/a on this branch", for EquipmentAssignment
      // while it lived on an unmerged branch. That branch merged. What is
      // left for the swallow to hide is a stale Prisma client or a renamed
      // model, reported as a benign skip — and a swallowed failure here
      // left two of every job behind once already, with the next seed
      // building a second set on top of them.
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
    // Everything from here to the job delete is ON DELETE RESTRICT against
    // Job — checked in the migrations, not assumed. Any one of them left
    // out does not fail quietly: `job.deleteMany` throws, `del` records the
    // failure, and the run exits non-zero saying the rows are still there.
    // That is the intended behaviour and it is why these sit ABOVE the job
    // delete rather than in the company-scoped section below.
    await del("backcharge", () =>
      prisma.backcharge.deleteMany({ where: { jobId: { in: jobIds } } }),
    );
    await del("backchargeCounter", () =>
      prisma.backchargeCounter.deleteMany({ where: { jobId: { in: jobIds } } }),
    );
    await del("closeoutSubmission", () =>
      prisma.closeoutSubmission.deleteMany({ where: { jobId: { in: jobIds } } }),
    );
    await del("closeoutSubmissionCounter", () =>
      prisma.closeoutSubmissionCounter.deleteMany({ where: { jobId: { in: jobIds } } }),
    );
    await del("prevailingWageDetermination", () =>
      prisma.prevailingWageDetermination.deleteMany({ where: { jobId: { in: jobIds } } }),
    );
    // OutboundMessage.jobId is ON DELETE SET NULL, so a message left here
    // would not block the job delete — it would be silently ORPHANED, with
    // its jobId nulled and no way left to find it by job. Scoped by the
    // tag in the body instead, which survives that, and deleted here
    // anyway so the count is reported against the run that made it.
    // Events cascade from the message; deleted first so they are counted
    // rather than disappearing into the cascade.
    await del("outboundMessageEvent", () =>
      prisma.outboundMessageEvent.deleteMany({
        where: { message: { companyId, body: { contains: MARK } } },
      }),
    );
    await del("outboundMessage", () =>
      prisma.outboundMessage.deleteMany({ where: { companyId, body: { contains: MARK } } }),
    );
    await del("jobAssignment", () =>
      prisma.jobAssignment.deleteMany({ where: { jobId: { in: jobIds } } }),
    );
    // Six more RESTRICT children of Job that this path never deleted. The
    // seed writes none of them today, which is exactly why they were
    // missed — but the same argument already written above about bid
    // invitations applies: a contract document or a dispatch slip somebody
    // adds by hand while clicking through a demo job is untagged, hangs off
    // a demo job, and blocks `job.deleteMany` with the whole dataset half
    // removed. Found by apps/web/lib/scratch-cleanup-order.test.ts, which
    // derives this set from the migrations rather than from memory.
    await del("changeOrderCounter", () =>
      prisma.changeOrderCounter.deleteMany({ where: { jobId: { in: jobIds } } }),
    );
    await del("contractDocument", () =>
      prisma.contractDocument.deleteMany({ where: { jobId: { in: jobIds } } }),
    );
    await del("signatureRequest", () =>
      prisma.signatureRequest.deleteMany({ where: { jobId: { in: jobIds } } }),
    );
    await del("retainageRelease", () =>
      prisma.retainageRelease.deleteMany({ where: { jobId: { in: jobIds } } }),
    );
    await del("estimateVersion", () =>
      prisma.estimateVersion.deleteMany({ where: { jobId: { in: jobIds } } }),
    );
    await del("dispatchSlip", () =>
      prisma.dispatchSlip.deleteMany({ where: { jobId: { in: jobIds } } }),
    );
    await del("jobLineItem", () => prisma.jobLineItem.deleteMany({ where: { jobId: { in: jobIds } } }));
    await del("job", () => prisma.job.deleteMany({ where: { id: { in: jobIds } } }));
  }
  // SafetyCaseCounter is deliberately NOT deleted, and this line is the
  // whole of that decision. It is a high-water mark, not demo data.
  // Deleting it reset it to zero, so the next REAL safety case filed on
  // this company reissued a number a retired case already carried — two
  // cases sharing a number on an OSHA 300 log is an audit finding, and
  // there is nothing left afterwards to explain it with. This is worse
  // than the `max(n)+1` the repo rule already forbids: that reissues one
  // number, this reissues all of them. Leaving the counter high costs a
  // gap in the numbering, which is precisely the outcome a counter that
  // only ever increments exists to produce. Issue #148.
  counts.safetyCaseCounter = "kept — high-water mark, never reset";
  await del("vendorPriceQuote", () =>
    prisma.vendorPriceQuote.deleteMany({ where: { companyId, description: { contains: MARK } } }),
  );
  await del("vendor", () => prisma.vendor.deleteMany({ where: { companyId, name: { contains: MARK } } }));
  // Safe here for two separate reasons, and both are needed. The seed's own
  // EquipmentAssignment rows went above, scoped by jobId, before the jobs
  // did. A HAND-ADDED assignment of a demo item to a NON-demo job survives
  // that and is removed by cascade from this line (EquipmentAssignment ->
  // Equipment is ON DELETE CASCADE), so it cannot block. And the legacy
  // `Equipment.assignedJobId` is ON DELETE SET NULL, so a hand-set value
  // pointing at a demo job was nulled rather than blocking the job delete.
  await del("equipment", () =>
    prisma.equipment.deleteMany({ where: { companyId, name: { contains: MARK } } }),
  );
  // After prevailingWageDetermination above, which points at these.
  await del("prevailingWageRuleSet", () =>
    prisma.prevailingWageRuleSet.deleteMany({ where: { companyId, name: { contains: MARK } } }),
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
  // The third RESTRICT child of Contact, and the one nobody thought of: the
  // named people at the GC. Its foreign key blocks contact.deleteMany
  // exactly the way bidInvitation's would. ContactInteraction.contactPersonId
  // is SET NULL and already gone above, so nothing blocks this in turn.
  await del("contactPerson", () =>
    prisma.contactPerson.deleteMany({ where: { contactId: { in: contactIds } } }),
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
