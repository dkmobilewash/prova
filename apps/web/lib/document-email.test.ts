import { sendEmail, senderAddress } from "@prova/integrations/src/email";
import { describe, expect, it, vi } from "vitest";
import { packageLinkLine, payApplicationEmail, purchaseOrderEmail, sendRow, sentOnFromForm, submittalPackageEmail } from "./document-email";

const event = (type: string, detail: string | null = null, at = "2026-10-31T12:00:00.000Z") => ({ id: type, type, occurredAt: at, detail });

describe("the sender", () => {
  it("puts the sub's name on our verified address, however the address is written", () => {
    expect(senderAddress("docs@cstream.ai", "Acme Drywall")).toBe('"Acme Drywall" <docs@cstream.ai>');
    expect(senderAddress("C Stream <docs@cstream.ai>", "Acme Drywall")).toBe('"Acme Drywall" <docs@cstream.ai>');
  });

  it("cannot be broken out of by a company name", () => {
    const made = senderAddress("docs@cstream.ai", 'Evil" <x@y.z>\r\nBcc: a@b.c');
    expect(made).not.toMatch(/[\r\n]/);
    expect(made.match(/</g)).toHaveLength(1);
    expect(made.endsWith("<docs@cstream.ai>")).toBe(true);
  });

  it("keeps the configured sender with no name", () => {
    expect(senderAddress("C Stream <docs@cstream.ai>", undefined)).toBe("C Stream <docs@cstream.ai>");
    expect(senderAddress("docs@cstream.ai", '""')).toBe("docs@cstream.ai");
  });
});

describe("the drafts", () => {
  const po = purchaseOrderEmail({ company: "Acme", jobName: "Tower", number: 4, total: "$7,500.00", fileName: "po.pdf", vendorName: "Foundation", vendorEmail: "f@x.test" });
  const pay = payApplicationEmail({ company: "Acme", jobName: "Tower", number: 2, periodTo: "Oct 31, 2026", paymentDue: "$19,800.00", fileName: "g702.pdf", contactName: "GC", contactEmail: null });

  it("address the vendor or GC, name the file and carry the figure", () => {
    expect(po).toMatchObject({ toAddress: "f@x.test", toName: "Foundation" });
    expect(po.body).toContain("po.pdf");
    expect(pay.body).toContain("$19,800.00");
    expect(pay.toAddress).toBe("");
  });

  it("promise nothing and write no terms", () => {
    expect(`${po.body} ${pay.body}`).not.toMatch(/guarantee|warrant|certif|agree|terms|waive/i);
  });
});

describe("the sent date", () => {
  it("takes a real calendar day at UTC midnight, and nothing else", () => {
    expect(sentOnFromForm("2026-10-31")?.toISOString()).toBe("2026-10-31T00:00:00.000Z");
    for (const bad of ["", null, "2026-02-31", "10/31/2026", "soon"]) expect(sentOnFromForm(bad)).toBeNull();
  });
});

describe("what a send shows", () => {
  const row = (events: ReturnType<typeof event>[]) => sendRow({ id: "s", sentOn: "Oct 31, 2026", toAddress: "a@b.c", events });

  it("says Delivered only on the provider's word", () => {
    expect(row([event("QUEUED"), event("DELIVERED", null, "2026-10-31T13:00:00.000Z")])).toMatchObject({ status: "Delivered", needsAction: false });
    expect(row([event("QUEUED")])).toMatchObject({ status: "Handed over, not confirmed", needsAction: false });
  });

  it("shows a bounce with its reason, and a failure that never left", () => {
    expect(row([event("DELIVERED"), event("BOUNCED", "Mailbox full", "2026-10-31T13:00:00.000Z")])).toMatchObject({ status: "Bounced", needsAction: true, detail: "Mailbox full" });
    expect(row([event("FAILED", "No API key")])).toMatchObject({ status: "Never sent", needsAction: true, detail: "No API key" });
  });
});

describe("what reaches the provider", () => {
  it("carries the sender name and Reply-To, and neither on other mail", async () => {
    vi.stubEnv("RESEND_API_KEY", "k");
    vi.stubEnv("OUTBOUND_EMAIL_FROM", "docs@cstream.ai");
    const bodies: Record<string, unknown>[] = [];
    const fetcher = (async (_url: string, init: RequestInit) => {
      bodies.push(JSON.parse(String(init.body)));
      return new Response(JSON.stringify({ id: "m1" }), { status: 200 });
    }) as typeof fetch;
    await sendEmail({ to: "a@b.co", subject: "s", text: "t", fromName: "Acme", replyTo: "pm@acme.test" }, fetcher);
    await sendEmail({ to: "a@b.co", subject: "s", text: "t" }, fetcher);
    expect(bodies[0]).toMatchObject({ from: '"Acme" <docs@cstream.ai>', reply_to: "pm@acme.test" });
    expect(bodies[1].from).toBe("docs@cstream.ai");
    expect("reply_to" in bodies[1]).toBe(false);
    vi.unstubAllEnvs();
  });
});

describe("a package too big to attach", () => {
  it("says so, gives the link and its end date", () => {
    const line = packageLinkLine("https://app.test/x", new Date("2026-11-30T00:00:00Z"));
    expect(line).toContain("too large to attach");
    expect(line).toContain("until 2026-11-30");
    expect(line).toContain("https://app.test/x");
  });

  it("drafts to the GC and promises nothing", () => {
    const draft = submittalPackageEmail({ company: "Acme", jobName: "Tower", submittalNumber: 3, revisionNumber: 2, title: "Board", contactName: "GC", contactEmail: "pm@gc.test" });
    expect(draft).toMatchObject({ toAddress: "pm@gc.test", toName: "GC" });
    expect(draft.subject).toContain("Submittal 3 rev 2");
    expect(draft.body).not.toMatch(/guarantee|warrant|certif|agree|comply|complies/i);
  });
});
