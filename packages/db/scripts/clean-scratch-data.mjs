import { PrismaClient } from "@prisma/client";
import { loadEnvFiles } from "./load-env.mjs";
import { describe } from "./connection-target.mjs";

/**
 * Removes hand-entered scratch data — the rows typed while testing, which
 * are demo-hostile on screen: a job called "test" worth $0.00 for a client
 * called "ss", a vendor called "Tighties LLC", and a contact whose email
 * reads as a real person's gmail in front of a room.
 *
 * NOT the same thing as `seed-demo.mjs --undo`. That removes rows this
 * repo generated and tagged. This removes rows a PERSON typed, which is
 * why it behaves differently in three ways:
 *
 *   - It LISTS before it removes, and listing is the default. You have to
 *     ask for the delete separately, having seen the list.
 *   - It never touches anything tagged [demo]; that has its own undo.
 *   - It never touches Company, User, or anything under them.
 *
 * Deleting somebody's data because a script decided it looked like junk is
 * a worse outcome than a scruffy demo, so the default does nothing.
 *
 *   node scripts/clean-scratch-data.mjs                      # list only
 *   SCRATCH_EXPECT_HOST=ep-icy-hat node scripts/clean-scratch-data.mjs --delete
 */

loadEnvFiles();

const MARK = "[demo]";
const DELETE = process.argv.includes("--delete");

const target = describe(process.env.DATABASE_URL);
if (!target) {
  console.error("clean: DATABASE_URL is missing or unreadable. Nothing done.");
  process.exit(1);
}
console.log(`clean: database       ${target.label}`);
console.log(`clean: mode           ${DELETE ? "DELETE" : "list only (pass --delete to remove)"}\n`);

if (DELETE) {
  const expect = process.env.SCRATCH_EXPECT_HOST?.trim();
  if (!expect) {
    console.error(
      "clean: refusing to delete without SCRATCH_EXPECT_HOST.\n" +
        `clean: name the database you mean, e.g. SCRATCH_EXPECT_HOST=${target.host.split(".")[0]}\n` +
        "clean: this removes rows a person typed, and it cannot be undone.",
    );
    process.exit(1);
  }
  if (!target.host.includes(expect)) {
    console.error(
      `clean: REFUSING — you asked for "${expect}" and DATABASE_URL points at\n` +
        `clean: ${target.host}\nclean: nothing has been deleted.`,
    );
    process.exit(1);
  }
  console.log(`clean: host matches   "${expect}" ✓\n`);
}

const prisma = new PrismaClient();
// `not`, lowercase — NOT is the top-level where operator; a scalar field
// filter takes `not`. The uppercase form is a Prisma validation error.
const notDemo = { not: { contains: MARK } };

async function main() {
  const company = await prisma.company.findFirst({ orderBy: { createdAt: "asc" } });
  if (!company) {
    console.error("clean: no company found.");
    process.exit(1);
  }

  // Some scratch rows cannot be told apart from seeded ones by name —
  // safety incidents carry an employee name, not a tag. Rather than guess,
  // this refuses to run while a demo dataset is present, which makes the
  // order explicit: undo the seed, clean the scratch, seed again.
  const demoJobs = await prisma.job.count({
    where: { companyId: company.id, name: { contains: MARK } },
  });
  if (demoJobs > 0) {
    console.error(
      `clean: REFUSING — ${demoJobs} ${MARK} job(s) are present.\n` +
        "clean: some scratch rows (safety incidents) carry no tag, so cleaning\n" +
        "clean: now could remove seeded ones too. Run this first:\n" +
        "clean:   node scripts/seed-demo.mjs --undo\n" +
        "clean: then clean, then seed again.",
    );
    process.exit(1);
  }

  const jobs = await prisma.job.findMany({
    where: { companyId: company.id, name: notDemo },
    select: { id: true, name: true, status: true },
  });
  const contacts = await prisma.contact.findMany({
    where: { companyId: company.id, name: notDemo },
    select: { id: true, name: true, email: true },
  });
  const vendors = await prisma.vendor.findMany({
    where: { companyId: company.id, name: notDemo },
    select: { id: true, name: true },
  });
  const equipment = await prisma.equipment.findMany({
    where: { companyId: company.id, name: notDemo },
    select: { id: true, name: true },
  });
  const catalog = await prisma.lineItemCatalogEntry.findMany({
    where: { companyId: company.id, description: notDemo },
    select: { id: true, description: true },
  });

  const jobIds = jobs.map((j) => j.id);
  const vendorIds = vendors.map((v) => v.id);

  // Contacts with a job attached are NOT removable: the job references
  // them, and a contact belonging to real work is not scratch data even if
  // its name is short.
  const contactJobCounts = await Promise.all(
    contacts.map(async (c) => ({
      ...c,
      jobs: await prisma.job.count({ where: { contactId: c.id } }),
    })),
  );
  console.log("WOULD REMOVE:");
  jobs.forEach((j) => console.log(`  job          "${j.name}" (${j.status})`));
  vendors.forEach((v) => console.log(`  vendor       "${v.name}"`));
  equipment.forEach((e) => console.log(`  equipment    "${e.name}"`));
  catalog.forEach((c) => console.log(`  catalog      "${c.description}"`));
  contactJobCounts.forEach((c) =>
    console.log(
      `  contact      "${c.name}" <${c.email ?? "no email"}> — ${c.jobs} job(s) attached`,
    ),
  );

  const quotes = await prisma.vendorPriceQuote.count({
    where: { companyId: company.id, vendorId: { in: vendorIds } },
  });
  // Both hang off Contact and both are newer than this script. Counted and
  // printed rather than deleted quietly: this script's whole contract is
  // that nothing goes without appearing in the list first.
  const contactIds = contacts.map((c) => c.id);
  const bids = await prisma.bidInvitation.count({ where: { contactId: { in: contactIds } } });
  const interactions = await prisma.contactInteraction.count({
    where: { contactId: { in: contactIds } },
  });
  const rfis = await prisma.rfi.count({ where: { jobId: { in: jobIds } } });
  const incidents = await prisma.safetyIncident.count({ where: { companyId: company.id } });
  console.log(`  vendorPriceQuote  ${quotes} (belonging to the vendors above)`);
  console.log(`  rfi               ${rfis} (on the jobs above)`);
  console.log(`  safetyIncident    ${incidents} (all — none are demo-tagged)`);
  console.log(`  bidInvitation     ${bids} (on the contacts above)`);
  console.log(`  contactInteraction ${interactions} (on the contacts above)`);

  if (!DELETE) {
    console.log("\nclean: nothing removed. Re-run with --delete once the list above looks right.");
    return;
  }

  const failed = [];
  const del = async (label, fn) => {
    try {
      const r = await fn();
      console.log(`  removed ${label}: ${r.count}`);
    } catch (e) {
      const msg = e.message.split("\n")[0];
      if (/reading 'deleteMany'/.test(msg)) return;
      console.error(`  FAILED ${label}: ${(msg || e.message.split("\n").filter((l) => l.trim()).slice(-1)[0] || "no message").slice(0, 120)}`);
      failed.push(label);
    }
  };

  console.log("\nDELETING (children first):");
  // Children before parents, or a foreign key blocks the delete and a
  // swallowed failure leaves half the data behind — the exact bug the seed
  // undo shipped with.
  if (jobIds.length) {
    const lineItems = await prisma.jobLineItem.findMany({
      where: { jobId: { in: jobIds } },
      select: { id: true },
    });
    const lineIds = lineItems.map((l) => l.id);
    await del("costEntry", () => prisma.costEntry.deleteMany({ where: { lineItemId: { in: lineIds } } }));
    await del("equipmentAssignment", () => prisma.equipmentAssignment.deleteMany({ where: { jobId: { in: jobIds } } }));
    await del("timeEntry", () => prisma.timeEntry.deleteMany({ where: { jobId: { in: jobIds } } }));
    await del("dailyFieldReport", () => prisma.dailyFieldReport.deleteMany({ where: { jobId: { in: jobIds } } }));
    await del("punchListItem", () => prisma.punchListItem.deleteMany({ where: { jobId: { in: jobIds } } }));
    await del("rfi", () => prisma.rfi.deleteMany({ where: { jobId: { in: jobIds } } }));
    await del("rfiCounter", () => prisma.rfiCounter.deleteMany({ where: { jobId: { in: jobIds } } }));
    await del("submittalRevision", () => prisma.submittalRevision.deleteMany({ where: { submittal: { jobId: { in: jobIds } } } }));
    await del("submittal", () => prisma.submittal.deleteMany({ where: { jobId: { in: jobIds } } }));
    await del("submittalCounter", () => prisma.submittalCounter.deleteMany({ where: { jobId: { in: jobIds } } }));
    await del("materialOrderDelivery", () => prisma.materialOrderDelivery.deleteMany({ where: { order: { jobId: { in: jobIds } } } }));
    await del("materialOrder", () => prisma.materialOrder.deleteMany({ where: { jobId: { in: jobIds } } }));
    await del("materialOrderCounter", () => prisma.materialOrderCounter.deleteMany({ where: { jobId: { in: jobIds } } }));
    await del("drawingRevision", () => prisma.drawingRevision.deleteMany({ where: { set: { jobId: { in: jobIds } } } }));
    await del("drawingSet", () => prisma.drawingSet.deleteMany({ where: { jobId: { in: jobIds } } }));
    await del("closeoutItem", () => prisma.closeoutItem.deleteMany({ where: { jobId: { in: jobIds } } }));
    await del("warrantyServiceRequest", () => prisma.warrantyServiceRequest.deleteMany({ where: { jobId: { in: jobIds } } }));
    await del("warrantyPeriod", () => prisma.warrantyPeriod.deleteMany({ where: { jobId: { in: jobIds } } }));
    await del("toolboxTalk", () => prisma.toolboxTalk.deleteMany({ where: { jobId: { in: jobIds } } }));
    await del("changeOrderProposal", () => prisma.changeOrderProposal.deleteMany({ where: { changeOrder: { jobId: { in: jobIds } } } }));
    await del("changeOrder", () => prisma.changeOrder.deleteMany({ where: { jobId: { in: jobIds } } }));
    await del("payment", () => prisma.payment.deleteMany({ where: { invoice: { jobId: { in: jobIds } } } }));
    await del("invoiceLineItem", () => prisma.invoiceLineItem.deleteMany({ where: { invoice: { jobId: { in: jobIds } } } }));
    await del("invoice", () => prisma.invoice.deleteMany({ where: { jobId: { in: jobIds } } }));
    await del("complianceDocument", () => prisma.complianceDocument.deleteMany({ where: { jobId: { in: jobIds } } }));
    await del("jobAssignment", () => prisma.jobAssignment.deleteMany({ where: { jobId: { in: jobIds } } }));
    await del("jobLineItem", () => prisma.jobLineItem.deleteMany({ where: { jobId: { in: jobIds } } }));
  }
  await del("safetyIncident", () => prisma.safetyIncident.deleteMany({ where: { companyId: company.id } }));
  await del("safetyCaseCounter", () => prisma.safetyCaseCounter.deleteMany({ where: { companyId: company.id } }));
  await del("vendorPriceQuote", () => prisma.vendorPriceQuote.deleteMany({ where: { vendorId: { in: vendorIds } } }));
  // Catalog entries BEFORE jobs: JobLineItem.sourceCatalogEntryId points at
  // them, so a job whose lines came from the catalog cannot go first. Found
  // by the delete failing, which is the whole reason it reports loudly.
  await del("lineItemCatalogEntry", () =>
    prisma.lineItemCatalogEntry.deleteMany({ where: { id: { in: catalog.map((c) => c.id) } } }),
  );
  await del("job", () => prisma.job.deleteMany({ where: { id: { in: jobIds } } }));
  await del("vendor", () => prisma.vendor.deleteMany({ where: { id: { in: vendorIds } } }));
  await del("equipment", () => prisma.equipment.deleteMany({ where: { id: { in: equipment.map((e) => e.id) } } }));
  // Contact children, before the contact itself. Neither model existed when
  // this script was written; without these the FK blocks contact.deleteMany
  // and the run ends with "FAILED contact" and the scratch data still there.
  await del("bidInvitation", () =>
    prisma.bidInvitation.deleteMany({ where: { contactId: { in: contactIds } } }),
  );
  await del("contactInteraction", () =>
    prisma.contactInteraction.deleteMany({ where: { contactId: { in: contactIds } } }),
  );
  await del("contact", () => prisma.contact.deleteMany({ where: { id: { in: contactIds } } }));

  if (failed.length) {
    console.error(`\nclean: ${failed.length} delete(s) FAILED: ${failed.join(", ")}. Rows remain.`);
    process.exitCode = 1;
  } else {
    console.log("\nclean: done.");
  }
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error("\nclean: FAILED —", e.message);
    await prisma.$disconnect();
    process.exit(1);
  });
