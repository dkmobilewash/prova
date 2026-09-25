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
 * THE SAME GAP WAS TRUE OF EVERY UNION-COMPLIANCE SCREEN UNTIL 2026-09-25,
 * and it was the widest one left. This script wrote no union local, no craft
 * classification, no fringe rate schedule, no crew member and no payroll
 * register row — so the apprentice ratio, the monthly fringe remittance, the
 * certified-payroll review, the WH-347 itself and the wage-determination
 * standing line ALL rendered empty states on a dataset whose whole purpose
 * is that nothing renders empty. Those are the features that are hardest to
 * argue for in the abstract and most convincing with real hours behind them,
 * which is the worst possible set to demo blank.
 *
 * One condition in there is deliberately INCOMPLETE rather than tidy: a
 * craft with no tier recorded and no rate schedule, carrying real hours. It
 * is not an oversight and it must not be "fixed". It is the only way to
 * reach the two answers this product gives that its competitors do not —
 * a day's apprentice ratio that reads "no honest verdict exists" instead of
 * quietly certifying itself compliant, and a remittance total that NAMES the
 * hours it refused to price instead of valuing them at zero. See the
 * `ceilingUnclassified` craft below.
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
 *
 * IT REFUSES TO SEED A COMPANY THAT ALREADY HAS DEMO DATA. Run twice, it
 * used to duplicate the equipment and then die half-finished on the
 * prevailing-wage exclusion constraint, leaving a database that looked
 * like an app bug (issue #180). The sequence that works is undo → seed;
 * the refusal message says exactly that. `--force` seeds a second copy on
 * top anyway, for the rare case where a duplicate set is what you want.
 */

loadEnvFiles();

const MARK = "[demo]";
const UNDO = process.argv.includes("--undo");
const FORCE = process.argv.includes("--force");

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

/**
 * A sequence counter only ever goes UP — including when this seed sets one.
 *
 * `max(number)` over the surviving rows is the right value for a job this run
 * just created, and can be the WRONG one for a job that already had a
 * counter: change-order drafts are deletable (`deleteChangeOrderDraft`), so a
 * job's highest surviving number can sit below the highest it ever issued,
 * and writing that back down reissues a number a GC has already been quoted.
 * Only reachable under `--force`, which seeds on top of an existing set —
 * which is to say, on the one run nobody is watching closely.
 */
const raise = (existing, highest) => Math.max(existing ?? 0, highest);

/**
 * The prevailing-wage determination that was in force on a given day.
 *
 * DERIVED, not written as a literal, and the reason is that every other
 * date in this file moves with the run. DIR issues general determinations
 * twice a year — 22 February and 22 August — and each takes effect TEN DAYS
 * later; lib/determination-standing.ts judges a determination by whether the
 * job's bid-advertisement date falls inside that window. Hardcode an issue
 * date beside a bid date computed from TODAY and the pairing is correct for
 * about five months and then silently reads "Not the determination in force
 * on your bid-advertisement date" — a red warning on a demo screen, about
 * nothing.
 *
 * So this answers the question the standing line asks: the latest scheduled
 * issue whose effective date had already arrived. Returns a UTC-midnight
 * Date, like every other date this file writes.
 */
const dirIssueInForceOn = (date) => {
  const EFFECTIVE_LAG_DAYS = 10;
  const year = date.getUTCFullYear();
  let answer = null;
  for (const y of [year - 1, year]) {
    for (const [month, dayOfMonth] of [
      [2, 22],
      [8, 22],
    ]) {
      const issued = new Date(Date.UTC(y, month - 1, dayOfMonth));
      const effective = new Date(issued.getTime() + EFFECTIVE_LAG_DAYS * 86_400_000);
      if (effective <= date) answer = issued;
    }
  }
  // Unreachable: the previous February's issue is always in force by any
  // date in `year`. Thrown rather than returned as something plausible.
  if (!answer) throw new Error(`no DIR issue was in force on ${date.toISOString()}`);
  return answer;
};

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

  // ------------------------------------------------- refuse a second seed
  //
  // Run twice against the same company, this script used to duplicate the
  // equipment and then die half-finished on the prevailing-wage EXCLUDE
  // constraint — those date ranges are computed relative to TODAY, so a
  // second run's range always overlaps the first run's. Everything before
  // the failure point committed, everything after did not, and /equipment
  // reading "16 items" afterwards looked like an app bug. Issue #180.
  //
  // So: count the tagged rows this script leaves behind, per family rather
  // than in total, because a FAILED run or a failed --undo leaves a partial
  // set — a run that died at prevailing wage has jobs and equipment but no
  // backcharges, and a --undo that failed on one delete keeps going and can
  // remove the contacts while the equipment stays. Any non-zero family
  // means the last word here was not a clean removal.
  const existing = {
    contact: await prisma.contact.count({ where: { companyId: company.id, name: { contains: MARK } } }),
    job: await prisma.job.count({ where: { companyId: company.id, name: { contains: MARK } } }),
    vendor: await prisma.vendor.count({ where: { companyId: company.id, name: { contains: MARK } } }),
    equipment: await prisma.equipment.count({ where: { companyId: company.id, name: { contains: MARK } } }),
    prevailingWageRuleSet: await prisma.prevailingWageRuleSet.count({ where: { companyId: company.id, name: { contains: MARK } } }),
    // Per FAMILY, like every other line here, and these two are their own
    // families rather than children of a job: a run that died after the
    // crafts and before the hours leaves a local with no time entries, and
    // scoping the check to jobs would report that as a clean removal.
    unionLocal: await prisma.unionLocal.count({ where: { companyId: company.id, jurisdictionName: { contains: MARK } } }),
    crewMember: await prisma.crewMember.count({ where: { companyId: company.id, note: { contains: MARK } } }),
    lineItemCatalogEntry: await prisma.lineItemCatalogEntry.count({ where: { companyId: company.id, description: { contains: MARK } } }),
    vendorPriceQuote: await prisma.vendorPriceQuote.count({ where: { companyId: company.id, description: { contains: MARK } } }),
    bidInvitation: await prisma.bidInvitation.count({ where: { companyId: company.id, projectName: { contains: MARK } } }),
    outboundMessage: await prisma.outboundMessage.count({ where: { companyId: company.id, body: { contains: MARK } } }),
  };
  const found = Object.entries(existing).filter(([, n]) => n > 0);
  if (found.length && !FORCE) {
    console.error(
      `\nseed: REFUSING — this company already has demo data ` +
        `(${found.map(([m, n]) => `${m}: ${n}`).join(", ")}).\n` +
        "seed: seeding on top would duplicate all of it. Remove the old set first:\n" +
        `seed:   SEED_EXPECT_HOST=${expect} node scripts/seed-demo.mjs --undo\n` +
        "seed: then run the seed again. Nothing has been written.\n" +
        "seed: (--force seeds a second copy on top anyway, if that is really what you want.)",
    );
    process.exit(1);
  }
  if (found.length && FORCE) {
    console.log(
      `seed: --force         seeding ON TOP of existing demo data ` +
        `(${found.map(([m, n]) => `${m}: ${n}`).join(", ")})`,
    );
  }

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
      // The four ENTERED public-works facts the Compliance tab asks for.
      // `bidAdvertisedOn` is the load-bearing one and it is not decoration:
      // lib/determination-standing.ts picks the determination in force from
      // THIS date, so without it every determination on this job reads
      // "Unchecked — the job's bid-advertisement date hasn't been entered"
      // and the whole standing line demonstrates nothing. The determination
      // below derives its own issue date from this one; see `dirIssueInForceOn`.
      siteCounty: "Multnomah County, Oregon",
      publicWorks: true,
      bidAdvertisedOn: day(-120),
      awardingBody: "Riverside Health District",
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
  //
  // EVERY FIGURE HERE IS THE ONE THE APP ITSELF WOULD HAVE WRITTEN, and
  // until 2026-09-25 none of them was. `submitPayApplication`
  // (lib/actions/billing.ts) sets `amount` to
  // SUM(thisPeriodBilled + materialsStoredValue) across the rows and then
  // `retainageWithheld` to `retainageWithheldFor(amount, retainagePercent)`
  // — one formula, lib/billing/retainage-amount.ts. The seeded pair were
  // hand-written numbers that satisfied neither: invoice 1 said $86,450.00
  // against line items summing $94,650.00, and $4,550.00 of retainage
  // against 5% of either figure.
  //
  // That is not untidiness, it is a contradiction a contractor reads off
  // the screen. The G702 foots to its own continuation sheet, so it printed
  // "CURRENT PAYMENT DUE $90,100.00" while the billing tab beside it said
  // the invoice was $86,450.00 and PAID IN FULL, with a payment row for
  // exactly that. A demo dataset whose certificate disagrees with its own
  // invoice is worse than an empty screen — the numbers are read aloud and
  // somebody adds them up.
  //
  // So the amounts are DERIVED from the breakdown below rather than typed
  // beside it, and the retainage from the amount: change a line and both
  // follow. `pct()` is the same half-up rule retainage-amount.ts applies,
  // narrowed to the two-decimal inputs this file writes — not a second
  // formula for the app to disagree with, since nothing here is read by the
  // app; it is how the seed computes what the app would have stored.
  const sumBilled = (rows) => rows.reduce((total, r) => total + r.billed + r.stored, 0);
  const pct = (amount, percent) => (Math.round(amount * percent) / 100).toFixed(2);

  const inv1Rows = [
    { line: 0, billed: 52000, stored: 0 },
    { line: 1, billed: 34450, stored: 8200 },
  ];
  const inv1Amount = sumBilled(inv1Rows);
  const inv1 = await prisma.invoice.create({
    data: {
      jobId: riverside.id,
      number: 1,
      description: `Pay application 1 ${MARK}`,
      amount: inv1Amount.toFixed(2),
      issuedAt: day(-38),
      dueAt: day(-8),
      status: "PAID",
      retainageWithheld: pct(inv1Amount, 5),
    },
  });
  await prisma.payment.create({
    data: { invoiceId: inv1.id, amount: inv1Amount.toFixed(2), method: "ACH", receivedAt: day(-11) },
  });
  // Billed per SOV line, which is what makes it a pay application rather
  // than a lump sum — without these the G702/G703 report renders nothing.
  const invoiceLines = (invoiceId, rows) =>
    prisma.invoiceLineItem.createMany({
      data: rows.map((r) => ({
        invoiceId,
        lineItemId: riversideLines[r.line].id,
        thisPeriodBilled: r.billed.toFixed(2),
        materialsStoredValue: r.stored.toFixed(2),
      })),
    });
  await invoiceLines(inv1.id, inv1Rows);

  // The negative on the drywall line is the documented way to move value
  // OUT of stored material once it is installed — see the note on
  // InvoiceLineItem.materialsStoredValue. It is why `amount` here is less
  // than the hours billed this period, and it is deliberately kept: the
  // running "materials stored to date" figure on the G703 is the thing
  // pay-application-query.ts had to be fixed to carry across periods, and
  // a demo with a single period cannot show it at all.
  const inv2Rows = [
    { line: 1, billed: 48300, stored: -4000 },
    { line: 3, billed: 14000, stored: 0 },
  ];
  const inv2Amount = sumBilled(inv2Rows);
  const inv2 = await prisma.invoice.create({
    data: {
      jobId: riverside.id,
      number: 2,
      description: `Pay application 2 ${MARK}`,
      amount: inv2Amount.toFixed(2),
      issuedAt: day(-24),
      dueAt: day(-9),
      status: "PARTIALLY_PAID",
      retainageWithheld: pct(inv2Amount, 5),
    },
  });
  await prisma.payment.create({
    data: { invoiceId: inv2.id, amount: "30000", method: "Check", receivedAt: day(-4) },
  });
  await invoiceLines(inv2.id, inv2Rows);

  // THE COUNTER THOSE NUMBERS CAME FROM. Without this the demo dataset
  // shipped invoices #1, #1 and #2 and no InvoiceCounter row at all, and
  // "Create invoice" was PERMANENTLY dead on every seeded job — not flaky,
  // permanently. `issueInvoiceNumber` upserts `lastNumber: 1`, the insert
  // collides with the seeded #1 on @@unique([jobId, number]), and because the
  // bump and the insert are one `$transaction` the counter rolls back with
  // it. So the next attempt issues 1 again, and the next, forever. Demo
  // project and previews only — production seeds nothing — which is to say
  // it was broken in exactly the two places testers land.
  //
  // DERIVED FROM THE ROWS, not written as a literal, and that is the part
  // worth keeping: the six counters this file already seeded were right for
  // months while these two were missing, because each one is a hand-written
  // number sitting next to the rows it has to agree with. Adding a fourth
  // invoice above cannot leave this behind.
  //
  // Written out longhand, naming `prisma.invoiceCounter.upsert` literally,
  // rather than through a `prisma[accessor]` helper shared with the change
  // orders below. A dynamic accessor is invisible to a source scan, and the
  // guard that now polices this file (apps/web/lib/counterCensus.test.ts) is
  // a source scan — a helper here would have fixed the seed and left the
  // guard unable to see the fix, which is the shape this repo keeps paying
  // for.
  for (const group of await prisma.invoice.groupBy({
    by: ["jobId"],
    where: { job: { companyId: company.id, name: { contains: MARK } } },
    _max: { number: true },
  })) {
    const highest = group._max.number;
    if (highest == null) continue;
    const existing = await prisma.invoiceCounter.findUnique({
      where: { jobId: group.jobId },
      select: { lastNumber: true },
    });
    const lastNumber = raise(existing?.lastNumber, highest);
    await prisma.invoiceCounter.upsert({
      where: { jobId: group.jobId },
      create: { jobId: group.jobId, lastNumber },
      update: { lastNumber },
    });
  }

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
  ];
  // CERTIFIED_PAYROLL and UNION_FRINGE_BENEFIT_FILING are deliberately NOT
  // in that list. Both are period documents, and the period they have to
  // name is derived from the filing week the labour section below anchors —
  // a hand-picked offset here would print a week ending on a date with no
  // hours in it, which reads as a bug on the one screen whose whole subject
  // is which week a filing covers.
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

  // Same defect, same fix, one section up: `issueChangeOrderNumber` would
  // have issued 1 against a seeded CO #1 and rolled its own bump back on the
  // unique violation. "New change order" was dead on the demo job for the
  // same reason "Create invoice" was — ChangeOrder carries the same
  // @@unique([jobId, number]).
  for (const group of await prisma.changeOrder.groupBy({
    by: ["jobId"],
    where: { job: { companyId: company.id, name: { contains: MARK } } },
    _max: { number: true },
  })) {
    const highest = group._max.number;
    if (highest == null) continue;
    const existing = await prisma.changeOrderCounter.findUnique({
      where: { jobId: group.jobId },
      select: { lastNumber: true },
    });
    const lastNumber = raise(existing?.lastNumber, highest);
    await prisma.changeOrderCounter.upsert({
      where: { jobId: group.jobId },
      create: { jobId: group.jobId, lastNumber },
      update: { lastNumber },
    });
  }

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
    // `isDone` in the table above is now the demo's shorthand for "the
    // crew has been back to it": READY_FOR_REVIEW, waiting on somebody to
    // agree. The columns it used to write were dropped by
    // 20260920030000_punch_item_verification, and a state without its
    // stamp is refused by a CHECK constraint, so the date goes in
    // `readyAt` where the app reads it.
    await prisma.punchListItem.create({
      data: {
        companyId: company.id,
        jobId: riverside.id,
        description,
        status: isDone ? "READY_FOR_REVIEW" : "OPEN",
        readyAt: isDone ? day(doneAt ?? -1) : null,
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

  // ------------------------------------- union local, crafts and fringe rates
  //
  // WHY THIS SECTION EXISTS. Five screens in this product are about union
  // compliance — the apprentice ratio, the monthly fringe remittance, the
  // certified-payroll review, the WH-347 itself, and the craft/rate setup
  // behind them — and until now the seed wrote not one row any of them
  // reads. Every one demoed as an empty state. That is the exact failure
  // this file's own docstring names: derived state with nothing to derive
  // from, on the features that are hardest to argue for in the abstract and
  // most convincing with real hours behind them.
  //
  // FIND-OR-CREATE, never a blind create, for the same reason as the
  // prevailing-wage rule sets below: `@@unique([companyId,
  // parentInternational, localNumber])` on UnionLocal and
  // `@@unique([unionLocalId, name])` on CraftClassification both turn a
  // `--force` run into a half-finished seed, and FringeRateSchedule carries
  // a gist EXCLUDE constraint on overlapping ranges that no upsert can see.
  const ensureUnionLocal = async (data) => {
    const prior = await prisma.unionLocal.findFirst({
      where: {
        companyId: data.companyId,
        parentInternational: data.parentInternational,
        localNumber: data.localNumber,
      },
    });
    return prior ?? prisma.unionLocal.create({ data });
  };

  // TAGGED ON `jurisdictionName`, which is the field undo() finds it by —
  // and every craft, rate schedule and ratio rule under it is scoped by
  // unionLocalId rather than carrying its own tag. Same rule as a demo
  // contact's bid invitations: children are scoped by their parent, so a
  // craft name stays clean on a WH-347 that a person might print.
  const local = await ensureUnionLocal({
    companyId: company.id,
    parentInternational: "United Brotherhood of Carpenters",
    localNumber: "2154",
    jurisdictionName: `Portland & SW Washington ${MARK}`,
    tradeJurisdiction: "Interior systems — metal framing, drywall, acoustical ceilings",
  });

  // The agreement is not optional decoration. The WH-347 page reads its
  // craft classifications through
  // `unionLocal.companyAgreements.some({ companyId })` — so with no
  // agreement row the rate schedules are invisible to it, column 6 has
  // nothing to derive from, and the form blocks on every worker's rate of
  // pay while the rates sit in the database. loadUnionSetup drives off the
  // agreement too, so the whole setup section renders empty without it.
  const agreement = await prisma.companyUnionAgreement.findFirst({
    where: { companyId: company.id, unionLocalId: local.id },
  });
  if (!agreement) {
    await prisma.companyUnionAgreement.create({
      data: {
        companyId: company.id,
        unionLocalId: local.id,
        effectiveFrom: day(-730),
        effectiveTo: null,
      },
    });
  }

  // 1 apprentice per 3 journeymen. `programStandardReference` records which
  // CONVENTION the standard is written in — hours or headcount — because
  // lib/apprentice-ratio.ts measures hours and says so, and a reader of a
  // flagged day is entitled to know which one their own program uses.
  const priorRatio = await prisma.apprenticeRatioRule.findFirst({
    where: { companyId: company.id, unionLocalId: local.id },
  });
  if (!priorRatio) {
    await prisma.apprenticeRatioRule.create({
      data: {
        companyId: company.id,
        unionLocalId: local.id,
        apprenticeCount: 1,
        journeymenCount: 3,
        programStandardReference: "NW Carpenters JATC standards §7.3 — measured in hours worked",
      },
    });
  }

  // A TRADE'S JOURNEYMAN TIER AND ITS APPRENTICE TIER ARE TWO SEPARATE
  // ROWS. CraftClassification is unique on (unionLocalId, name) and carries
  // ONE `tier`, so "Interior Systems Carpenter" cannot be both — the ratio
  // counts hours by the tier on the row the hour was logged against, and a
  // single row would make every hour on the trade count as one side of a
  // ratio whose other side then never exists.
  //
  // `apprenticePeriod` is set only on the apprentice rows, which is what
  // the schema says it means: the wage STEP, identified here and priced by
  // the FringeRateSchedule attached to that same row.
  //
  // THE LAST ROW IS THE IMPORTANT ONE AND IT IS DELIBERATELY INCOMPLETE.
  // `Acoustical Ceiling Installer` has NO tier and NO rate schedule — the
  // shape of a craft somebody added when the ceiling scope came in and
  // never finished setting up. It is not a decoration and it is not a bug:
  // it is the genuine data condition behind the two honest answers this
  // product gives and its competitors do not. Hours on it make the day's
  // apprentice ratio read INCOMPLETE ("no honest verdict exists") instead
  // of quietly counting as journeyman hours and certifying the day
  // compliant, and they make the fringe remittance NAME them as hours it
  // refused to price instead of valuing them at zero. Remove it and both
  // screens lose the only thing on them that cannot be faked.
  const craftRows = [
    { key: "foreman", name: "Interior Systems Carpenter — Foreman", tier: "FOREMAN", period: null },
    { key: "carpenterJourneyman", name: "Interior Systems Carpenter — Journeyman", tier: "JOURNEYMAN", period: null },
    { key: "carpenterApprentice", name: "Interior Systems Carpenter — Apprentice, Period 3", tier: "APPRENTICE", period: 3 },
    { key: "finisherJourneyman", name: "Drywall Finisher — Journeyman", tier: "JOURNEYMAN", period: null },
    { key: "finisherApprentice", name: "Drywall Finisher — Apprentice, Period 2", tier: "APPRENTICE", period: 2 },
    { key: "ceilingUnclassified", name: "Acoustical Ceiling Installer", tier: null, period: null },
  ];
  const craft = {};
  for (const row of craftRows) {
    const prior = await prisma.craftClassification.findFirst({
      where: { unionLocalId: local.id, name: row.name },
    });
    craft[row.key] =
      prior ??
      (await prisma.craftClassification.create({
        data: {
          companyId: company.id,
          unionLocalId: local.id,
          name: row.name,
          tier: row.tier,
          apprenticePeriod: row.period,
        },
      }));
  }

  // Effective-dated, two adjacent HALF-OPEN windows per priced craft:
  // [-1095, -548) then [-548, ∞). The pair is the point rather than
  // padding — FringeRateSchedule's own comment says a flat rate field
  // "would quietly corrupt historical job costing the first time a rate
  // changed mid-project", and a demo with one window cannot show that the
  // rate applied to an hour is the rate in force ON ITS DATE. Every hour
  // this seed writes falls in the current window; the prior one exists so
  // the setup screen shows the history and so the claim is demonstrable.
  //
  // The ranges are adjacent and never overlapping because the database
  // enforces it with a gist EXCLUDE constraint (see
  // 20260824171704_add_union_affiliation) — an overlap kills the whole
  // seed, which is the #180 shape.
  //
  // The four components are separate columns because a remittance is four
  // funds and four cheques; a single blended "fringe" figure would have to
  // be taken apart again by hand, which is the re-entry this product
  // exists to remove.
  const rateRows = [
    // [craft, baseWage, pension, vacation, healthWelfare, training]
    ["foreman", 52.3, 9.1, 3.25, 10.4, 1.05],
    ["carpenterJourneyman", 46.85, 9.1, 3.25, 10.4, 1.05],
    // An apprentice's BASE is the step percentage of journeyman scale;
    // health & welfare and training are paid at the full rate, and pension
    // at a reduced one. That asymmetry is ordinary in a CBA and it is the
    // reason the four columns are not a single number.
    ["carpenterApprentice", 30.45, 4.55, 3.25, 10.4, 1.05],
    ["finisherJourneyman", 44.2, 8.65, 3.1, 10.4, 0.95],
    ["finisherApprentice", 24.3, 3.6, 3.1, 10.4, 0.95],
    // `ceilingUnclassified` is absent on purpose. See above.
  ];
  const ensureRate = async (craftClassificationId, effectiveFrom, effectiveTo, rates) => {
    const prior = await prisma.fringeRateSchedule.findFirst({
      where: { craftClassificationId, effectiveFrom },
    });
    if (prior) return prior;
    return prisma.fringeRateSchedule.create({
      data: {
        companyId: company.id,
        craftClassificationId,
        baseWage: rates[0].toFixed(2),
        pensionRate: rates[1].toFixed(2),
        vacationRate: rates[2].toFixed(2),
        healthWelfareRate: rates[3].toFixed(2),
        trainingRate: rates[4].toFixed(2),
        effectiveFrom,
        effectiveTo,
      },
    });
  };
  for (const [key, ...rates] of rateRows) {
    // The superseded window, 3.5% lower across every component — one
    // annual CBA step, which is what it is meant to look like.
    await ensureRate(
      craft[key].id,
      day(-1095),
      day(-548),
      rates.map((r) => Math.round(r * 0.965 * 100) / 100),
    );
    await ensureRate(craft[key].id, day(-548), null, rates);
  }

  // -------------------------------------------------------------------- crew
  //
  // CrewMember, not User, and that is the whole reason the model exists:
  // TimeEntry used to require a Clerk account, so a framing sub with a
  // 25-hand crew needed 25 sign-ups before it could record one hour. See
  // crew.prisma. A demo that logs every hour against the owner's own login
  // shows none of that and cannot show a WH-347 at all — column 1 wants a
  // worker's identifying number, which a User row has nowhere to put.
  //
  // `identifyingNumberLast4` is FOUR DIGITS, CHECKed in the migration, and
  // is the only SSN-derived value anywhere in this schema. `employeeNumber`
  // is the other form WH-347 column 1 accepts, and one crew member here
  // carries only that — a company that uses badge numbers never supplies an
  // SSN digit to this app, and the form has to print correctly for them too.
  //
  // Addresses are recorded because Davis-Bacon's basic-records rule
  // (29 CFR 5.5(a)(3)) requires the contractor to KEEP them, separately
  // from what the weekly form prints.
  //
  // Tagged on `note`, which undo() finds them by. NOT on the legal name:
  // the name is what a filed payroll asserts to a federal agency and it is
  // locked after creation by trigger, so "[demo]" in it would be
  // unremovable and would print on the form.
  const crewRows = [
    // [key, first, middle, last, last4, employeeNumber, craft key, hiredOn]
    ["hector", "Hector", "M", "Ramirez", "4182", "C-101", "foreman", -1460],
    ["tino", "Tino", null, "Alvarez", "7735", "C-104", "carpenterJourneyman", -980],
    ["marcus", "Marcus", "A", "Boye", "2019", "C-108", "carpenterJourneyman", -610],
    ["dorian", "Dorian", null, "Pike", "9043", "C-117", "carpenterApprentice", -240],
    ["adaeze", "Adaeze", null, "Nwosu", "5561", "C-112", "finisherJourneyman", -845],
    // No SSN last-4 on record, only the company's own badge number. Column 1
    // prints the badge, and the form does not block on this worker.
    ["ruben", "Ruben", "J", "Salazar", null, "C-121", "finisherApprentice", -150],
  ];
  const crew = {};
  for (const [key, first, middle, last, last4, employeeNumber, craftKey, hiredOn] of crewRows) {
    const prior = await prisma.crewMember.findFirst({
      where: { companyId: company.id, employeeNumber },
    });
    crew[key] =
      prior ??
      (await prisma.crewMember.create({
        data: {
          companyId: company.id,
          legalFirstName: first,
          legalMiddleName: middle,
          legalLastName: last,
          identifyingNumberLast4: last4,
          employeeNumber,
          addressLine1: "1140 SE Ankeny St",
          city: "Portland",
          state: "OR",
          zip: "97214",
          phone: "(503) 555-0173",
          hiredOn: day(hiredOn),
          note: MARK,
        },
      }));
    // Which crafts this person can be logged under — it drives the phone's
    // craft picker and nothing else. Not a certification and not enforced
    // when an hour is saved; see WorkerCraft in labor.prisma.
    const priorWorkerCraft = await prisma.workerCraft.findFirst({
      where: { craftClassificationId: craft[craftKey].id, crewMemberId: crew[key].id },
    });
    if (!priorWorkerCraft) {
      await prisma.workerCraft.create({
        data: {
          companyId: company.id,
          craftClassificationId: craft[craftKey].id,
          crewMemberId: crew[key].id,
        },
      });
    }
  }

  // --------------------------------------------- the hours, and their week
  //
  // TWO WEEKS OF CRAFT-TAGGED HOURS, anchored to a Sunday rather than to
  // "n days ago", because three separate screens cut this data on a week
  // boundary and they do not all use the same one.
  //
  // `sundayOf(day(-7))` is a Sunday whose entire Sun–Saturday week is in
  // the past, WHATEVER weekday the seed happens to be run on — that is the
  // property being bought, and a hand-picked offset does not have it. The
  // certified-payroll page (lib/certified-payroll-week.ts) opens on the week
  // of a job's LATEST logged hours, so putting nothing after that week's
  // Friday is what makes the WH-347 open on a FULL Monday-to-Friday week
  // instead of on a two-day stub. A seed dated from today alone lands on
  // whatever fragment of the current week has elapsed.
  //
  // Certified payroll counts a SUNDAY-start week; the prevailing-wage
  // overtime review counts a MONDAY-start one; the fringe remittance and
  // the apprentice ratio count a calendar MONTH. Weekday-only hours inside
  // a Sunday-anchored week are consistent under all three.
  const sundayOf = (date) => {
    const d = new Date(date);
    d.setUTCDate(d.getUTCDate() - d.getUTCDay());
    return d;
  };
  const plusDays = (date, n) => new Date(date.getTime() + n * 86_400_000);
  const filingWeekStart = sundayOf(day(-7));
  const priorWeekStart = plusDays(filingWeekStart, -7);
  // Monday = +1 … Friday = +5.
  const weekday = (weekStart, n) => plusDays(weekStart, n);

  // [crew key | "owner", craft key, hours, payType, SOV line, perDiem]
  //
  // The ratio verdicts each day is built to produce, which is the point of
  // the spread — a month where every day reads the same proves nothing:
  //
  //   filing Mon/Tue/Thu   WITHIN          32 journeyman hours, 8 apprentice
  //                                        against an allowance of 10.67
  //   filing Wed           OVER            a second apprentice put on with no
  //                                        extra journeyman: 16 against 10.67
  //   filing Fri           WITHIN          overtime on two journeymen, which
  //                                        raises the allowance to 12
  //   prior Mon/Tue        WITHIN          24 journeyman, 8 apprentice, exactly
  //                                        at the allowance and not over it
  //   prior Wed            INCOMPLETE      16 hours on the untiered ceiling
  //                                        craft — "can't be judged"
  //   prior Thu            WITHIN
  //   prior Fri            NOT_APPLICABLE  no apprentice on site, so the rule
  //                                        has nothing to bind
  //
  // The owner's own hours are in the PRIOR week only, deliberately. A
  // working owner is ordinary in this trade and the User path has to stay
  // exercised — but a User row has no identifying number for WH-347 column
  // 1, so their presence would block a line on the form. Keeping them out
  // of the filing week leaves that week printable end to end and still
  // demonstrates the block on the week before it.
  const laborDays = [
    // ---- the prior week
    [priorWeekStart, 1, [
      ["hector", "foreman", 8, "STRAIGHT", 0, null],
      ["tino", "carpenterJourneyman", 8, "STRAIGHT", 0, null],
      ["marcus", "carpenterJourneyman", 8, "STRAIGHT", 0, null],
      ["dorian", "carpenterApprentice", 8, "STRAIGHT", 0, null],
    ]],
    [priorWeekStart, 2, [
      ["hector", "foreman", 8, "STRAIGHT", 0, null],
      ["tino", "carpenterJourneyman", 8, "STRAIGHT", 0, null],
      ["marcus", "carpenterJourneyman", 8, "STRAIGHT", 0, null],
      ["dorian", "carpenterApprentice", 8, "STRAIGHT", 0, null],
    ]],
    // THE DAY THAT CANNOT BE JUDGED. Two journeymen moved onto the ceiling
    // scope, logged against a craft with no tier recorded and no rate
    // schedule behind it. Nothing about this is a special case in the
    // code — the ratio refuses the day because 16 hours cannot be placed on
    // either side of it, and the remittance refuses to price them for the
    // separate reason that no schedule is effective for that craft.
    [priorWeekStart, 3, [
      ["hector", "foreman", 8, "STRAIGHT", 0, null],
      ["tino", "ceilingUnclassified", 8, "STRAIGHT", 2, null],
      ["marcus", "ceilingUnclassified", 8, "STRAIGHT", 2, null],
      ["dorian", "carpenterApprentice", 8, "STRAIGHT", 0, null],
    ]],
    [priorWeekStart, 4, [
      ["hector", "foreman", 8, "STRAIGHT", 0, null],
      ["tino", "carpenterJourneyman", 8, "STRAIGHT", 0, null],
      ["marcus", "carpenterJourneyman", 8, "STRAIGHT", 0, null],
      ["adaeze", "finisherJourneyman", 8, "STRAIGHT", 1, null],
      ["ruben", "finisherApprentice", 8, "STRAIGHT", 1, null],
    ]],
    [priorWeekStart, 5, [
      ["hector", "foreman", 8, "STRAIGHT", 0, null],
      ["tino", "carpenterJourneyman", 8, "STRAIGHT", 0, null],
      ["adaeze", "finisherJourneyman", 8, "STRAIGHT", 1, null],
      ["owner", "carpenterJourneyman", 8, "STRAIGHT", 0, null],
    ]],
    // ---- the filing week: what the WH-347 prints
    [filingWeekStart, 1, [
      ["hector", "foreman", 8, "STRAIGHT", 0, 55],
      ["tino", "carpenterJourneyman", 8, "STRAIGHT", 0, null],
      ["marcus", "carpenterJourneyman", 8, "STRAIGHT", 0, null],
      ["adaeze", "finisherJourneyman", 8, "STRAIGHT", 1, null],
      ["dorian", "carpenterApprentice", 8, "STRAIGHT", 0, null],
    ]],
    [filingWeekStart, 2, [
      ["hector", "foreman", 8, "STRAIGHT", 0, null],
      ["tino", "carpenterJourneyman", 8, "STRAIGHT", 0, null],
      ["marcus", "carpenterJourneyman", 8, "STRAIGHT", 0, null],
      ["adaeze", "finisherJourneyman", 8, "STRAIGHT", 1, null],
      ["dorian", "carpenterApprentice", 8, "STRAIGHT", 0, null],
    ]],
    // OVER. The second apprentice came on and no journeyman came with him.
    [filingWeekStart, 3, [
      ["hector", "foreman", 8, "STRAIGHT", 0, null],
      ["tino", "carpenterJourneyman", 8, "STRAIGHT", 0, null],
      ["marcus", "carpenterJourneyman", 8, "STRAIGHT", 0, null],
      ["adaeze", "finisherJourneyman", 8, "STRAIGHT", 1, null],
      ["dorian", "carpenterApprentice", 8, "STRAIGHT", 0, null],
      ["ruben", "finisherApprentice", 8, "STRAIGHT", 1, null],
    ]],
    [filingWeekStart, 4, [
      ["hector", "foreman", 8, "STRAIGHT", 0, null],
      ["tino", "carpenterJourneyman", 8, "STRAIGHT", 0, null],
      ["marcus", "carpenterJourneyman", 8, "STRAIGHT", 0, null],
      ["adaeze", "finisherJourneyman", 8, "STRAIGHT", 1, null],
      ["dorian", "carpenterApprentice", 8, "STRAIGHT", 0, null],
    ]],
    // Overtime, which matters twice on these screens. WH-347 column 7 pays
    // it at time and a half on the BASE wage; the fringe remittance pays the
    // same flat per-hour fringe as any other hour (the Davis-Bacon
    // convention lib/labor-cost.ts follows). A demo with no overtime in it
    // cannot show that those two rules differ, and getting the second one
    // wrong overstates every remittance in a month.
    [filingWeekStart, 5, [
      ["hector", "foreman", 8, "STRAIGHT", 0, null],
      ["hector", "foreman", 2, "OVERTIME", 0, null],
      ["tino", "carpenterJourneyman", 8, "STRAIGHT", 0, null],
      ["tino", "carpenterJourneyman", 2, "OVERTIME", 0, null],
      ["marcus", "carpenterJourneyman", 8, "STRAIGHT", 0, null],
      ["adaeze", "finisherJourneyman", 8, "STRAIGHT", 1, null],
      ["dorian", "carpenterApprentice", 8, "STRAIGHT", 0, null],
    ]],
  ];

  // A mixed day is TWO ROWS, not one row at a blended rate — 8 straight
  // plus 2 overtime above. TimeEntry's own comment says why: a blended-rate
  // row needs a multiplier nothing stores, and certified payroll has to
  // print the two separately anyway.
  let laborHours = 0;
  let laborRows = 0;
  for (const [weekStart, dayOffset, entries] of laborDays) {
    for (const [who, craftKey, hours, payType, line, perDiem] of entries) {
      const isOwner = who === "owner";
      if (isOwner && !user) continue;
      await prisma.timeEntry.create({
        data: {
          jobId: riverside.id,
          lineItemId: riversideLines[line].id,
          // Exactly one of these two, never both and never neither — a XOR
          // CHECK constraint in the migration enforces it.
          employeeUserId: isOwner ? user.id : null,
          crewMemberId: isOwner ? null : crew[who].id,
          craftClassificationId: craft[craftKey].id,
          date: weekday(weekStart, dayOffset),
          hours: hours.toFixed(2),
          payType,
          perDiemAmount: perDiem === null ? null : perDiem.toFixed(2),
        },
      });
      laborHours += hours;
      laborRows += 1;
    }
  }

  // Next week's plan, so the apprentice ratio can be read BEFORE the hours
  // exist rather than after. CrewScheduleDay is a headcount, not hours —
  // `loadJobDayRatio` feeds it as one per person — which is all a schedule
  // can honestly say. Two apprentices against two journeymen on the Tuesday
  // is a breach the foreman can still fix, which is the entire value of
  // planning it.
  const plannedDays = [
    [1, [["hector", "foreman"], ["tino", "carpenterJourneyman"], ["marcus", "carpenterJourneyman"], ["dorian", "carpenterApprentice"]]],
    [2, [["tino", "carpenterJourneyman"], ["dorian", "carpenterApprentice"], ["ruben", "finisherApprentice"], ["adaeze", "finisherJourneyman"]]],
  ];
  const nextWeekStart = plusDays(sundayOf(day(0)), 7);
  for (const [dayOffset, people] of plannedDays) {
    for (const [who, craftKey] of people) {
      await prisma.crewScheduleDay.create({
        data: {
          companyId: company.id,
          jobId: riverside.id,
          workDate: weekday(nextWeekStart, dayOffset),
          crewMemberId: crew[who].id,
          craftClassificationId: craft[craftKey].id,
        },
      });
    }
  }

  // ------------------------------------------- the WH-347's other two halves
  //
  // WH-347 columns 8 and 9 are the week's deductions and net pay, and this
  // product does not compute them — it never will, and payroll-register
  // .prisma says so. They are IMPORTED from the register the contractor's
  // payroll system already prints. So the demo has to carry a register for
  // exactly this week, or the form blocks both columns with "Import this
  // week's register under Settings → Import" and a viewer cannot tell a
  // missing import from a broken one.
  //
  // MATCHED ON THE PERIOD EXACTLY. The page reads only
  // `periodStart: weekStart, periodEnd: weekEnding`; a register that merely
  // OVERLAPS the week is somebody else's paycheck and buildWh347 blocks the
  // worker rather than guessing at a partial week.
  //
  // MONEY IS CENTS, in integers, always — the register is what the
  // deductions on a signed federal form get copied from, and a float that
  // renders as 1147.9999999 is not that document.
  const filingWeekEnd = plusDays(filingWeekStart, 6);

  // GROSS IS DERIVED FROM THE HOURS, NOT TYPED BESIDE THEM, and this is the
  // figure most worth deriving in the whole file. WH-347 column 7 is THIS
  // PROJECT's gross and column 8/9 are the WHOLE paycheck, so the two are
  // allowed to differ — which means a typo in a hand-written register figure
  // is not a contradiction the form can catch. It just prints, and the first
  // draft of this seed printed one worker whose weekly deductions exceeded
  // his gross earnings because his hand-written register assumed a full week
  // and he had one day on the job.
  //
  // So the register is computed at the same base wages and the same
  // time-and-a-half the form itself applies, over the same filing week. That
  // is a statement about this crew: they worked THIS JOB and nothing else
  // that week, so columns 7 and 8/9 are about the same money and a viewer
  // comparing them gets the same number. It is the simplest thing to explain
  // out loud, and it is true of the data rather than asserted over it.
  const CASH_MULTIPLIER = { STRAIGHT: 1, OVERTIME: 1.5, DOUBLE_TIME: 2, SHIFT_DIFFERENTIAL: 1 };
  const baseWageOf = Object.fromEntries(rateRows.map(([key, baseWage]) => [key, baseWage]));
  const weekGross = {};
  const weekHours = {};
  for (const [weekStart, , entries] of laborDays) {
    if (weekStart !== filingWeekStart) continue;
    for (const [who, craftKey, hours, payType] of entries) {
      const base = baseWageOf[craftKey];
      // The untiered craft has no rate, so it contributes no gross — the
      // same refusal the form and the remittance make, for the same reason.
      if (who === "owner" || base === undefined) continue;
      weekGross[who] = (weekGross[who] ?? 0) + hours * base * CASH_MULTIPLIER[payType];
      weekHours[who] = (weekHours[who] ?? 0) + hours;
    }
  }

  // Withholding rates a payroll system would have applied. Round numbers on
  // purpose: this app computes no withholding and never will
  // (payroll-register.prisma), so these are stand-ins for what Gusto or ADP
  // printed, not a calculation anybody should read as one. `other` is the
  // dues check-off, which is why it is a flat rate rather than a percentage.
  const WITHHOLDING = { fica: 0.0765, federal: 0.12, state: 0.068 };
  const cents = (dollars) => Math.round(dollars * 100);
  for (const [who, gross] of Object.entries(weekGross)) {
    const fica = Math.round(gross * WITHHOLDING.fica * 100) / 100;
    const federal = Math.round(gross * WITHHOLDING.federal * 100) / 100;
    const state = Math.round(gross * WITHHOLDING.state * 100) / 100;
    const other = 24.0;
    const deductions = cents(fica) + cents(federal) + cents(state) + cents(other);
    await prisma.payrollRegisterEntry.upsert({
      where: {
        crewMemberId_periodStart_periodEnd: {
          crewMemberId: crew[who].id,
          periodStart: filingWeekStart,
          periodEnd: filingWeekEnd,
        },
      },
      create: {
        companyId: company.id,
        crewMemberId: crew[who].id,
        periodStart: filingWeekStart,
        periodEnd: filingWeekEnd,
        payDate: plusDays(filingWeekEnd, 5),
        // The register's OWN hours column, kept because payroll-register
        // .prisma says the app's TimeEntry hours stay authoritative and this
        // is here so an office manager can see the two sources disagree.
        // They agree here, which is the state worth demoing: the interesting
        // screen is the one where they do not, and that is a real import's
        // job to produce, not a seed's.
        hours: weekHours[who].toFixed(2),
        grossCents: cents(gross),
        deductionsCents: deductions,
        netCents: cents(gross) - deductions,
        deductionsDetail: {
          ficaCents: cents(fica),
          federalTaxCents: cents(federal),
          stateTaxCents: cents(state),
          otherCents: cents(other),
        },
        source: "generic",
      },
      update: {},
    });
  }

  // The form's "Payroll No.", sequential PER PROJECT so the DOL can see
  // that no week is missing from the run. It comes from a counter row,
  // bumped in the same transaction as the insert — never max(n)+1 off the
  // surviving rows, the same rule as every other sequence in this file.
  // Without it the header blocks on "Issue this week's with the button
  // above the form", which is a fine thing for a real user to be told and a
  // poor thing to open a demo on.
  //
  // TWO weeks get a number, in order, because a single number cannot show
  // a sequence. Written out longhand against `prisma.wh347PayrollCounter`
  // for the reason the invoice counter above is: the guard that polices
  // this file is a source scan, and a dynamic accessor is invisible to it.
  for (const weekStart of [priorWeekStart, filingWeekStart]) {
    const prior = await prisma.wh347PayrollNumber.findUnique({
      where: { jobId_weekStart: { jobId: riverside.id, weekStart } },
      select: { id: true },
    });
    if (prior) continue;
    await prisma.$transaction(async (tx) => {
      const counter = await tx.wh347PayrollCounter.upsert({
        where: { jobId: riverside.id },
        create: { jobId: riverside.id, lastNumber: 1 },
        update: { lastNumber: { increment: 1 } },
        select: { lastNumber: true },
      });
      await tx.wh347PayrollNumber.create({
        data: { jobId: riverside.id, weekStart, number: counter.lastNumber },
      });
    });
  }

  // The two PERIOD documents, now that the periods exist.
  //
  // The certified payroll names the filing week it was filed for. The fringe
  // filing names LAST month, on purpose and not for want of a current one:
  // `periodIsFiled` derives "is this month's remittance on record" by
  // looking for a document whose period COVERS the month, so a filing for
  // the current month would open /union-compliance on "A filing covering
  // this whole month is on record" — nothing to do, and no evidence the
  // derivation works. One month back gives both answers on one screen: this
  // month outstanding, last month closed, and the reader can step back and
  // see it flip.
  //
  // Attached to the job rather than left company-level (`jobId` is nullable)
  // for one reason and it is about cleanup, not accuracy: `undo()` finds
  // compliance documents by `jobId`, and ComplianceDocument is in
  // `NEVER_DELETE` in scratch-scope.mjs because it is evidence — so a
  // company-level demo row would survive both scripts forever. Nothing reads
  // the jobId here (`loadRemittance` filters on company and type only), so
  // the derivation is unaffected.
  const lastMonthStart = new Date(
    Date.UTC(filingWeekStart.getUTCFullYear(), filingWeekStart.getUTCMonth() - 1, 1),
  );
  const lastMonthEnd = new Date(
    Date.UTC(filingWeekStart.getUTCFullYear(), filingWeekStart.getUTCMonth(), 0),
  );
  const periodDocs = [
    {
      type: "CERTIFIED_PAYROLL",
      partyName: `Oregon BOLI — WH-38, week ending ${iso(filingWeekEnd)} ${MARK}`,
      periodStart: filingWeekStart,
      periodEnd: filingWeekEnd,
      amount: null,
    },
    {
      type: "UNION_FRINGE_BENEFIT_FILING",
      partyName: `Carpenters Trust of Western Washington — ${iso(lastMonthStart).slice(0, 7)} ${MARK}`,
      periodStart: lastMonthStart,
      periodEnd: lastMonthEnd,
      amount: "18420.75",
    },
  ];
  for (const d of periodDocs) {
    const prior = await prisma.complianceDocument.findFirst({
      where: { companyId: company.id, type: d.type, periodStart: d.periodStart, periodEnd: d.periodEnd },
    });
    if (prior) continue;
    await prisma.complianceDocument.create({
      data: {
        companyId: company.id,
        jobId: riverside.id,
        type: d.type,
        partyName: d.partyName,
        status: "RECEIVED",
        periodStart: d.periodStart,
        periodEnd: d.periodEnd,
        amount: d.amount,
      },
    });
  }

  console.log(
    `seed: union labor     ${laborRows} time entries, ${laborHours} hours, ` +
      `${crewRows.length} crew, ${craftRows.length} crafts (1 untiered on purpose)`,
  );
  console.log(
    `seed: filing week     ${iso(filingWeekStart)} – ${iso(filingWeekEnd)} ` +
      `(the week /jobs/<id>/certified-payroll opens on)`,
  );
  console.log(
    `seed: hours month(s)  ${iso(weekday(priorWeekStart, 1)).slice(0, 7)} – ` +
      `${iso(weekday(filingWeekStart, 5)).slice(0, 7)} ` +
      `(/union-compliance opens on the CURRENT month — step back if the hours are in the previous one)`,
  );

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
  //
  // Find-or-create, never a blind create. These ranges are computed
  // relative to TODAY, so a second run's range always overlaps whatever a
  // first run wrote and the gist EXCLUDE constraint killed the whole seed
  // halfway (issue #180). A tagged row that is already there was valid the
  // day it was written and its ranges are still disjoint from each other,
  // so it is reused as-is rather than raced against the constraint. Prisma
  // cannot `upsert` here — upsert needs a unique key and non-overlap is an
  // exclusion constraint the client does not even know exists — which is
  // why this is spelled out as findFirst + create on the natural key
  // (company, jurisdiction, tagged name) instead.
  const ensureRuleSet = async (data) => {
    const prior = await prisma.prevailingWageRuleSet.findFirst({
      where: { companyId: data.companyId, jurisdiction: data.jurisdiction, name: data.name },
    });
    return prior ?? prisma.prevailingWageRuleSet.create({ data });
  };
  const oregonPrior = await ensureRuleSet({
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
  });
  const oregonCurrent = await ensureRuleSet({
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
  });
  await ensureRuleSet({
    companyId: company.id,
    name: `Clark County, WA — not yet researched ${MARK}`,
    jurisdiction: "Clark County, WA",
    authority: "COUNTY",
    // Every threshold null on purpose. See above.
    filingFrequency: "MONTHLY",
    effectiveFrom: day(-90),
    note: "Recorded so the jurisdiction is not invisible. Thresholds still to be read off the determination.",
  });
  // Attaches the current Oregon rules to the job that has time entries, so
  // /prevailing-wage has a week to review rather than an empty selector.
  //
  // THE THREE DATE FIELDS ARE WHAT MAKE THE STANDING LINE SAY ANYTHING.
  // `determinationStanding` is derived on every read from what a person
  // ENTERED off the document, and with any of them null it returns
  // `unchecked` — "this determination's issue date hasn't been entered" —
  // which is the honest answer and a dead screen. Every one of them is on
  // the row now, and the job carries the `bidAdvertisedOn` the rule is
  // judged against (see the job above).
  //
  // The combination is chosen to exercise the published rule rather than
  // its easy case. `issuedOn` is derived from the advertisement date so the
  // pairing survives the calendar (see `dirIssueInForceOn`); the expiration
  // has PASSED and carries a SINGLE asterisk, which is the DIR rule that the
  // determination in force on the advertisement date holds for the life of
  // the project. So the line reads, in full and in the affirmative: "In
  // force on <date>, when the job was advertised. Its expiration <date> has
  // passed with a single asterisk (*), so it holds for the life of the
  // project." That sentence is three entered dates and a published rule, and
  // nothing in the database stores it.
  await prisma.prevailingWageDetermination.create({
    data: {
      jobId: riverside.id,
      jurisdiction: "Oregon",
      ruleSetId: oregonCurrent.id,
      fileName: "boli-determination-riverside.pdf",
      sourceUrl: "https://www.oregon.gov/boli/example/rates",
      note: `Public works — BOLI rates apply. ${MARK}`,
      determinationRef: "PWD-2026-1 / Region 2 — Interior Systems",
      issuedOn: dirIssueInForceOn(day(-120)),
      expiresOn: day(-30),
      expirationMarker: "SINGLE",
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

  console.log("seed: change orders, submittals, punch list, closeout, talks, orders, drawings, union local, crafts, fringe rates, crew, craft-tagged hours, payroll register, WH-347 numbers, catalog, pricing, RFIs, safety, bids, interactions, equipment, prevailing wage, backcharges, closeout submissions and messages written");
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

  // Same rule again for the union-compliance set: the LOCAL carries the tag
  // and everything under it is scoped by its id, so a craft classification
  // keeps a clean name on a WH-347 somebody might print. Crew members carry
  // the tag in `note` — never in the legal name, which is what a filed
  // payroll asserts to a federal agency and which a database trigger locks
  // after creation, so "[demo]" in it could never be taken back out.
  const locals = await prisma.unionLocal.findMany({
    where: { companyId, jurisdictionName: { contains: MARK } },
    select: { id: true },
  });
  const localIds = locals.map((l) => l.id);
  const crafts = await prisma.craftClassification.findMany({
    where: { unionLocalId: { in: localIds } },
    select: { id: true },
  });
  const craftIds = crafts.map((c) => c.id);
  const crewMembers = await prisma.crewMember.findMany({
    where: { companyId, note: { contains: MARK } },
    select: { id: true },
  });
  const crewMemberIds = crewMembers.map((c) => c.id);

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
    // Sign-offs first: a live one makes the day-lock triggers refuse to
    // delete that day's hours, its daily report and its delays.
    await del("timesheetSignoff", () =>
      prisma.timesheetSignoff.deleteMany({ where: { jobId: { in: jobIds } } }),
    );
    await del("delayEvent", () => prisma.delayEvent.deleteMany({ where: { jobId: { in: jobIds } } }));
    await del("dailyFieldReport", () =>
      prisma.dailyFieldReport.deleteMany({ where: { jobId: { in: jobIds } } }),
    );
    await del("tmTicket", () => prisma.tmTicket.deleteMany({ where: { jobId: { in: jobIds } } }));
    // RESTRICT on Job — see the note in clean-scratch-data.mjs about the
    // blobs these rows point at, which this does not remove.
    await del("jobMedia", () => prisma.jobMedia.deleteMany({ where: { jobId: { in: jobIds } } }));
    await del("takeoffPlan", () => prisma.takeoffPlan.deleteMany({ where: { jobId: { in: jobIds } } }));
    // SCOPED TO THE DEMO JOBS, unlike the same delete in
    // clean-scratch-data.mjs, which scopes to the company. The difference is
    // what each script is allowed to touch: this undo removes only what the
    // seed created and anything filed against it, and a company's unfiled
    // intake tray is a person's own data that no seed put there. So an
    // intake row with no job survives this and is removed by the other
    // script, which is the one that exists to clear typed-in scratch.
    //
    // Not a blocker of Job (optional jobId -> SET NULL), so the job delete
    // below would succeed without this line. It is here so a demo job's
    // filed documents go with the job rather than becoming tray rows
    // pointing at nothing.
    await del("documentIntake", () =>
      prisma.documentIntake.deleteMany({ where: { jobId: { in: jobIds } } }),
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
    await del("jobProposalClause", () =>
      prisma.jobProposalClause.deleteMany({ where: { jobId: { in: jobIds } } }),
    );
    await del("wallRun", () =>
      prisma.wallRun.deleteMany({ where: { jobId: { in: jobIds } } }),
    );
    await del("jobBidRecap", () =>
      prisma.jobBidRecap.deleteMany({ where: { jobId: { in: jobIds } } }),
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
    await del("crewScheduleDay", () => prisma.crewScheduleDay.deleteMany({ where: { jobId: { in: jobIds } } }));
    await del("lienDeadline", () => prisma.lienDeadline.deleteMany({ where: { jobId: { in: jobIds } } }));
    // Cascades to its cached ProcoreItem rows. Nothing in Procore changes.
    await del("procoreProjectLink", () => prisma.procoreProjectLink.deleteMany({ where: { jobId: { in: jobIds } } }));
    // Cascades to its cached AccItem rows. Same shape as ProcoreProjectLink
    // — nothing in ACC changes.
    await del("accProjectLink", () => prisma.accProjectLink.deleteMany({ where: { jobId: { in: jobIds } } }));
    // CASCADE on Job, same shape as ProcoreProjectLink — the link is a
    // pointer at CompanyCam, not evidence. Nothing in CompanyCam changes.
    await del("companyCamProjectLink", () => prisma.companyCamProjectLink.deleteMany({ where: { jobId: { in: jobIds } } }));
    // CASCADE on Job, same shape as ProcoreProjectLink and
    // CompanyCamProjectLink — the link is a pointer at Bluebeam, not
    // evidence. Nothing in Bluebeam changes.
    await del("bluebeamStudioSession", () => prisma.bluebeamStudioSession.deleteMany({ where: { jobId: { in: jobIds } } }));
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
    // InvoiceCounter is RESTRICT on Job and is NOT reached by deleting the
    // invoices — it is keyed on jobId, so a job whose every invoice is gone
    // still has its counter and still blocks the job delete. Safe to remove
    // here for the reason the high-water-mark rule gives: this is a PER-JOB
    // sequence and the job is going too, so the numbering ceases to exist
    // rather than restarting. (Contrast SafetyCaseCounter, which is
    // company-scoped and deliberately kept.)
    await del("invoiceCounter", () =>
      prisma.invoiceCounter.deleteMany({ where: { jobId: { in: jobIds } } }),
    );
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
    // ContractDocumentVersionCounter is RESTRICT on Job and is NOT reached by
    // deleting the contract documents -- it is keyed on jobId, so a job whose
    // every document is gone still has its counter and still blocks the job
    // delete. Same shape as InvoiceCounter (#227).
    await del("contractDocumentVersionCounter", () =>
      prisma.contractDocumentVersionCounter.deleteMany({ where: { jobId: { in: jobIds } } }),
    );
    await del("signatureRequest", () =>
      prisma.signatureRequest.deleteMany({ where: { jobId: { in: jobIds } } }),
    );
    // RESTRICT on Job; its ContractDocument/ChangeOrder links are SET NULL.
    await del("docuSignEnvelope", () =>
      prisma.docuSignEnvelope.deleteMany({ where: { jobId: { in: jobIds } } }),
    );
    await del("retainageRelease", () =>
      prisma.retainageRelease.deleteMany({ where: { jobId: { in: jobIds } } }),
    );
    await del("estimateVersion", () =>
      prisma.estimateVersion.deleteMany({ where: { jobId: { in: jobIds } } }),
    );
    // EstimateVersionCounter, same shape as the two counters above (#289):
    // deleting the versions does not reach it, so it outlives them and
    // blocks the job delete on its own.
    await del("estimateVersionCounter", () =>
      prisma.estimateVersionCounter.deleteMany({ where: { jobId: { in: jobIds } } }),
    );
    // WH-347 payroll numbers and their per-job counter -- the #227 shape:
    // jobId-keyed RESTRICT children nothing else's delete reaches.
    await del("wh347PayrollNumber", () =>
      prisma.wh347PayrollNumber.deleteMany({ where: { jobId: { in: jobIds } } }),
    );
    await del("wh347PayrollCounter", () =>
      prisma.wh347PayrollCounter.deleteMany({ where: { jobId: { in: jobIds } } }),
    );
    await del("dispatchSlip", () =>
      prisma.dispatchSlip.deleteMany({ where: { jobId: { in: jobIds } } }),
    );
    // DAS 140 / DAS 142 notices -- the #227 shape: jobId-keyed RESTRICT
    // children nothing else's delete reaches. The seed creates none; these
    // lines are here so a demo job somebody clicked a notice onto can still
    // be undone.
    await del("das140Notice", () =>
      prisma.das140Notice.deleteMany({ where: { jobId: { in: jobIds } } }),
    );
    await del("das142Request", () =>
      prisma.das142Request.deleteMany({ where: { jobId: { in: jobIds } } }),
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

  // ------------------------------------------------ the union-compliance set
  //
  // COMPANY-LEVEL, so it sits here rather than in the job-scoped section, and
  // ordered by the foreign keys in the migrations rather than by memory.
  // Every RESTRICT below was read out of
  // 20260824171704_add_union_affiliation and its successors:
  //
  //   PayrollRegisterEntry.crewMemberId  -> CrewMember           RESTRICT
  //   CrewScheduleDay.crewMemberId       -> CrewMember           RESTRICT
  //   DispatchSlip.crewMemberId          -> CrewMember           RESTRICT
  //   TimeEntry.crewMemberId             -> CrewMember           RESTRICT
  //   FringeRateSchedule.craftClass…     -> CraftClassification  RESTRICT
  //   ApprenticeRatioRule.unionLocalId   -> UnionLocal           RESTRICT
  //   CompanyUnionAgreement.unionLocalId -> UnionLocal           RESTRICT
  //   CraftClassification.unionLocalId   -> UnionLocal           RESTRICT
  //
  // Three of the four CrewMember blockers are job-scoped and already gone
  // above (hours, planned days, dispatch slips). The PAYROLL REGISTER is the
  // one that is not: it hangs off the crew member and carries NO jobId, by
  // design — a paycheck covers everything the person worked that period, not
  // one job — so deleting the jobs does not reach it and it would refuse the
  // crew-member delete on its own. That is exactly the #227 shape, arriving
  // through a company-scoped table instead of a per-job counter.
  //
  // WorkerCraft CASCADEs from both its parents, so it would go either way;
  // it is deleted explicitly so the count is reported against the run that
  // made it rather than disappearing into a cascade. Everything else that
  // points at a craft classification — JobLineItem, LineItemCatalogEntry,
  // WallTypeComponent, DispatchSlip, CrewScheduleDay, TimeEntry,
  // ApprenticeshipEnrollment — is ON DELETE SET NULL and cannot block.
  await del("payrollRegisterEntry", () =>
    prisma.payrollRegisterEntry.deleteMany({ where: { crewMemberId: { in: crewMemberIds } } }),
  );
  await del("workerCraft", () =>
    prisma.workerCraft.deleteMany({
      where: { OR: [{ crewMemberId: { in: crewMemberIds } }, { craftClassificationId: { in: craftIds } }] },
    }),
  );
  await del("crewMember", () => prisma.crewMember.deleteMany({ where: { id: { in: crewMemberIds } } }));
  await del("fringeRateSchedule", () =>
    prisma.fringeRateSchedule.deleteMany({ where: { craftClassificationId: { in: craftIds } } }),
  );
  await del("apprenticeRatioRule", () =>
    prisma.apprenticeRatioRule.deleteMany({ where: { unionLocalId: { in: localIds } } }),
  );
  await del("companyUnionAgreement", () =>
    prisma.companyUnionAgreement.deleteMany({ where: { unionLocalId: { in: localIds } } }),
  );
  await del("craftClassification", () =>
    prisma.craftClassification.deleteMany({ where: { id: { in: craftIds } } }),
  );
  await del("unionLocal", () => prisma.unionLocal.deleteMany({ where: { id: { in: localIds } } }));
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
