import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@prova/db";

/**
 * The dispatcher against a real Postgres.
 *
 * `.dbtest.ts` — CI has no database. Run against a SCRATCH one:
 *
 *   DATABASE_URL=postgresql://... DIRECT_URL=$DATABASE_URL \
 *     pnpm --filter @prova/web exec vitest run --config vitest.db.config.ts
 *
 * `notification-milestones.test.ts` already proves the deciding half with
 * hand-built inputs, exhaustively. What it cannot prove is the part that
 * has actually broken things in this project: that the ledger's unique
 * constraint really refuses the second claim, that a digest sent to one
 * person does not silence another's, and that a send failure leaves the
 * claim standing rather than re-arming itself. Every one of those is a
 * wiring question, and every real bug here has been wiring.
 *
 * The provider is stubbed. What is real is the database.
 */

const context = { company: { id: "" }, id: "", role: "OWNER" as string };

vi.mock("@/lib/auth", () => ({ requireCompanyContext: async () => context }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

const sendEmail = vi.fn();
vi.mock("@prova/integrations", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@prova/integrations")>()),
  sendEmail: (...args: unknown[]) => sendEmail(...args),
  readEmailConfig: () => ({
    provider: "resend",
    apiKey: "test",
    from: "notifications@send.example.test",
    webhookSecret: null,
  }),
}));

const { dispatchAlertDigest } = await import("./notification-dispatch");

const TODAY = "2026-09-01";
const utc = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

let recipient = {
  id: "",
  companyId: "",
  email: "",
  name: null as string | null,
  role: "OWNER",
  jobFunction: null as string | null,
};
let colleague = { ...recipient };

function accepted(id: string) {
  return {
    ok: true as const,
    providerMessageId: id,
    from: "notifications@send.example.test",
  };
}

describe("dispatching a digest", () => {
  beforeAll(async () => {
    const company = await prisma.company.create({
      data: { name: "Digest Test Co" },
    });
    const owner = await prisma.user.create({
      data: {
        companyId: company.id,
        clerkId: `nd_${Date.now()}`,
        email: `nd_owner_${Date.now()}@example.test`,
        name: "Owner",
        role: "OWNER",
      },
    });
    const other = await prisma.user.create({
      data: {
        companyId: company.id,
        clerkId: `nd2_${Date.now()}`,
        email: `nd_other_${Date.now()}@example.test`,
        role: "OWNER",
      },
    });

    // A LICENCE rather than a COI, deliberately: its horizon is 60 days
    // in RENEWAL_HORIZON_DAYS, and that is the case the flat-ladder bug
    // dropped silently. Expiring in three days, so it has crossed every
    // rung there is.
    await prisma.companyLicense.create({
      data: {
        companyId: company.id,
        jurisdictionType: "STATE",
        jurisdictionName: "California",
        licenseNumber: "C-9 123456",
        expirationDate: utc("2026-09-04"),
      },
    });

    context.company.id = company.id;
    context.id = owner.id;
    recipient = {
      id: owner.id,
      companyId: company.id,
      email: owner.email,
      name: owner.name,
      role: "OWNER",
      jobFunction: null,
    };
    colleague = {
      id: other.id,
      companyId: company.id,
      email: other.email,
      name: null,
      role: "OWNER",
      jobFunction: null,
    };
  });

  afterAll(async () => {
    const where = { companyId: context.company.id };
    await prisma.notificationDispatch.deleteMany({ where });
    await prisma.outboundMessageEvent.deleteMany({
      where: { message: { companyId: context.company.id } },
    });
    await prisma.outboundMessage.deleteMany({ where });
    await prisma.alertAcknowledgement.deleteMany({ where });
    await prisma.companyLicense.deleteMany({ where });
    await prisma.user.deleteMany({ where });
    await prisma.company.delete({ where: { id: context.company.id } });
    await prisma.$disconnect();
  });

  it("sends one email and records what it consumed", async () => {
    sendEmail.mockResolvedValueOnce(accepted("prov_1"));

    const outcome = await dispatchAlertDigest(
      recipient,
      TODAY,
      "https://app.example.test",
    );

    expect(outcome).toMatchObject({ ok: true, sent: true });
    expect(sendEmail).toHaveBeenCalledTimes(1);

    const rows = await prisma.notificationDispatch.findMany({
      where: { userId: recipient.id },
    });
    expect(rows.length).toBeGreaterThan(0);
    // Every rung the licence passed is spent, not just the one that fired.
    expect(rows.every((row) => row.alertKey.startsWith("RENEWAL:"))).toBe(true);
  });

  it("links the notice to the message it went out as", async () => {
    const rows = await prisma.notificationDispatch.findMany({
      where: { userId: recipient.id, messageId: { not: null } },
      include: { message: true },
    });
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0].message?.toAddress).toBe(recipient.email);
    expect(rows[0].message?.relatedType).toBe("ALERT_DIGEST");
  });

  it("sends nothing the second time, against the same unchanged data", async () => {
    sendEmail.mockClear();

    const outcome = await dispatchAlertDigest(
      recipient,
      TODAY,
      "https://app.example.test",
    );

    expect(outcome).toEqual({ ok: true, sent: false, reason: "nothing-due" });
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("still tells a colleague, whose ledger is their own", async () => {
    sendEmail.mockClear();
    sendEmail.mockResolvedValueOnce(accepted("prov_2"));

    const outcome = await dispatchAlertDigest(
      colleague,
      TODAY,
      "https://app.example.test",
    );

    // The failure this guards: a company-wide ledger would have the first
    // person's send suppress the second's.
    expect(outcome).toMatchObject({ ok: true, sent: true });
    expect(sendEmail).toHaveBeenCalledTimes(1);
  });

  it("gives the milestone BACK when the provider was never reached", async () => {
    // A new fact, so there is something to send.
    const licence = await prisma.companyLicense.findFirst({
      where: { companyId: recipient.companyId },
    });
    await prisma.companyLicense.update({
      where: { id: licence!.id },
      data: { expirationDate: utc("2026-09-05") },
    });

    sendEmail.mockClear();
    // A network failure: no mayHaveSent, so nothing went out.
    sendEmail.mockResolvedValueOnce({
      ok: false,
      error: "Couldn't reach the email provider: socket hang up",
      configured: true,
    });

    const failed = await dispatchAlertDigest(
      recipient,
      TODAY,
      "https://app.example.test",
    );
    expect(failed).toMatchObject({ ok: false });

    // The whole point: a transient outage must not spend the warning. One
    // Resend blip during a nightly run would otherwise burn every
    // milestone for every user, permanently and silently.
    sendEmail.mockClear();
    sendEmail.mockResolvedValueOnce(accepted("prov_retry"));
    const retried = await dispatchAlertDigest(
      recipient,
      TODAY,
      "https://app.example.test",
    );

    expect(retried).toMatchObject({ ok: true, sent: true });
    expect(sendEmail).toHaveBeenCalledTimes(1);
  });

  it("keeps the FAILED record even after giving the milestone back", async () => {
    // Releasing the claim must not erase what happened. The log is the
    // only place anyone can see that a send failed.
    const failures = await prisma.outboundMessageEvent.findMany({
      where: { message: { companyId: recipient.companyId }, type: "FAILED" },
    });
    expect(failures.length).toBeGreaterThan(0);
  });

  it("keeps the claim when the send MAY have gone out", async () => {
    // A new fact, so there is something to send: renewing the licence
    // changes the alert key and the ladder starts over.
    const licence = await prisma.companyLicense.findFirst({
      where: { companyId: recipient.companyId },
    });
    await prisma.companyLicense.update({
      where: { id: licence!.id },
      data: { expirationDate: utc("2026-09-06") },
    });

    sendEmail.mockClear();
    sendEmail.mockResolvedValueOnce({
      ok: false,
      error: "The provider accepted this but returned no message id",
      configured: true,
      // The one failure that keeps its claim: the provider took it.
      mayHaveSent: true,
    });

    const failed = await dispatchAlertDigest(
      recipient,
      TODAY,
      "https://app.example.test",
    );
    expect(failed).toMatchObject({ ok: false });

    // It goes down as QUEUED, not FAILED: the provider accepted it, so
    // the mail has almost certainly gone.
    const queued = await prisma.outboundMessageEvent.findMany({
      where: { message: { companyId: recipient.companyId }, type: "QUEUED" },
    });
    expect(queued.length).toBeGreaterThan(0);

    // And it does NOT try again by itself. A retry on a send that may
    // have gone out is how somebody gets the same warning twice.
    sendEmail.mockClear();
    sendEmail.mockResolvedValue(accepted("prov_should_not_be_used"));
    const again = await dispatchAlertDigest(
      recipient,
      TODAY,
      "https://app.example.test",
    );
    expect(again).toEqual({ ok: true, sent: false, reason: "nothing-due" });
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("says nothing at all when the person has silenced everything", async () => {
    const alerts = await prisma.notificationDispatch.findMany({
      where: { userId: colleague.id },
    });
    expect(alerts.length).toBeGreaterThan(0);

    // Fresh fact, so there would otherwise be something to send.
    const licence = await prisma.companyLicense.findFirst({
      where: { companyId: recipient.companyId },
    });
    await prisma.companyLicense.update({
      where: { id: licence!.id },
      data: { expirationDate: utc("2026-09-08") },
    });

    await prisma.alertAcknowledgement.create({
      data: {
        companyId: colleague.companyId,
        userId: colleague.id,
        alertKey: `RENEWAL:${licence!.id}:2026-09-08`,
      },
    });

    sendEmail.mockClear();
    const outcome = await dispatchAlertDigest(
      colleague,
      TODAY,
      "https://app.example.test",
    );

    // Emailing somebody an alert they dismissed this morning is precisely
    // the nag this feature exists to avoid.
    expect(outcome).toEqual({ ok: true, sent: false, reason: "nothing-due" });
    expect(sendEmail).not.toHaveBeenCalled();
  });
});
