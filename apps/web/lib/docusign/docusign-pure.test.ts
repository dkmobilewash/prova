import { describe, expect, it } from "vitest";
import {
  DOCUSIGN_OAUTH_HOSTS,
  DocuSignAuthError,
  docuSignAuthorizeUrl,
  downloadDocuSignDocument,
  exchangeDocuSignCode,
  fetchDocuSignAccount,
  readDocuSignConfig,
  refreshDocuSignTokens,
  type DocuSignConfig,
} from "@prova/integrations";
import { docuSignCallbackMessage, docuSignCardState, docuSignSetup, DOCUSIGN_REQUIRED_ENV } from "./setup";
import { docuSignSignature, verifyDocuSignSignature } from "./hmac";
import { calendarDayInZone, mapDocuSignStatus, planEnvelopeUpdate, type EnvelopeRowState } from "./envelope-status";
import { buildEnvelopeDefinition, readSigners, DOCUSIGN_TRACKED_EVENTS } from "./envelope-request";
import { changeOrderHtml, contractSummaryHtml, escapeHtml, SIGN_HERE_ANCHOR } from "./documents";
import { docuSignConnectUrl } from "./constants";

/**
 * The parts of the DocuSign integration that need no database: the OAuth
 * client against a fake token endpoint, the envelope request, the HMAC
 * check, the forward-only status rule, the documents, and the "is this set
 * up" card. The integration test (docusign.test.ts) covers the rest.
 */

const env = {
  DOCUSIGN_CLIENT_ID: "ik-123",
  DOCUSIGN_CLIENT_SECRET: "secret-456",
  DOCUSIGN_REDIRECT_URI: "https://app.cstream.ai/api/docusign/callback",
  DOCUSIGN_ENV: "demo",
  INTEGRATION_TOKEN_KEY: "k",
};

describe("config and the Not set up card", () => {
  it("reads a complete demo config and picks the demo OAuth host", () => {
    const config = readDocuSignConfig(env);
    expect(config?.oauthHost).toBe("account-d.docusign.com");
    expect(readDocuSignConfig({ ...env, DOCUSIGN_ENV: "production" })?.oauthHost).toBe("account.docusign.com");
    expect(DOCUSIGN_OAUTH_HOSTS).toEqual({ demo: "account-d.docusign.com", production: "account.docusign.com" });
  });

  it("is null — never a guess — when any variable is missing or DOCUSIGN_ENV is not exactly demo|production", () => {
    for (const name of ["DOCUSIGN_CLIENT_ID", "DOCUSIGN_CLIENT_SECRET", "DOCUSIGN_REDIRECT_URI", "DOCUSIGN_ENV"]) {
      expect(readDocuSignConfig({ ...env, [name]: "" }), name).toBeNull();
    }
    expect(readDocuSignConfig({ ...env, DOCUSIGN_ENV: "prod" })).toBeNull();
    expect(readDocuSignConfig({ ...env, DOCUSIGN_ENV: "Demo" })).toBeNull();
  });

  it("the card says Not set up when anything required is absent, and names what", () => {
    expect(docuSignSetup(env)).toEqual({ configured: true, missing: [], webhooks: false });
    for (const name of DOCUSIGN_REQUIRED_ENV) {
      const setup = docuSignSetup({ ...env, [name]: "  " });
      expect(setup.configured, name).toBe(false);
      expect(setup.missing).toContain(name);
      expect(docuSignCardState(setup.configured, "CONNECTED")).toBe("not-set-up");
    }
    expect(docuSignSetup({ ...env, DOCUSIGN_ENV: "staging" }).configured).toBe(false);
  });

  it("webhooks are optional: the HMAC key only switches automatic updates on", () => {
    expect(docuSignSetup({ ...env, DOCUSIGN_CONNECT_HMAC_KEY: "x" })).toMatchObject({ configured: true, webhooks: true });
  });

  it("card states follow the connection row", () => {
    expect(docuSignCardState(true, undefined)).toBe("connect");
    expect(docuSignCardState(true, "NOT_CONNECTED")).toBe("connect");
    expect(docuSignCardState(true, "CONNECTED")).toBe("connected");
    expect(docuSignCardState(true, "NEEDS_REAUTH")).toBe("reconnect");
  });

  it("callback messages come from fixed codes; an unknown code gets the generic sentence, never itself", () => {
    expect(docuSignCallbackMessage("error", "state_mismatch")?.text).toMatch(/same browser tab/);
    const unknown = docuSignCallbackMessage("error", "<script>");
    expect(unknown?.text).not.toContain("<script>");
    expect(docuSignCallbackMessage(undefined, undefined)).toBeNull();
  });
});

describe("OAuth", () => {
  const config = readDocuSignConfig(env) as DocuSignConfig;

  it("authorize URL carries state, S256 PKCE, the signature+extended scopes and the exact redirect", () => {
    const url = new URL(docuSignAuthorizeUrl(config, "st4te", "ch4llenge"));
    expect(url.origin + url.pathname).toBe("https://account-d.docusign.com/oauth/auth");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      response_type: "code",
      scope: "signature extended",
      client_id: "ik-123",
      redirect_uri: "https://app.cstream.ai/api/docusign/callback",
      state: "st4te",
      code_challenge: "ch4llenge",
      code_challenge_method: "S256",
    });
  });

  function tokenServer(answer: { status: number; body: unknown }) {
    const seen: { url: string; auth: string; form: Record<string, string> }[] = [];
    const fetchImpl = async (url: string, init?: RequestInit) => {
      seen.push({
        url,
        auth: String((init?.headers as Record<string, string>).Authorization),
        form: Object.fromEntries(new URLSearchParams(String(init?.body))),
      });
      return new Response(JSON.stringify(answer.body), { status: answer.status });
    };
    return { seen, fetchImpl };
  }

  it("code exchange sends Basic base64(key:secret), the code and the PKCE verifier", async () => {
    const server = tokenServer({ status: 200, body: { access_token: "A", refresh_token: "R", expires_in: 28800 } });
    const tokens = await exchangeDocuSignCode(config, "the-code", "the-verifier", server.fetchImpl);
    expect(tokens).toEqual({ accessToken: "A", refreshToken: "R", expiresIn: 28800 });
    expect(server.seen[0].url).toBe("https://account-d.docusign.com/oauth/token");
    expect(server.seen[0].auth).toBe(`Basic ${Buffer.from("ik-123:secret-456").toString("base64")}`);
    expect(server.seen[0].form).toEqual({ grant_type: "authorization_code", code: "the-code", code_verifier: "the-verifier" });
  });

  it("refresh sends grant_type=refresh_token and returns the NEW refresh token", async () => {
    const server = tokenServer({ status: 200, body: { access_token: "A2", refresh_token: "R2", expires_in: 3600 } });
    const tokens = await refreshDocuSignTokens(config, "R1", server.fetchImpl);
    expect(server.seen[0].form).toEqual({ grant_type: "refresh_token", refresh_token: "R1" });
    expect(tokens.refreshToken).toBe("R2");
  });

  it("a refused refresh is an invalid_grant error whose message holds no token", async () => {
    const server = tokenServer({ status: 400, body: { error: "invalid_grant", access_token: "LEAK" } });
    const error = await refreshDocuSignTokens(config, "R1", server.fetchImpl).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(DocuSignAuthError);
    expect((error as DocuSignAuthError).invalidGrant).toBe(true);
    expect((error as Error).message).not.toContain("LEAK");
    expect((error as Error).message).not.toContain("R1");
  });

  it("userinfo picks the DEFAULT account and refuses a base_uri that is not DocuSign's", async () => {
    const reply = (body: unknown) => async () => new Response(JSON.stringify(body), { status: 200 });
    const account = await fetchDocuSignAccount(
      config,
      "A",
      reply({
        accounts: [
          { account_id: "other", is_default: false, account_name: "Old", base_uri: "https://na2.docusign.net" },
          { account_id: "acct-1", is_default: true, account_name: "Smith Drywall", base_uri: "https://demo.docusign.net/" },
        ],
      }),
    );
    expect(account).toEqual({ accountId: "acct-1", accountName: "Smith Drywall", baseUri: "https://demo.docusign.net" });
    await expect(
      fetchDocuSignAccount(config, "A", reply({ accounts: [{ account_id: "x", is_default: true, base_uri: "https://evil.example.com" }] })),
    ).rejects.toThrow(/does not recognise/);
  });

  it("a download that is not a PDF is refused rather than stored as the signed contract", async () => {
    const target = { accessToken: "A", baseUri: "https://demo.docusign.net", accountId: "acct-1" };
    const html = async () => new Response("<html>error</html>", { status: 200 });
    await expect(downloadDocuSignDocument(target, "env-1", "combined", html)).rejects.toThrow(/not a PDF/);
  });
});

describe("the envelope request", () => {
  const pdfBytes = Buffer.from("%PDF-1.7 the GC's subcontract");

  it("an uploaded contract goes as the app's own bytes, to the signers entered, free-form (no tabs)", () => {
    const body = buildEnvelopeDefinition({
      emailSubject: "Please sign: Job — sub.pdf",
      document: { base64: pdfBytes.toString("base64"), name: "sub.pdf", fileExtension: "pdf", anchored: false },
      signers: [
        { name: "Pat GC", email: "pat@gc.example" },
        { name: "Sam Owner", email: "sam@sub.example" },
      ],
      connectUrl: null,
    });
    expect(body).toEqual({
      emailSubject: "Please sign: Job — sub.pdf",
      documents: [{ documentBase64: pdfBytes.toString("base64"), documentId: "1", name: "sub.pdf", fileExtension: "pdf" }],
      recipients: {
        signers: [
          { email: "pat@gc.example", name: "Pat GC", recipientId: "1", routingOrder: "1" },
          { email: "sam@sub.example", name: "Sam Owner", recipientId: "2", routingOrder: "2" },
        ],
      },
      status: "sent",
    });
  });

  it("a generated document puts signer 1's Sign Here on the anchor the document prints", () => {
    const body = buildEnvelopeDefinition({
      emailSubject: "s",
      document: { base64: "", name: "c", fileExtension: "html", anchored: true },
      signers: [{ name: "Pat", email: "pat@gc.example" }],
      connectUrl: null,
    }) as { recipients: { signers: { tabs?: { signHereTabs: { anchorString: string }[] } }[] } };
    expect(body.recipients.signers[0].tabs?.signHereTabs[0].anchorString).toBe(SIGN_HERE_ANCHOR);
  });

  it("asks for Connect events, HMAC-signed and integrator-managed, only when there is a URL to send them to", () => {
    const withHook = buildEnvelopeDefinition({
      emailSubject: "s",
      document: { base64: "", name: "c", fileExtension: "pdf", anchored: false },
      signers: [{ name: "Pat", email: "pat@gc.example" }],
      connectUrl: "https://app.cstream.ai/api/docusign/connect",
    });
    expect(withHook.eventNotification).toEqual({
      url: "https://app.cstream.ai/api/docusign/connect",
      requireAcknowledgment: "true",
      loggingEnabled: "true",
      includeHMAC: "true",
      integratorManaged: "true",
      deliveryMode: "SIM",
      events: [...DOCUSIGN_TRACKED_EVENTS],
      eventData: { version: "restv2.1", format: "json" },
    });
  });

  it("the Connect URL comes from the configured redirect URI's origin, https only", () => {
    expect(docuSignConnectUrl("https://app.cstream.ai/api/docusign/callback")).toBe("https://app.cstream.ai/api/docusign/connect");
    expect(docuSignConnectUrl("http://localhost:3000/api/docusign/callback")).toBeNull();
  });

  it("signer fields are validated before DocuSign sees them", () => {
    const form = (pairs: [string, string][]) => {
      const f = new FormData();
      for (const [name, email] of pairs) {
        f.append("signerName", name);
        f.append("signerEmail", email);
      }
      return f;
    };
    expect(readSigners(form([["Pat", "pat@gc.example"]]))).toEqual({ ok: true, value: [{ name: "Pat", email: "pat@gc.example" }] });
    expect(readSigners(form([["Pat", "not-an-email"]]))).toMatchObject({ ok: false });
    expect(readSigners(form([["", "pat@gc.example"]]))).toMatchObject({ ok: false });
    expect(readSigners(form([]))).toMatchObject({ ok: false });
  });
});

describe("HMAC", () => {
  const body = Buffer.from('{"event":"envelope-completed","data":{"envelopeId":"e1"}}\r\n');
  const key = "hmac-key-from-docusign";
  const headers = (entries: Record<string, string>) => new Headers(entries);

  it("accepts the base64 HMAC-SHA256 of the raw body in X-DocuSign-Signature-1", () => {
    expect(verifyDocuSignSignature(body, headers({ "X-DocuSign-Signature-1": docuSignSignature(body, key) }), key)).toBe(true);
  });

  it("accepts a match in any numbered header — one match is enough", () => {
    const h = headers({ "x-docusign-signature-1": "bm9wZQ==", "x-docusign-signature-2": docuSignSignature(body, key) });
    expect(verifyDocuSignSignature(body, h, key)).toBe(true);
  });

  it("refuses a wrong signature, a changed body, no header, and a missing key", () => {
    const good = docuSignSignature(body, key);
    expect(verifyDocuSignSignature(body, headers({ "X-DocuSign-Signature-1": docuSignSignature(body, "other") }), key)).toBe(false);
    expect(verifyDocuSignSignature(Buffer.concat([body, Buffer.from(" ")]), headers({ "X-DocuSign-Signature-1": good }), key)).toBe(false);
    expect(verifyDocuSignSignature(body, headers({}), key)).toBe(false);
    expect(verifyDocuSignSignature(body, headers({ "X-DocuSign-Signature-1": good }), undefined)).toBe(false);
    expect(verifyDocuSignSignature(body, headers({ "X-DocuSign-Signature-1": good }), "  ")).toBe(false);
  });

  it("strips quote characters from the key, as DocuSign's validation guide says to", () => {
    expect(verifyDocuSignSignature(body, headers({ "X-DocuSign-Signature-1": docuSignSignature(body, key) }), `"${key}"`)).toBe(true);
  });
});

describe("status only moves forward, with DocuSign's own dates", () => {
  const row: EnvelopeRowState = {
    status: "SENT",
    sentAt: new Date("2026-09-18T15:00:00Z"),
    deliveredAt: null,
    completedAt: null,
    declinedAt: null,
    voidedAt: null,
    voidedReason: null,
  };
  const remote = (status: string, extra: Record<string, string | null> = {}) => ({
    envelopeId: "e1",
    status,
    sentDateTime: "2026-09-18T15:00:00Z",
    deliveredDateTime: null,
    completedDateTime: null,
    declinedDateTime: null,
    voidedDateTime: null,
    voidedReason: null,
    ...extra,
  });

  it("maps DocuSign's five statuses and ignores the rest", () => {
    expect(["sent", "delivered", "completed", "declined", "voided"].map(mapDocuSignStatus)).toEqual([
      "SENT",
      "DELIVERED",
      "COMPLETED",
      "DECLINED",
      "VOIDED",
    ]);
    expect(mapDocuSignStatus("created")).toBeNull();
  });

  it("completed copies DocuSign's completedDateTime", () => {
    expect(planEnvelopeUpdate(row, remote("completed", { completedDateTime: "2026-09-19T02:30:00Z" }))).toEqual({
      status: "COMPLETED",
      completedAt: new Date("2026-09-19T02:30:00Z"),
    });
  });

  it("the same answer twice changes nothing (null — no write)", () => {
    expect(planEnvelopeUpdate(row, remote("sent"))).toBeNull();
  });

  it("a late 'delivered' cannot reopen a completed envelope, and terminal never becomes another terminal", () => {
    const done: EnvelopeRowState = { ...row, status: "COMPLETED", completedAt: new Date("2026-09-19T02:30:00Z") };
    expect(planEnvelopeUpdate(done, remote("delivered", { completedDateTime: "2026-09-19T02:30:00Z" }))).toBeNull();
    expect(planEnvelopeUpdate(done, remote("voided", { completedDateTime: "2026-09-19T02:30:00Z" }))?.status).toBeUndefined();
  });

  it("the executed date is the calendar day in the SENDER's zone, not UTC", () => {
    // 7:30pm in Los Angeles on the 18th is 02:30 UTC on the 19th.
    const instant = new Date("2026-09-19T02:30:00Z");
    expect(calendarDayInZone(instant, "America/Los_Angeles").toISOString()).toBe("2026-09-18T00:00:00.000Z");
    expect(calendarDayInZone(instant, "UTC").toISOString()).toBe("2026-09-19T00:00:00.000Z");
    expect(calendarDayInZone(instant, "Not/AZone").toISOString()).toBe("2026-09-19T00:00:00.000Z");
  });
});

describe("the generated documents", () => {
  it("escape everything a person typed", () => {
    expect(escapeHtml(`<img src=x onerror="a">&'`)).toBe("&lt;img src=x onerror=&quot;a&quot;&gt;&amp;&#39;");
    const html = contractSummaryHtml({
      companyName: "Sub <Co>",
      jobName: "Tower",
      clientName: "GC",
      scope: null,
      total: 100,
      lineItems: [{ description: "<script>x</script>", quantity: "2", unit: "sf", unitPrice: "50" }],
    });
    expect(html).not.toContain("<script>x");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain(SIGN_HERE_ANCHOR);
    expect(html).toContain("$100.00");
  });

  it("a change order states its number, its changes and its value, with the anchor", () => {
    const html = changeOrderHtml({
      companyName: "Sub",
      jobName: "Tower",
      clientName: "GC",
      number: 3,
      title: "Extra soffit",
      description: null,
      submittedOn: "2026-09-10",
      valueDelta: "+$1,200.00",
      proposals: ["Add: Soffit — 40 lf @ $30.00"],
    });
    expect(html).toContain("Change order #3");
    expect(html).toContain("+$1,200.00");
    expect(html).toContain(SIGN_HERE_ANCHOR);
  });
});
