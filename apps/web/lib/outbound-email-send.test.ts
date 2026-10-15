import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { sendEmail } from "@prova/integrations";

/**
 * WHAT ACTUALLY GOES TO THE EMAIL PROVIDER.
 *
 * ── THIS MODULE HAD NO TEST AT ALL, AND THE SHAPE OF THAT IS THE POINT ──
 *
 * Not a thin set — none. `find packages/integrations -name "*test*"` was empty.
 * Every suite that touches sending mocks `@prova/integrations` away
 * (`lib/actions/messages.test.ts:63`), which proves the CALLERS and says
 * nothing about the request that leaves this process. So the provider call,
 * the refused-HTTP branch, the accepted-but-no-id branch and now the
 * attachment encoding were all reachable only in production.
 *
 * That is the "written, documented, and never called" shape pointed at a test
 * suite: green by absence. `sendEmail` takes a `fetcher` now — the same seam
 * its twin `apps/lien-waiver/lib/email.ts:79` already had and is tested
 * through, so the shape is this repo's own.
 *
 * ── IT LIVES IN `apps/web` DELIBERATELY ──
 *
 * `packages/integrations` has no `test` script, so a test file beside the
 * module would be collected by NOTHING — exactly what
 * `lib/testRunnerCensus.test.ts` fails the build over, and the 161-orphaned-
 * dbtest shape it was written for. `lib/db-target.test.ts` already tests a
 * `packages/db` script from here for the same reason.
 *
 * ── NOTHING HERE REACHES THE NETWORK ──
 *
 * Every case passes its own `fetcher`. A test that posted to Resend would
 * send real mail, which is the one thing a test of a mailer must never do.
 */

const KEY = "RESEND_API_KEY";
const FROM = "OUTBOUND_EMAIL_FROM";
const before: Record<string, string | undefined> = {};

beforeEach(() => {
  before[KEY] = process.env[KEY];
  before[FROM] = process.env[FROM];
  process.env[KEY] = "re_test_key";
  process.env[FROM] = "office@cyrusdrywall.com";
});

afterEach(() => {
  for (const name of [KEY, FROM]) {
    if (before[name] === undefined) delete process.env[name];
    else process.env[name] = before[name];
  }
});

/** A fetcher that records what it was given and answers however the case
 *  needs. Returns the calls so the BODY can be asserted — the request is the
 *  thing under test, not the result. */
function recorder(answer: { status?: number; body?: unknown }) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetcher = (async (url: unknown, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return new Response(JSON.stringify(answer.body ?? { id: "msg_1" }), {
      status: answer.status ?? 200,
      headers: { "content-type": "application/json" },
    });
  }) as unknown as typeof fetch;
  const sent = () => JSON.parse(String(calls[0]!.init.body)) as Record<string, unknown>;
  return { calls, fetcher, sent };
}

const message = { to: "pm@turner.com", subject: "Bid", text: "Our bid is attached." };

describe("the request that reaches the provider", () => {
  it("posts to Resend with the configured sender and the key", async () => {
    const r = recorder({});
    const result = await sendEmail(message, r.fetcher);

    expect(result).toEqual({ ok: true, providerMessageId: "msg_1", from: "office@cyrusdrywall.com" });
    expect(r.calls).toHaveLength(1);
    expect(r.calls[0]!.url).toBe("https://api.resend.com/emails");
    expect((r.calls[0]!.init.headers as Record<string, string>).Authorization).toBe("Bearer re_test_key");
    expect(r.sent()).toMatchObject({
      from: "office@cyrusdrywall.com",
      to: ["pm@turner.com"],
      subject: "Bid",
      text: "Our bid is attached.",
    });
  });

  it("SENDS NO `attachments` KEY WHEN THERE ARE NONE", async () => {
    // Every RFI, digest and reply this app has ever sent goes through here.
    // An `attachments: []` on all of them would be a change to every message
    // for the sake of a feature they do not use, so absent means absent.
    const r = recorder({});
    await sendEmail(message, r.fetcher);
    expect("attachments" in r.sent()).toBe(false);

    const empty = recorder({});
    await sendEmail({ ...message, attachments: [] }, empty.fetcher);
    expect("attachments" in empty.sent()).toBe(false);
  });

  it("base64-encodes a file and keeps its name", async () => {
    const r = recorder({});
    await sendEmail(
      {
        ...message,
        attachments: [{ filename: "bid-package.pdf", content: Buffer.from("%PDF-1.7 hello") }],
      },
      r.fetcher,
    );

    expect(r.sent().attachments).toEqual([
      { filename: "bid-package.pdf", content: Buffer.from("%PDF-1.7 hello").toString("base64") },
    ]);
    // Decodes back to the same bytes — the assertion above would pass on a
    // wrong-but-consistent encoding, and a GC opening a corrupt PDF is the
    // failure this guards.
    const sentBack = (r.sent().attachments as { content: string }[])[0]!.content;
    expect(Buffer.from(sentBack, "base64").toString()).toBe("%PDF-1.7 hello");
  });

  it("carries several files in the order given", async () => {
    const r = recorder({});
    await sendEmail(
      {
        ...message,
        attachments: [
          { filename: "a.pdf", content: Buffer.from("A") },
          { filename: "b.pdf", content: Buffer.from("B") },
        ],
      },
      r.fetcher,
    );
    expect((r.sent().attachments as { filename: string }[]).map((a) => a.filename)).toEqual([
      "a.pdf",
      "b.pdf",
    ]);
  });

  it("puts a display name on the address without changing it", async () => {
    const r = recorder({});
    await sendEmail({ ...message, toName: "Dana at Turner" }, r.fetcher);
    expect(r.sent().to).toEqual(["Dana at Turner <pm@turner.com>"]);
  });
});

describe("the ways it refuses, which are the ways the log learns anything", () => {
  it("refuses before the network when sending is not set up", async () => {
    delete process.env[KEY];
    const r = recorder({});
    const result = await sendEmail(message, r.fetcher);

    expect(result).toMatchObject({ ok: false, configured: false });
    // NOTHING WAS SENT. The point of `configured: false` is that the caller
    // reports a setup state rather than a failure, and a request that went out
    // anyway would make that a lie.
    expect(r.calls).toHaveLength(0);
  });

  it("refuses an address that is not one, before the network", async () => {
    const r = recorder({});
    const result = await sendEmail({ ...message, to: "not an address" }, r.fetcher);
    expect(result).toMatchObject({ ok: false, configured: true });
    expect(r.calls).toHaveLength(0);
  });

  it("reports the provider's own words when it refuses", async () => {
    const r = recorder({ status: 422, body: { message: "The domain is not verified." } });
    expect(await sendEmail(message, r.fetcher)).toEqual({
      ok: false,
      error: "The domain is not verified.",
      configured: true,
    });
  });

  it("falls back to the status when the refusal carries no message", async () => {
    const r = recorder({ status: 500, body: {} });
    expect(await sendEmail(message, r.fetcher)).toMatchObject({ error: "Email provider refused it (HTTP 500)" });
  });

  it("SAYS IT MAY HAVE SENT when accepted with no id", async () => {
    // The branch that stops a GC getting two copies: the provider took it, so
    // the mail has almost certainly gone, and reporting a plain failure is how
    // somebody resends.
    const r = recorder({ status: 200, body: {} });
    expect(await sendEmail(message, r.fetcher)).toMatchObject({ ok: false, mayHaveSent: true });
  });

  it("never throws when the network does", async () => {
    const thrower = (async () => {
      throw new Error("ECONNREFUSED");
    }) as unknown as typeof fetch;
    const result = await sendEmail(message, thrower);
    // A throw here would be redacted in production and the log would say
    // nothing — the module header's own rule.
    expect(result).toMatchObject({ ok: false, configured: true });
    expect("error" in result && result.error).toContain("ECONNREFUSED");
  });

  it("survives a body that is not JSON", async () => {
    const plain = (async () =>
      new Response("gateway timeout", { status: 504 })) as unknown as typeof fetch;
    expect(await sendEmail(message, plain)).toMatchObject({ ok: false, configured: true });
  });
});
