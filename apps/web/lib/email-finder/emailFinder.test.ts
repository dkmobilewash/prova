import { describe, expect, it, vi } from "vitest";
import { bareDomain, pickDomain } from "./domain";
import { findEmailForLead } from "./find";
import { patternCandidates } from "./patterns";
import { extractEmails, rankEmails } from "./site";
import { interpretVerdict } from "./verify";

const publicLookup = vi.fn(async () => [{ address: "93.184.216.34", family: 4 }]);

/** One fake network: search, site pages and the verifier, by URL. */
function net(opts: { search?: { url: string; title?: string }[]; pages?: Record<string, string>; verdicts?: Record<string, string> }) {
  return vi.fn(async (input: string | URL) => {
    const url = new URL(String(input));
    if (url.hostname === "api.search.brave.com") return Response.json({ web: { results: opts.search ?? [] } });
    if (url.hostname === "api.millionverifier.com") {
      return Response.json({ result: opts.verdicts?.[url.searchParams.get("email")!] ?? "invalid", credits: 99 });
    }
    const body = opts.pages?.[url.pathname];
    return body === undefined ? new Response("not found", { status: 404 }) : new Response(body);
  });
}

const baker = { companyName: "Baker Drywall Inc", city: "Sacramento", contactName: "José Q. Baker", website: null };

describe("pickDomain", () => {
  it("skips directories and takes the firm's own site", () => {
    const picked = pickDomain("Baker Drywall Inc", [
      { url: "https://www.yelp.com/biz/baker-drywall" },
      { url: "https://www.facebook.com/bakerdrywall" },
      { url: "https://www.cslb.ca.gov/x" },
      { url: "https://www.bbb.org/us/ca/baker" },
      { url: "https://www.bakerdrywall.com/about" },
    ]);
    expect(picked?.domain).toBe("bakerdrywall.com");
  });
  it("matches 'ABC Drywall' to abcdrywall.com on the full name", () => {
    expect(pickDomain("ABC Drywall", [{ url: "https://abcdrywall.com" }])?.domain).toBe("abcdrywall.com");
  });
  it("accepts a host without the name when the title carries every distinctive word", () => {
    expect(pickDomain("Mendoza & Sons Plastering", [{ url: "https://msplaster.com", title: "Mendoza & Sons Plastering | Fresno" }])?.domain).toBe("msplaster.com");
  });
  it("returns null rather than an unrelated site", () => {
    expect(pickDomain("Baker Drywall Inc", [{ url: "https://www.homedepot.com/drywall" }, { url: "https://x.com/baker" }])).toBeNull();
  });
  it("bareDomain strips scheme, www and path", () => {
    expect(bareDomain("https://www.BakerDrywall.com/contact")).toBe("bakerdrywall.com");
    expect(bareDomain("not a domain")).toBeNull();
  });
});

describe("site extraction", () => {
  it("keeps only the firm's own domain and drops noise", () => {
    const html = `<a href="mailto:Luis@BakerDrywall.com">x</a> info@bakerdrywall.com noreply@bakerdrywall.com
      logo@2x.png designer@gmail.com office&#64;www.bakerdrywall.com`;
    expect(extractEmails(html, "bakerdrywall.com")).toEqual(["luis@bakerdrywall.com", "info@bakerdrywall.com", "office@bakerdrywall.com"]);
  });
  it("ranks a personal address above role addresses", () => {
    expect(rankEmails([{ email: "info@a.com" }, { email: "luis@a.com" }]).map((e) => e.email)).toEqual(["luis@a.com", "info@a.com"]);
  });
});

describe("patternCandidates", () => {
  it("folds accents, drops the middle initial, owner shapes first", () => {
    expect(patternCandidates("José Q. Baker", "bakerdrywall.com")).toEqual(
      ["jose", "jose.baker", "josebaker", "jbaker", "jose_baker", "baker", "info", "office", "estimating"].map((l) => `${l}@bakerdrywall.com`),
    );
  });
  it("guesses nothing without an owner", () => {
    expect(patternCandidates(null, "a.com")).toEqual([]);
    expect(patternCandidates("Cher", "a.com")).toEqual([]);
  });
});

it("interpretVerdict", () => {
  expect(interpretVerdict("ok")).toBe("deliverable");
  expect(interpretVerdict("catch_all")).toBe("catch_all");
  for (const r of ["invalid", "unknown", "disposable", "error", undefined]) expect(interpretVerdict(r)).toBe("unusable");
});

describe("findEmailForLead", () => {
  it("site source: searches, reads the contact page, verifies", async () => {
    const fetch = net({
      search: [{ url: "https://www.bakerdrywall.com/" }],
      pages: { "/": "<p>welcome</p>", "/contact": "owner@bakerdrywall.com" },
      verdicts: { "owner@bakerdrywall.com": "ok" },
    });
    const out = await findEmailForLead(baker, { fetch: fetch as never, lookup: publicLookup, searchKey: "k", verifyKey: "v" });
    expect(out).toMatchObject({ found: true, email: "owner@bakerdrywall.com", source: "site", verdict: "deliverable", domainWasFound: true });
    expect(out.note).toBe("Found owner@bakerdrywall.com on their contact page, verified deliverable.");
  });

  it("pattern source: no address on the site, first verified guess wins", async () => {
    const fetch = net({ pages: { "/": "nothing here" }, verdicts: { "jose.baker@bakerdrywall.com": "ok" } });
    const out = await findEmailForLead({ ...baker, website: "bakerdrywall.com" }, { fetch: fetch as never, lookup: publicLookup, verifyKey: "v" });
    expect(out).toMatchObject({ found: true, email: "jose.baker@bakerdrywall.com", source: "pattern", verdict: "deliverable", domainWasFound: false });
    expect(out.tried).toEqual(["jose@bakerdrywall.com", "jose.baker@bakerdrywall.com"]);
  });

  it("stops at a catch-all instead of spending five more credits", async () => {
    const fetch = net({ verdicts: { "jose@bakerdrywall.com": "catch_all" } });
    const out = await findEmailForLead({ ...baker, website: "bakerdrywall.com" }, { fetch: fetch as never, lookup: publicLookup, verifyKey: "v" });
    expect(out).toMatchObject({ found: true, verdict: "catch_all" });
    expect(out.tried).toHaveLength(1);
  });

  it("no verifier key: a guess is labelled a guess", async () => {
    const out = await findEmailForLead({ ...baker, website: "bakerdrywall.com" }, { fetch: net({}) as never, lookup: publicLookup });
    expect(out).toMatchObject({ found: true, email: "jose@bakerdrywall.com", source: "pattern", verdict: null });
    expect(out.note).toBe("Guessed jose@bakerdrywall.com from the owner's name — unverified, no verifier key set.");
  });

  it("no search key and no website: says so", async () => {
    const out = await findEmailForLead(baker, { fetch: net({}) as never });
    expect(out).toMatchObject({ found: false, domain: null });
    expect(out.note).toMatch(/no search key/);
  });

  it("every candidate bounced: verifies at most six", async () => {
    const fetch = net({});
    const out = await findEmailForLead({ ...baker, website: "bakerdrywall.com" }, { fetch: fetch as never, lookup: publicLookup, verifyKey: "v" });
    expect(out.found).toBe(false);
    expect(out.tried).toHaveLength(6);
    expect(out.note).toMatch(/^Every candidate bounced/);
  });

  it("no address on the site and no owner: nothing to guess", async () => {
    const out = await findEmailForLead({ ...baker, contactName: null, website: "bakerdrywall.com" }, { fetch: net({}) as never, lookup: publicLookup });
    expect(out.note).toBe("bakerdrywall.com has no address on its site and there is no owner name to guess from.");
  });

  it("an SSRF refusal comes back as a sentence, not a throw", async () => {
    const lookup = vi.fn(async () => [{ address: "169.254.169.254", family: 4 }]);
    const fetch = net({});
    const out = await findEmailForLead({ ...baker, website: "evil.example" }, { fetch: fetch as never, lookup });
    expect(out.found).toBe(false);
    expect(out.note).toMatch(/Refused evil\.example: it resolves to a private or internal address\. Nothing was fetched\./);
    expect(fetch).not.toHaveBeenCalled();
  });
});
