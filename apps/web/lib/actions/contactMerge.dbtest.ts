import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@prova/db";

/**
 * Merging two duplicate contacts, executed against a real Postgres.
 *
 * This file exists for one assertion above all the others: the QuickBooks
 * link repoint. `QuickBooksEntityLink.entityId` is an untyped string holding
 * the cuid of our record — no foreign key, no cascade, nothing in the
 * database that will notice if the merge forgets it. Miss it and
 * `pushInvoiceToQuickBooks` reads a link pointing at a contact that no longer
 * exists, and the invoice goes out against no customer at all. A unit test
 * with a fake Prisma proves nothing here, because the thing being checked is
 * whether a row somewhere else in a real schema still points at a dead id.
 *
 * Named `.dbtest.ts` so the fast suite does not collect it. Run against a
 * SCRATCH database — it creates and deletes companies:
 *
 *   DATABASE_URL=postgresql://... DIRECT_URL=$DATABASE_URL \
 *     pnpm --filter @prova/web exec vitest run --config vitest.db.config.ts
 *
 * Only the auth boundary and revalidatePath are faked. The action, Prisma,
 * the transaction and the schema are real.
 */

const context = { company: { id: "" }, id: "", role: "OWNER" as string };

vi.mock("@/lib/auth", () => ({
  requireCompanyContext: async () => context,
}));

const revalidated: string[] = [];
vi.mock("next/cache", () => ({
  revalidatePath: (path: string) => {
    revalidated.push(path);
  },
}));

const { mergeContacts } = await import("./contactMerge");

let companyId = "";
let otherCompanyId = "";
let seq = 0;

type ContactSeed = {
  name?: string;
  email?: string | null;
  defaultRetainagePercent?: string | null;
  paymentTermsDays?: number | null;
  standardFormsUsed?: string | null;
  portalToken?: string | null;
  companyId?: string;
};

/** A contact with one of everything hanging off it: a job, a bid invitation,
 * an interaction, a person, a QuickBooks link and a QuickBooks sync attempt.
 * The point of the whole file is that a merge takes ALL of them. */
async function seedContact(seed: ContactSeed = {}, withQuickBooksLink = false) {
  seq += 1;
  const owner = seed.companyId ?? companyId;
  const contact = await prisma.contact.create({
    data: {
      companyId: owner,
      name: seed.name ?? `Contact ${seq}`,
      email: seed.email ?? null,
      defaultRetainagePercent: seed.defaultRetainagePercent ?? null,
      paymentTermsDays: seed.paymentTermsDays ?? null,
      standardFormsUsed: seed.standardFormsUsed ?? null,
      portalToken: seed.portalToken ?? null,
    },
  });
  const job = await prisma.job.create({
    data: { companyId: owner, contactId: contact.id, name: `Job ${seq}` },
  });
  const bid = await prisma.bidInvitation.create({
    data: { companyId: owner, contactId: contact.id, projectName: `Bid ${seq}` },
  });
  const person = await prisma.contactPerson.create({
    data: { companyId: owner, contactId: contact.id, name: `Person ${seq}` },
  });
  const interaction = await prisma.contactInteraction.create({
    data: {
      companyId: owner,
      contactId: contact.id,
      contactPersonId: person.id,
      type: "CALL",
      occurredOn: new Date("2026-08-01T00:00:00.000Z"),
      summary: `Interaction ${seq}`,
    },
  });
  const attempt = await prisma.quickBooksSyncAttempt.create({
    data: {
      companyId: owner,
      entityType: "Contact",
      entityId: contact.id,
      idempotencyKey: `contact:${contact.id}`,
      outcome: "SUCCEEDED",
      summary: `Linked ${contact.name}.`,
    },
  });
  const link = withQuickBooksLink
    ? await prisma.quickBooksEntityLink.create({
        data: {
          companyId: owner,
          entityType: "Contact",
          entityId: contact.id,
          qboId: `qbo-${seq}`,
        },
      })
    : null;
  return { contact, job, bid, person, interaction, attempt, link };
}

/** Everything, anywhere, that still names this contact id. The merge is only
 * correct if this is zero for the duplicate afterwards. */
async function referencesTo(contactId: string) {
  return {
    jobs: await prisma.job.count({ where: { contactId } }),
    bidInvitations: await prisma.bidInvitation.count({ where: { contactId } }),
    interactions: await prisma.contactInteraction.count({ where: { contactId } }),
    people: await prisma.contactPerson.count({ where: { contactId } }),
    quickBooksLinks: await prisma.quickBooksEntityLink.count({
      where: { entityType: "Contact", entityId: contactId },
    }),
    quickBooksSyncAttempts: await prisma.quickBooksSyncAttempt.count({
      where: { entityType: "Contact", entityId: contactId },
    }),
  };
}

describe("mergeContacts against a real database", () => {
  beforeAll(async () => {
    const company = await prisma.company.create({ data: { name: "Merge Test Co" } });
    const user = await prisma.user.create({
      data: {
        companyId: company.id,
        clerkId: `merge_test_${Date.now()}`,
        email: `merge_owner_${Date.now()}@example.test`,
        role: "OWNER",
      },
    });
    const other = await prisma.company.create({ data: { name: "Someone Else Ltd" } });
    companyId = company.id;
    otherCompanyId = other.id;
    context.company.id = company.id;
    context.id = user.id;
  });

  afterAll(async () => {
    for (const id of [companyId, otherCompanyId]) {
      await prisma.quickBooksSyncAttempt.deleteMany({ where: { companyId: id } });
      await prisma.quickBooksEntityLink.deleteMany({ where: { companyId: id } });
      await prisma.contactInteraction.deleteMany({ where: { companyId: id } });
      await prisma.contactPerson.deleteMany({ where: { companyId: id } });
      await prisma.bidInvitation.deleteMany({ where: { companyId: id } });
      await prisma.job.deleteMany({ where: { companyId: id } });
      await prisma.contact.deleteMany({ where: { companyId: id } });
      await prisma.user.deleteMany({ where: { companyId: id } });
      await prisma.company.delete({ where: { id } });
    }
    await prisma.$disconnect();
  });

  it("moves every reference to the duplicate, including the QuickBooks link, and deletes it", async () => {
    const keep = await seedContact({ name: "Turner Construction" });
    const dupe = await seedContact({ name: "Turner Constr." }, true);
    // A second interaction on the duplicate, so a count of 1 everywhere
    // could not accidentally pass.
    await prisma.contactInteraction.create({
      data: {
        companyId,
        contactId: dupe.contact.id,
        type: "EMAIL",
        occurredOn: new Date("2026-08-05T00:00:00.000Z"),
        summary: "Second touchpoint",
      },
    });

    const result = await mergeContacts(dupe.contact.id, keep.contact.id);
    expect(result).toEqual({
      ok: true,
      value: {
        jobs: 1,
        bidInvitations: 1,
        interactions: 2,
        people: 1,
        quickBooksLinks: 1,
        quickBooksSyncAttempts: 1,
        fieldsFilled: [],
        fieldsOverwritten: [],
        portalLinkRevoked: false,
      },
    });

    // Nothing is left pointing at the duplicate, in ANY of the six places —
    // the four foreign keys and the two untyped QuickBooks references.
    expect(await referencesTo(dupe.contact.id)).toEqual({
      jobs: 0,
      bidInvitations: 0,
      interactions: 0,
      people: 0,
      quickBooksLinks: 0,
      quickBooksSyncAttempts: 0,
    });
    expect(await prisma.contact.findUnique({ where: { id: dupe.contact.id } })).toBeNull();

    // And it all landed on the survivor.
    expect(await referencesTo(keep.contact.id)).toEqual({
      jobs: 2,
      bidInvitations: 2,
      interactions: 3,
      people: 2,
      quickBooksLinks: 1,
      quickBooksSyncAttempts: 2,
    });

    // THE assertion this file was written for. The link keeps its QuickBooks
    // id — that customer is not ours to reassign — and now names the contact
    // that survived. Anything less and an invoice pushes against nobody.
    const link = await prisma.quickBooksEntityLink.findUniqueOrThrow({
      where: { id: dupe.link!.id },
    });
    expect(link.entityId).toBe(keep.contact.id);
    expect(link.qboId).toBe(dupe.link!.qboId);

    // The sync attempt is history, so it moves with the record but keeps the
    // idempotency key it was written with. Rewriting that would falsify what
    // was actually sent, and nothing looks a contact up by it.
    const attempt = await prisma.quickBooksSyncAttempt.findUniqueOrThrow({
      where: { id: dupe.attempt.id },
    });
    expect(attempt.entityId).toBe(keep.contact.id);
    expect(attempt.idempotencyKey).toBe(`contact:${dupe.contact.id}`);

    expect(revalidated).toContain("/contacts");
    expect(revalidated).toContain(`/contacts/${keep.contact.id}`);
  });

  it("leaves everything about the contact you keep alone", async () => {
    const keep = await seedContact({
      name: "Suffolk",
      email: "ap@suffolk.test",
      defaultRetainagePercent: "10",
      paymentTermsDays: 30,
      portalToken: `keep-token-${Date.now()}`,
    });
    const dupe = await seedContact({ name: "Suffolk Construction" });

    const before = await prisma.contact.findUniqueOrThrow({ where: { id: keep.contact.id } });
    expect(await mergeContacts(dupe.contact.id, keep.contact.id)).toMatchObject({ ok: true });
    const after = await prisma.contact.findUniqueOrThrow({ where: { id: keep.contact.id } });

    expect(after.name).toBe(before.name);
    expect(after.email).toBe(before.email);
    expect(Number(after.defaultRetainagePercent)).toBe(10);
    expect(after.paymentTermsDays).toBe(30);
    expect(after.portalToken).toBe(before.portalToken);
    expect(after.status).toBe(before.status);

    // The survivor's own rows are still its own rows, not replacements.
    const job = await prisma.job.findUniqueOrThrow({ where: { id: keep.job.id } });
    expect(job.contactId).toBe(keep.contact.id);
    const ownAttempt = await prisma.quickBooksSyncAttempt.findUniqueOrThrow({
      where: { id: keep.attempt.id },
    });
    expect(ownAttempt.entityId).toBe(keep.contact.id);
  });

  it("fills the survivor's blanks from the duplicate", async () => {
    // The reason merge is worth building: createJob mints a contact with
    // nulls, so the record holding the real contract terms is usually the
    // one WITHOUT the jobs on it.
    const keep = await seedContact({ name: "Clark Pacific" });
    const dupe = await seedContact({
      name: "Clark Pacific Inc",
      defaultRetainagePercent: "5",
      paymentTermsDays: 45,
      standardFormsUsed: "AIA A401",
    });

    const result = await mergeContacts(dupe.contact.id, keep.contact.id);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.fieldsFilled).toEqual([
      "Default retainage %",
      "Payment terms (days)",
      "Standard subcontract form",
    ]);

    const after = await prisma.contact.findUniqueOrThrow({ where: { id: keep.contact.id } });
    expect(Number(after.defaultRetainagePercent)).toBe(5);
    expect(after.paymentTermsDays).toBe(45);
    expect(after.standardFormsUsed).toBe("AIA A401");
  });

  it("refuses a field that is filled in differently on both, and merges once told which to keep", async () => {
    const keep = await seedContact({
      name: "Webcor",
      email: "ap@webcor.test",
      defaultRetainagePercent: "10",
    });
    const dupe = await seedContact({
      name: "Webcor Builders",
      email: "accounts@webcor.test",
      defaultRetainagePercent: "5",
    });

    const refused = await mergeContacts(dupe.contact.id, keep.contact.id);
    expect(refused.ok).toBe(false);
    if (refused.ok) return;
    expect(refused.error).toContain("Email");
    expect(refused.error).toContain("Default retainage %");
    // A refusal must not half-do the job.
    expect(await prisma.contact.count({ where: { id: dupe.contact.id } })).toBe(1);
    expect(await prisma.job.count({ where: { contactId: dupe.contact.id } })).toBe(1);

    const merged = await mergeContacts(dupe.contact.id, keep.contact.id, {
      choices: { email: "keep", defaultRetainagePercent: "duplicate" },
    });
    expect(merged.ok).toBe(true);
    if (!merged.ok) return;
    expect(merged.value.fieldsOverwritten).toEqual(["Default retainage %"]);

    const after = await prisma.contact.findUniqueOrThrow({ where: { id: keep.contact.id } });
    expect(after.email).toBe("ap@webcor.test");
    expect(Number(after.defaultRetainagePercent)).toBe(5);
  });

  it("refuses when both contacts are linked to different QuickBooks customers", async () => {
    const keep = await seedContact({ name: "Swinerton" }, true);
    const dupe = await seedContact({ name: "Swinerton Builders" }, true);

    const result = await mergeContacts(dupe.contact.id, keep.contact.id);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("QuickBooks");
    expect(result.error).toContain(keep.link!.qboId);
    expect(result.error).toContain(dupe.link!.qboId);

    // Both links still stand, each on its own contact.
    expect(
      (await prisma.quickBooksEntityLink.findUniqueOrThrow({ where: { id: dupe.link!.id } }))
        .entityId,
    ).toBe(dupe.contact.id);
    expect(await prisma.contact.count({ where: { id: dupe.contact.id } })).toBe(1);
  });

  it("kills the duplicate's portal link and never carries it to the survivor", async () => {
    const token = `dupe-token-${Date.now()}`;
    const keep = await seedContact({ name: "DPR", portalToken: `keep-dpr-${Date.now()}` });
    const dupe = await seedContact({ name: "DPR Construction", portalToken: token });

    const result = await mergeContacts(dupe.contact.id, keep.contact.id);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.portalLinkRevoked).toBe(true);

    // /portal/<token> looks the contact up BY this token. Nobody holds it now.
    expect(await prisma.contact.findUnique({ where: { portalToken: token } })).toBeNull();
    const after = await prisma.contact.findUniqueOrThrow({ where: { id: keep.contact.id } });
    expect(after.portalToken).not.toBe(token);
    expect(after.portalToken).toContain("keep-dpr-");
  });

  it("refuses a contact belonging to another company, in either position", async () => {
    const mine = await seedContact({ name: "Mine" });
    const theirs = await seedContact({ name: "Theirs", companyId: otherCompanyId });

    expect(await mergeContacts(theirs.contact.id, mine.contact.id)).toEqual({
      ok: false,
      error: "That duplicate no longer exists.",
    });
    expect(await mergeContacts(mine.contact.id, theirs.contact.id)).toEqual({
      ok: false,
      error: "That contact no longer exists.",
    });
    expect(await prisma.contact.count({ where: { id: theirs.contact.id } })).toBe(1);
    expect(await prisma.job.count({ where: { contactId: theirs.contact.id } })).toBe(1);
  });

  it("refuses merging a contact into itself", async () => {
    const only = await seedContact({ name: "Hathaway Dinwiddie" });
    expect(await mergeContacts(only.contact.id, only.contact.id)).toEqual({
      ok: false,
      error: "A contact cannot be merged into itself.",
    });
    expect(await prisma.contact.count({ where: { id: only.contact.id } })).toBe(1);
  });

  it("refuses anyone but the owner", async () => {
    const keep = await seedContact({ name: "Level 10" });
    const dupe = await seedContact({ name: "Level 10 Construction" });

    context.role = "MEMBER";
    try {
      expect(await mergeContacts(dupe.contact.id, keep.contact.id)).toEqual({
        ok: false,
        error: "Only the account owner can merge contacts",
      });
    } finally {
      context.role = "OWNER";
    }
    expect(await prisma.contact.count({ where: { id: dupe.contact.id } })).toBe(1);
  });

  it("refuses when the duplicate gained history since the screen was drawn", async () => {
    const keep = await seedContact({ name: "XL Construction" });
    const dupe = await seedContact({ name: "XL Constr" });

    // The screen was drawn showing one job; someone opened another.
    await prisma.job.create({
      data: { companyId, contactId: dupe.contact.id, name: "Opened while you were reading" },
    });

    const result = await mergeContacts(dupe.contact.id, keep.contact.id, {
      expected: { jobs: 1, bidInvitations: 1, interactions: 1, people: 1 },
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("changed since this page loaded");
    expect(await prisma.contact.count({ where: { id: dupe.contact.id } })).toBe(1);

    // Reloaded numbers go through.
    expect(
      await mergeContacts(dupe.contact.id, keep.contact.id, {
        expected: { jobs: 2, bidInvitations: 1, interactions: 1, people: 1 },
      }),
    ).toMatchObject({ ok: true });
  });
});
