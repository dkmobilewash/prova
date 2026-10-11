import { describe, expect, it, vi } from "vitest";
import { countsFrom, pushLeads, selectPushable, splitName, toSmartleadLead, type PushCandidate } from "./push";

const lead = (over: Partial<PushCandidate> = {}): PushCandidate => ({
  id: "l1",
  companyName: "Baker Drywall",
  contactName: "Maria de la Cruz",
  email: "maria@bakerdrywall.com",
  phone: "(916) 555-0100",
  city: "Sacramento",
  licenceNumber: "884201",
  doNotContact: false,
  outboundStatus: "NEW",
  ...over,
});

describe("selectPushable", () => {
  it("takes a NEW, emailable, unsuppressed lead", () => {
    const { pushable, excluded } = selectPushable([lead()], { limit: 50 });
    expect(pushable).toHaveLength(1);
    expect(excluded).toEqual({ doNotContact: 0, noEmail: 0, notNew: 0, overCap: 0 });
  });

  it("excludes each reason separately, and counts it", () => {
    const { pushable, excluded } = selectPushable(
      [
        lead({ id: "dnc", doNotContact: true }),
        lead({ id: "null", email: null }),
        lead({ id: "blank", email: "   " }),
        lead({ id: "queued", outboundStatus: "QUEUED" }),
        lead({ id: "dead", outboundStatus: "DEAD" }),
      ],
      { limit: 50 },
    );
    expect(pushable).toEqual([]);
    expect(excluded).toEqual({ doNotContact: 1, noEmail: 2, notNew: 2, overCap: 0 });
  });

  it("suppression wins over every other reason", () => {
    const { excluded } = selectPushable([lead({ doNotContact: true, email: null, outboundStatus: "DEAD" })], { limit: 50 });
    expect(excluded.doNotContact).toBe(1);
    expect(excluded.noEmail + excluded.notNew).toBe(0);
  });

  it("stops at the cap, keeps input order, and counts the rest as over cap", () => {
    const { pushable, excluded } = selectPushable(
      [lead({ id: "a" }), lead({ id: "b" }), lead({ id: "c" })],
      { limit: 2 },
    );
    expect(pushable.map((l) => l.id)).toEqual(["a", "b"]);
    expect(excluded.overCap).toBe(1);
    expect(selectPushable([lead()], { limit: 0 }).excluded.overCap).toBe(1);
  });
});

describe("toSmartleadLead", () => {
  it("splits the name and carries licence, city, lead id and the unsubscribe link", () => {
    expect(toSmartleadLead(lead({ email: " maria@bakerdrywall.com " }), { unsubscribeUrl: "https://x/unsubscribe/t" })).toEqual({
      email: "maria@bakerdrywall.com",
      first_name: "Maria",
      last_name: "de la Cruz",
      company_name: "Baker Drywall",
      phone_number: "(916) 555-0100",
      custom_fields: { lead_id: "l1", licence: "884201", city: "Sacramento", unsubscribe_url: "https://x/unsubscribe/t" },
    });
  });

  it("handles no name, one name, and no phone", () => {
    expect(splitName(null)).toEqual({ first: "", last: "" });
    expect(splitName("  Cher ")).toEqual({ first: "Cher", last: "" });
    const out = toSmartleadLead(lead({ phone: null, licenceNumber: null, city: null }), { unsubscribeUrl: "u" });
    expect(out).not.toHaveProperty("phone_number");
    expect(out.custom_fields).toMatchObject({ licence: "", city: "" });
  });
});

describe("countsFrom", () => {
  it("reads the API reference's spelling", () => {
    expect(countsFrom({ added_count: 3, skipped_count: 1 })).toEqual({ added: 3, skipped: 1 });
  });
  it("reads the older spelling, summing the skip reasons", () => {
    expect(
      countsFrom({ upload_count: 5, block_count: 1, duplicate_count: 2, invalid_email_count: 0, unsubscribed_leads: ["a"] }),
    ).toEqual({ added: 5, skipped: 4 });
  });
  it("says null when the vendor said nothing", () => {
    expect(countsFrom({})).toEqual({ added: null, skipped: null });
  });
});

describe("pushLeads", () => {
  const toLead = (l: PushCandidate) => toSmartleadLead(l, { unsubscribeUrl: "u" });
  const ok = (body: object) => new Response(JSON.stringify(body), { status: 200 });

  it("posts in chunks of at most 100 to the campaign, with the vendor's suppression lists honoured", async () => {
    const fetchMock = vi.fn(async () => ok({ success: true, added_count: 1, skipped_count: 0 }));
    const leads = Array.from({ length: 250 }, (_, i) => lead({ id: `l${i}` }));
    const out = await pushLeads({ apiKey: "k", fetch: fetchMock as unknown as typeof fetch }, "123", leads, toLead);
    expect(out.error).toBeNull();
    expect(out.batches.map((b) => b.leads.length)).toEqual([100, 100, 50]);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://server.smartlead.ai/api/v1/campaigns/123/leads?api_key=k");
    const body = JSON.parse(init.body as string);
    expect(body.lead_list).toHaveLength(100);
    expect(Object.values(body.settings)).toEqual([false, false, false, false]);
  });

  it("turns a non-2xx into a sentence, keeps the batches that went, and never leaks the key", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(ok({ added_count: 100 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ message: "Campaign not found" }), { status: 404 }));
    const leads = Array.from({ length: 150 }, (_, i) => lead({ id: `l${i}` }));
    const out = await pushLeads({ apiKey: "SECRETKEY", fetch: fetchMock as unknown as typeof fetch }, "9", leads, toLead);
    expect(out.batches).toHaveLength(1);
    expect(out.error).toBe('Smartlead answered 404 to leads 101–150 of 150 ("Campaign not found"). Nothing from that batch on was sent.');
    expect(out.error).not.toContain("SECRETKEY");
  });

  it("turns a network failure and a 200 saying success:false into sentences, not throws", async () => {
    const down = await pushLeads({ apiKey: "k", fetch: (async () => { throw new Error("ECONNRESET"); }) as unknown as typeof fetch }, "1", [lead()], toLead);
    expect(down.error).toMatch(/^Could not reach Smartlead/);
    const refused = await pushLeads({ apiKey: "k", fetch: (async () => ok({ success: false, message: "Invalid email" })) as unknown as typeof fetch }, "1", [lead()], toLead);
    expect(refused.batches).toEqual([]);
    expect(refused.error).toContain("Invalid email");
  });

  it("sends nothing for no leads", async () => {
    const fetchMock = vi.fn();
    expect(await pushLeads({ apiKey: "k", fetch: fetchMock as unknown as typeof fetch }, "1", [], toLead)).toEqual({ batches: [], error: null });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
