import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FoundLead } from "@prova/integrations";
import { canRunCommand } from "../commands";
import type { CommandContext } from "../commands";
import { keepSuggestions } from "../webSuggestions";

/**
 * find_bid_leads against a where-honouring fake, a faked action and a
 * faked lead finder.
 *
 * Pinned, because each is what a person would be hurt by if it drifted:
 *   - RESOLVE NEVER WRITES, and the search never runs before the inputs
 *     are settled: a missing trade or region is a question back with NO
 *     call to the finder, so nothing is spent on a question that will be
 *     asked again.
 *   - WHAT LEAVES is exactly the five typed fields — the finder is called
 *     with those keys and no others, the trades as the enum (decided by
 *     code from the person's words), and never with a company name, a job
 *     or a figure.
 *   - DEDUPE hides only on exact evidence (same source URL noted on a
 *     pursuit, same normalised name) and BADGES the rest; a false
 *     duplicate silently hides a real job, so fuzzy never hides.
 *   - TRADE RELEVANCE and the bid date are decided in code; a lead that
 *     names no trade goes in a "couldn't tell" group, last, never dropped.
 *   - THE TAP writes BidPursuit rows through `createBidPursuit` only, one
 *     per lead still ticked, with the source URL in the note.
 *   - The capability is MANAGE_ESTIMATING: the field and accounting are
 *     never offered it.
 */

type Where = Record<string, unknown>;
function matches(row: Record<string, unknown>, where: Where | undefined): boolean {
  if (!where) return true;
  return Object.entries(where).every(([key, want]) => {
    const have = row[key];
    if (want !== null && typeof want === "object" && !(want instanceof Date)) {
      const op = want as { contains?: string; equals?: string; not?: unknown };
      if (op.contains !== undefined) return String(have ?? "").toLowerCase().includes(op.contains.toLowerCase());
      if (op.equals !== undefined) return String(have ?? "").toLowerCase() === op.equals.toLowerCase();
      if ("not" in op) return have !== op.not;
      return false;
    }
    return have === want;
  });
}

type Row = Record<string, unknown>;
let PURSUITS: Row[] = [];
let JOBS: Row[] = [];
let INVITATIONS: Row[] = [];
let COMPANY: Row | null = null;

const fake = vi.hoisted(() => ({
  createBidPursuit: vi.fn(),
  write: vi.fn(() => {
    throw new Error("resolve wrote to the database");
  }),
}));

vi.mock("@prova/db", () => ({
  prisma: {
    company: { findUnique: async ({ where }: { where: Where }) => (COMPANY && matches(COMPANY, where) ? COMPANY : null) },
    bidPursuit: {
      findFirst: async ({ where }: { where: Where }) => PURSUITS.find((row) => matches(row, where)) ?? null,
      findMany: async ({ where }: { where: Where }) => PURSUITS.filter((row) => matches(row, where)),
      create: fake.write,
      update: fake.write,
      updateMany: fake.write,
    },
    job: { findMany: async ({ where }: { where: Where }) => JOBS.filter((row) => matches(row, where)), create: fake.write },
    bidInvitation: { findMany: async ({ where }: { where: Where }) => INVITATIONS.filter((row) => matches(row, where)), create: fake.write },
  },
}));
vi.mock("@/lib/actions/bidPursuits", () => ({ createBidPursuit: fake.createBidPursuit }));

const {
  findBidLeadsCommand,
  nameOverlap,
  normaliseName,
  parseRegion,
  placeAgainstKnown,
  pursuitNoteFor,
  readBidDay,
  readPublicWork,
  readSizeBand,
  readState,
  readTrades,
  urlsIn,
} = await import("./leads");

const TODAY = "2026-09-24";
const base: CommandContext = { companyId: "co-1", userId: "u-1", principal: { role: "OWNER", jobFunction: null }, today: TODAY };

const BOARD = "https://www.longbeach.gov/pw/bids/lincoln-elementary";
const PORTAL = "https://caleprocure.ca.gov/event/12345";
const ROOF = "https://www.lacounty.gov/bids/roof-77";
const KNOWN_URL = "https://www.longbeach.gov/pw/bids/harbor-fire-12";

const found = (projectName: string, url: string, fields: Partial<FoundLead["fields"]> = {}): FoundLead => ({
  source: { url, title: `Page for ${projectName}` },
  fields: { projectName, ...fields },
});

const line = (result: { preview?: { label: string; value: string }[] }, label: string) => result.preview?.find((l) => l.label === label)?.value;

beforeEach(() => {
  COMPANY = { id: "co-1", hqCity: "Long Beach", hqState: "CA", doesPublicWork: true };
  PURSUITS = [
    { id: "p1", companyId: "co-1", projectName: "Northgate Medical", stage: "WATCHING", note: null },
    { id: "p2", companyId: "co-1", projectName: "Harbor Fire Station 12", stage: "CONTACTED", note: `Found on the web: ${KNOWN_URL}\nA fire station` },
    { id: "p3", companyId: "co-1", projectName: "Old Dropped Thing", stage: "DROPPED", note: null },
    { id: "p4", companyId: "co-2", projectName: "Lincoln Elementary Modernization", stage: "WATCHING", note: null },
  ];
  JOBS = [
    { id: "j1", companyId: "co-1", name: "Riverside Plaza" },
    { id: "j2", companyId: "co-2", name: "Wilson High Gym" },
  ];
  INVITATIONS = [{ id: "i1", companyId: "co-1", projectName: "The Cabrillo Library Project" }];
  fake.createBidPursuit.mockReset();
  fake.write.mockClear();
});

describe("the parsers decide in code", () => {
  it("reads the person's trade words into the enum, several at once, and asks about a word that names none", () => {
    expect(readTrades("drywall and ceilings")).toEqual({ trades: ["METAL_FRAMING_DRYWALL", "ACOUSTICAL_CEILINGS"] });
    expect(readTrades("lath & plaster, stucco")).toEqual({ trades: ["LATH_PLASTER"] });
    expect(readTrades("metal framing / drywall, EIFS, fireproofing")).toEqual({ trades: ["METAL_FRAMING_DRYWALL", "EIFS", "FIREPROOFING"] });
    expect(readTrades("drywall, interior finishes")).toEqual({ unknown: "interior finishes" });
    expect(readTrades("roofing")).toEqual({ unknown: "roofing" });
  });

  it("reads a city and a two-letter state, and refuses an address", () => {
    expect(parseRegion("Long Beach, CA")).toEqual({ city: "Long Beach", state: "CA" });
    expect(parseRegion("Long Beach, California 90802")).toEqual({ city: "Long Beach", state: "CA" });
    expect(parseRegion("Reno Nevada")).toEqual({ city: "Reno", state: "NV" });
    expect(parseRegion("St. George, UT")).toEqual({ city: "St. George", state: "UT" });
    expect(parseRegion("123 Main St, Long Beach, CA")).toBeNull();
    expect(parseRegion("Long Beach")).toBeNull();
    expect(parseRegion("Paris, France")).toBeNull();
    expect(readState("ca")).toBe("CA");
    expect(readState("New Mexico")).toBe("NM");
    expect(readState("Narnia")).toBeNull();
  });

  it("reads public/private, a size band, and a bid date only with a year", () => {
    expect(readPublicWork("public only")).toBe(true);
    expect(readPublicWork("private")).toBe(false);
    expect(readPublicWork("either")).toBeUndefined();
    expect(readPublicWork("public and private")).toBeUndefined();
    expect(readPublicWork("yes")).toBeNull();
    expect(readSizeBand("under 250k")).toBe("UNDER_250K");
    expect(readSizeBand("250k to 1M")).toBe("FROM_250K_TO_1M");
    expect(readSizeBand("over 1 million")).toBe("OVER_1M");
    expect(readSizeBand("big ones")).toBeNull();
    expect(readBidDay("October 3, 2026")).toBe("2026-10-03");
    expect(readBidDay("Bid opening 10/3/2026 at 2pm")).toBe("2026-10-03");
    expect(readBidDay("3 Oct 2026")).toBe("2026-10-03");
    expect(readBidDay("2026-10-03")).toBe("2026-10-03");
    expect(readBidDay("October 3")).toBeNull();
    expect(readBidDay("2/30/2026")).toBeNull();
  });
});

describe("dedupe: hide on exact evidence, badge on anything fuzzier", () => {
  const known = [
    { name: "Northgate Medical", kind: "pipeline" as const, href: "/pipeline" },
    { name: "Harbor Fire Station 12", kind: "pipeline" as const, href: "/pipeline", urls: urlsIn(`see ${KNOWN_URL}/`) },
    { name: "Riverside Plaza", kind: "job" as const, href: "/jobs" },
  ];

  it("normalises a name: case, punctuation and generic words do not make a new project", () => {
    expect(normaliseName("The Northgate Medical Project")).toBe(normaliseName("NORTHGATE MEDICAL"));
    expect(normaliseName("Northgate Medical Phase II")).not.toBe(normaliseName("Northgate Medical"));
    expect(urlsIn("Found on the web: https://a.example.com/x/ and http://b.example.com/y#frag")).toEqual([
      "https://a.example.com/x",
      "http://b.example.com/y",
    ]);
    expect(nameOverlap("Northgate Medical Phase II", "Northgate Medical")).toBeCloseTo(2 / 3);
    expect(nameOverlap("Harbor Fire Station 12", "Riverside Plaza")).toBe(0);
  });

  it("hides a lead whose source URL is already noted on a pursuit, and one whose normalised name matches", () => {
    expect(placeAgainstKnown({ projectName: "Anything At All", sourceUrl: `${KNOWN_URL}#top` }, known)).toMatchObject({ hidden: true, because: "url" });
    expect(placeAgainstKnown({ projectName: "the NORTHGATE medical project", sourceUrl: PORTAL }, known)).toMatchObject({ hidden: true, because: "name" });
  });

  it("badges but NEVER hides a fuzzy match, and neither for an unrelated name", () => {
    expect(placeAgainstKnown({ projectName: "Northgate Medical Phase II", sourceUrl: PORTAL }, known)).toEqual({
      hidden: false,
      like: known[0],
    });
    expect(placeAgainstKnown({ projectName: "Lincoln Elementary Modernization", sourceUrl: BOARD }, known)).toEqual({ hidden: false, like: null });
  });
});

describe("resolve", () => {
  const leads = vi.fn();
  const ctx = (): CommandContext => ({ ...base, leads });
  beforeEach(() => leads.mockReset());

  it("asks for the trades before anything else, and searches nothing", async () => {
    const result = await findBidLeadsCommand.resolve(ctx(), {});
    expect(result).toMatchObject({ kind: "need", missing: expect.stringContaining("which trades") });
    const unknown = await findBidLeadsCommand.resolve(ctx(), { trades: "interior finishes" });
    expect(unknown).toMatchObject({ kind: "need", missing: expect.stringContaining('"interior finishes"') });
    expect(leads).not.toHaveBeenCalled();
  });

  it("asks for a region when the person gave none and the company has no head-office city", async () => {
    COMPANY = { id: "co-1", hqCity: null, hqState: null, doesPublicWork: true };
    const result = await findBidLeadsCommand.resolve(ctx(), { trades: "drywall" });
    expect(result).toMatchObject({ kind: "need", missing: expect.stringContaining("no head-office city") });
    const bad = await findBidLeadsCommand.resolve(ctx(), { trades: "drywall", region: "123 Main St, Long Beach, CA" });
    expect(bad).toMatchObject({ kind: "need", missing: expect.stringContaining('"123 Main St, Long Beach, CA"') });
    expect(leads).not.toHaveBeenCalled();
  });

  it("asks public-or-private when the company never answered it and the person did not say", async () => {
    COMPANY = { id: "co-1", hqCity: "Long Beach", hqState: "CA", doesPublicWork: null };
    const result = await findBidLeadsCommand.resolve(ctx(), { trades: "drywall" });
    expect(result).toMatchObject({ kind: "need", missing: expect.stringContaining("public works only, or private") });
    expect(leads).not.toHaveBeenCalled();
  });

  it("refuses in words with no finder attached, and never guesses", async () => {
    const result = await findBidLeadsCommand.resolve(base, { trades: "drywall" });
    expect(result).toMatchObject({ kind: "refuse", reason: expect.stringContaining("web lookup isn't available") });
  });

  it("sends exactly the five typed fields — trades as the enum, the HQ city, the company's public-works answer, today — and nothing else", async () => {
    leads.mockResolvedValue({ ok: true, leads: [found("Lincoln Elementary Modernization", BOARD, { scopeSummary: "drywall and ceilings" })] });
    await findBidLeadsCommand.resolve(ctx(), { trades: "drywall and ceilings" });
    expect(leads).toHaveBeenCalledTimes(1);
    const sent = leads.mock.calls[0][0];
    expect(Object.keys(sent).sort()).toEqual(["bidsAfter", "publicWorkOnly", "region", "sizeBand", "trades"]);
    expect(sent).toEqual({
      trades: ["METAL_FRAMING_DRYWALL", "ACOUSTICAL_CEILINGS"],
      region: { city: "Long Beach", state: "CA", radiusMiles: 40 },
      sizeBand: undefined,
      publicWorkOnly: true,
      bidsAfter: TODAY,
    });
    // The person's own region and words win over the company row.
    await findBidLeadsCommand.resolve(ctx(), { trades: "EIFS", region: "Reno, Nevada", publicWork: "private too", sizeBand: "over 1M" });
    expect(leads.mock.calls[1][0]).toEqual({
      trades: ["EIFS"],
      region: { city: "Reno", state: "NV", radiusMiles: 40 },
      sizeBand: "OVER_1M",
      publicWorkOnly: false,
      bidsAfter: TODAY,
    });
  });

  it("says 'unavailable' and 'nothing turned up' as two different sentences, and neither is a card", async () => {
    leads.mockResolvedValueOnce({ ok: false, reason: "unavailable" });
    expect(await findBidLeadsCommand.resolve(ctx(), { trades: "drywall" })).toMatchObject({
      kind: "refuse",
      reason: expect.stringContaining("unavailable right now — that is different from nothing turning up"),
    });
    leads.mockResolvedValueOnce({ ok: true, leads: [] });
    expect(await findBidLeadsCommand.resolve(ctx(), { trades: "drywall" })).toMatchObject({
      kind: "refuse",
      reason: expect.stringContaining("Nothing out to bid turned up for Metal framing / drywall around Long Beach, CA"),
    });
    leads.mockRejectedValueOnce(new Error("boom"));
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await findBidLeadsCommand.resolve(ctx(), { trades: "drywall" })).toMatchObject({ kind: "refuse" });
    error.mockRestore();
  });

  it("puts what survives on a card: hides exact duplicates, badges fuzzy ones, groups 'couldn't tell' last, flags a past date — and writes nothing", async () => {
    leads.mockResolvedValue({
      ok: true,
      leads: [
        // Already a pursuit, by URL — hidden, whatever the page calls it.
        found("Harbor Fire Station No. 12 Replacement", KNOWN_URL, { scopeSummary: "framing and drywall" }),
        // Couldn't tell the trade from the page, and a date that has passed.
        found("Wilson High Gym Floor", ROOF, { scopeSummary: "interior finishes", bidDate: "September 1, 2026" }),
        // Already a job, by normalised name — hidden.
        found("The Riverside Plaza Project", PORTAL, { scopeSummary: "drywall" }),
        // The real one: in trade, open, a fuzzy cousin on the pipeline.
        found("Northgate Medical Phase II", BOARD, { scopeSummary: "Metal stud framing, gypsum board and acoustical ceilings", location: "Long Beach", owner: "Northgate Health", bidDate: "October 3, 2026", sizeText: "$2.4M estimate" }),
        // Other company's pursuit with this name must not hide it.
        found("Lincoln Elementary Modernization", `${PORTAL}/2`, { scopeSummary: "plaster patching and paint" }),
        // Already a logged bid invitation, by normalised name — hidden.
        found("Cabrillo Library", `${PORTAL}/3`, { scopeSummary: "drywall" }),
      ],
    });
    const result = await findBidLeadsCommand.resolve(ctx(), { trades: "drywall, ceilings" });
    expect(result.kind).toBe("ready");
    if (result.kind !== "ready") return;

    expect(result.suggestions!.map((s) => s.label)).toEqual(["Northgate Medical Phase II", "Lincoln Elementary Modernization", "Wilson High Gym Floor"]);
    const [northgate, lincoln, wilson] = result.suggestions!;
    expect(northgate.value).toContain("Metal framing / drywall, Acoustical ceilings");
    expect(northgate.value).toContain("bids October 3, 2026");
    expect(northgate.value).toContain('looks like "Northgate Medical", already on your pipeline');
    expect(northgate.sources).toEqual([{ title: "Page for Northgate Medical Phase II", url: BOARD }]);
    expect(lincoln.value).toContain("Lath & plaster");
    expect(wilson.value).toContain("trade: couldn't tell from the page");
    expect(wilson.value).toContain("bid date shown as September 1, 2026 — check, it may have passed");

    expect(line(result, "Found")).toBe("3 projects out to bid, 3 more hidden as already on your pipeline, jobs or bids");
    expect(line(result, "Couldn't tell the trade")).toBe("1 — shown last, not counted as in-trade");
    expect(line(result, "Area")).toBe("Long Beach, CA, within 40 miles (your head office)");
    expect(line(result, "Public works")).toBe("public works only");
    expect(result.warnings.join(" ")).toContain("Open the source before you call anyone");
    expect(result.warnings.join(" ")).toContain("1 shows a bid date that may already have passed");
    expect(result.warnings.join(" ")).toContain("1 looks like something already on your list");

    // The server-held payload carries the same list the card shows, and
    // the lead details `execute` will need — keys match one to one.
    const stored = result.resolved.leads as { key: string; projectName: string; bidDay: string | null; sourceUrl: string }[];
    expect(stored.map((l) => l.key)).toEqual(result.suggestions!.map((s) => s.key));
    expect(stored[0]).toMatchObject({ projectName: "Northgate Medical Phase II", bidDay: "2026-10-03", sourceUrl: BOARD });
    expect(keepSuggestions(result.resolved.webSuggestions).map((s) => s.key)).toEqual(stored.map((l) => l.key));

    expect(fake.write).not.toHaveBeenCalled();
    expect(fake.createBidPursuit).not.toHaveBeenCalled();
  });

  it("refuses with a link when every found project is already known", async () => {
    leads.mockResolvedValue({ ok: true, leads: [found("Northgate Medical", PORTAL), found("Riverside Plaza", BOARD)] });
    const result = await findBidLeadsCommand.resolve(ctx(), { trades: "drywall" });
    expect(result).toMatchObject({ kind: "refuse", reason: expect.stringContaining("2 projects"), href: "/pipeline" });
    expect(result).toMatchObject({ reason: expect.stringContaining("every one is already on your pipeline, jobs or bids") });
  });
});

describe("execute — the tap", () => {
  const lead = (key: string, projectName: string, sourceUrl: string, extra: Record<string, unknown> = {}) => ({
    key,
    projectName,
    location: "Long Beach",
    owner: null,
    bidDate: null,
    bidDay: null,
    scopeSummary: "drywall",
    sizeText: null,
    deliveryMethod: null,
    sourceUrl,
    sourceTitle: `Page for ${projectName}`,
    ...extra,
  });
  const suggestion = (key: string, label: string, url: string) => ({ key, label, value: "x", sources: [{ title: label, url }] });

  const payload = () => ({
    trades: ["METAL_FRAMING_DRYWALL"],
    region: { city: "Long Beach", state: "CA" },
    publicWorkOnly: true,
    sizeBand: null,
    bidsAfter: TODAY,
    leads: [
      lead("lead-1", "Northgate Medical Phase II", BOARD, { owner: "Northgate Health", bidDate: "October 3, 2026", bidDay: "2026-10-03", sizeText: "$2.4M estimate" }),
      lead("lead-2", "Lincoln Elementary Modernization", PORTAL),
      lead("lead-3", "Wilson High Gym Floor", ROOF),
    ],
    webSuggestions: [
      suggestion("lead-1", "Northgate Medical Phase II", BOARD),
      suggestion("lead-2", "Lincoln Elementary Modernization", PORTAL),
      suggestion("lead-3", "Wilson High Gym Floor", ROOF),
    ],
  });

  const formOf = (call: unknown[]) => Object.fromEntries((call[0] as FormData).entries());

  it("adds one pursuit per lead still ticked, through createBidPursuit, with the source in the note — and the untick is honoured", async () => {
    fake.createBidPursuit.mockResolvedValue({ ok: true });
    PURSUITS.push({ id: "p-new", companyId: "co-1", projectName: "Northgate Medical Phase II", stage: "WATCHING", note: null, createdAt: new Date() });
    // What confirmAskProposal hands execute after the person unticked lead-3.
    const p = payload();
    const kept = { ...p, webSuggestions: keepSuggestions(p.webSuggestions, ["lead-3"]) };

    const result = await findBidLeadsCommand.execute!(base, kept);

    expect(fake.createBidPursuit).toHaveBeenCalledTimes(2);
    expect(formOf(fake.createBidPursuit.mock.calls[0])).toEqual({
      projectName: "Northgate Medical Phase II",
      stage: "WATCHING",
      owner: "Northgate Health",
      expectedBidDate: "2026-10-03",
      note: `Found on the web: ${BOARD}\nLong Beach · drywall · $2.4M estimate`,
    });
    expect(formOf(fake.createBidPursuit.mock.calls[1])).toEqual({
      projectName: "Lincoln Elementary Modernization",
      stage: "WATCHING",
      note: `Found on the web: ${PORTAL}\nLong Beach · drywall`,
    });
    expect(result).toMatchObject({
      ok: true,
      message: expect.stringContaining("Added 2 projects to the pursuit list as Watching: Northgate Medical Phase II, Lincoln Elementary Modernization"),
      created: { href: "/pipeline", targetType: "BidPursuit", targetId: "p-new", label: "2 pursuits" },
    });
    // No estimated value ever: a size TEXT from a page is not a figure.
    for (const call of fake.createBidPursuit.mock.calls) expect(formOf(call)).not.toHaveProperty("estimatedValue");
  });

  it("refuses when everything was unticked, and reports the action's own sentence when one fails", async () => {
    const p = payload();
    expect(await findBidLeadsCommand.execute!(base, { ...p, webSuggestions: [] })).toMatchObject({ ok: false, error: expect.stringContaining("Every lead was unticked") });
    expect(fake.createBidPursuit).not.toHaveBeenCalled();

    fake.createBidPursuit.mockResolvedValueOnce({ ok: true }).mockResolvedValueOnce({ ok: false, error: "Give the project a name." }).mockResolvedValueOnce({ ok: true });
    const result = await findBidLeadsCommand.execute!(base, p);
    expect(result).toMatchObject({ ok: true, message: expect.stringContaining("Not added: Lincoln Elementary Modernization (Give the project a name.)") });

    fake.createBidPursuit.mockReset();
    fake.createBidPursuit.mockResolvedValue({ ok: false, error: "Estimating isn't part of your job function." });
    expect(await findBidLeadsCommand.execute!(base, p)).toMatchObject({ ok: false, error: expect.stringContaining("Nothing was added") });
  });

  it("skips a stored lead this code did not write — no key, no name, or a source that is not a web link", async () => {
    fake.createBidPursuit.mockResolvedValue({ ok: true });
    const p = payload();
    p.leads = [lead("lead-1", "Northgate Medical Phase II", "javascript:alert(1)"), { ...lead("lead-2", "", PORTAL) }, lead("lead-3", "Wilson High Gym Floor", ROOF)];
    const result = await findBidLeadsCommand.execute!(base, p);
    expect(fake.createBidPursuit).toHaveBeenCalledTimes(1);
    expect(formOf(fake.createBidPursuit.mock.calls[0]).projectName).toBe("Wilson High Gym Floor");
    expect(result.ok).toBe(true);
  });

  it("bounds the note", () => {
    const note = pursuitNoteFor({ sourceUrl: BOARD, scopeSummary: "x".repeat(2000), sizeText: null, deliveryMethod: null, location: null });
    expect(note.length).toBeLessThanOrEqual(1000);
    expect(note.startsWith(`Found on the web: ${BOARD}\n`)).toBe(true);
  });
});

describe("who is offered it", () => {
  it("is MANAGE_ESTIMATING, T1, DIRECT over createBidPursuit: the field and accounting never see it", () => {
    expect(findBidLeadsCommand).toMatchObject({ capability: "MANAGE_ESTIMATING", tier: "T1_DRAFT", mode: "DIRECT", action: "createBidPursuit", core: "createBidPursuit" });
    expect(canRunCommand({ role: "MEMBER", jobFunction: "FIELD" }, findBidLeadsCommand)).toBe(false);
    expect(canRunCommand({ role: "MEMBER", jobFunction: "ACCOUNTING" }, findBidLeadsCommand)).toBe(false);
    expect(canRunCommand({ role: "MEMBER", jobFunction: "ESTIMATOR" }, findBidLeadsCommand)).toBe(true);
    expect(canRunCommand({ role: "OWNER", jobFunction: null }, findBidLeadsCommand)).toBe(true);
  });
});
