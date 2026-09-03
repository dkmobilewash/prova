import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@prova/db";

/**
 * The digest when the company has no sending domain yet.
 *
 * Its own file because `readEmailConfig` is mocked at module scope and
 * this needs it to return null, which is the opposite of what
 * notification-dispatch.dbtest.ts needs.
 *
 * This is not an edge case. It is the state EVERY company is in before
 * somebody sets up their sending domain, so it is the likeliest first
 * click this feature ever gets — and it used to burn every milestone
 * permanently on that click. The send failed, the ledger recorded the
 * notices as delivered, and the licence warnings could never be sent
 * again, including after email was configured. Nothing failed loudly.
 */

const context = { company: { id: "" }, id: "", role: "OWNER" as string };
vi.mock("@/lib/auth", () => ({ requireCompanyContext: async () => context }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

// Email is NOT configured — the state a company is in before they set up
// their sending domain, which is every company on day one.
const sendEmail = vi.fn(async () => ({
  ok: false as const,
  error:
    "Email sending isn't set up yet. It needs an API key and a verified sending address on your own domain.",
  configured: false,
}));
vi.mock("@prova/integrations", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@prova/integrations")>()),
  sendEmail: () => sendEmail(),
  readEmailConfig: () => null,
}));

const { dispatchAlertDigest } = await import("./notification-dispatch");
const utc = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
let recipient = {
  id: "",
  companyId: "",
  email: "",
  name: null as string | null,
  role: "OWNER",
  jobFunction: null as string | null,
};

describe("email not configured", () => {
  beforeAll(async () => {
    const company = await prisma.company.create({
      data: { name: "Unconfigured Co" },
    });
    const user = await prisma.user.create({
      data: {
        companyId: company.id,
        clerkId: `un_${Date.now()}`,
        email: "x@example.test",
        role: "OWNER",
      },
    });
    await prisma.companyLicense.create({
      data: {
        companyId: company.id,
        jurisdictionType: "STATE",
        jurisdictionName: "California",
        licenseNumber: "C-9 999",
        expirationDate: utc("2026-09-06"),
      },
    });
    context.company.id = company.id;
    context.id = user.id;
    recipient = {
      id: user.id,
      companyId: company.id,
      email: user.email,
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
    await prisma.companyLicense.deleteMany({ where });
    await prisma.user.deleteMany({ where });
    await prisma.company.delete({ where: { id: context.company.id } });
    await prisma.$disconnect();
  });

  it("consumes no milestone, because nothing was attempted", async () => {
    const outcome = await dispatchAlertDigest(
      recipient,
      "2026-09-02",
      "https://x.test",
    );

    expect(outcome.ok).toBe(false);
    expect(
      await prisma.notificationDispatch.count({
        where: { userId: recipient.id },
      }),
    ).toBe(0);
  });

  it("never reaches the provider at all", async () => {
    sendEmail.mockClear();
    await dispatchAlertDigest(recipient, "2026-09-02", "https://x.test");
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("writes nothing to the delivery log", async () => {
    // A message row for mail that was never composed for a provider would
    // be a record of something that did not happen. The composer keeps its
    // row because a PERSON typed that message and it must not be lost; a
    // digest regenerates itself exactly from the alerts.
    expect(
      await prisma.outboundMessage.count({
        where: { companyId: recipient.companyId },
      }),
    ).toBe(0);
  });

  it("says what to do about it", async () => {
    const outcome = await dispatchAlertDigest(
      recipient,
      "2026-09-02",
      "https://x.test",
    );
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.error).toMatch(/set up/i);
  });
});
