import { describe, expect, it, vi } from "vitest";

/**
 * "Same job from another GC" — the rules, each pinned by a case ONLY THAT RULE
 * decides (CLAUDE.md, "a mutation that survives is a case that proves
 * nothing"), and the near-misses that must NOT match.
 *
 * The module also holds the create path, which reads the database; the pure
 * matcher touches neither, so the database is a stub that throws if reached.
 */
vi.mock("@prova/db", () => ({
  prisma: new Proxy({}, { get: () => { throw new Error("the matcher must not touch the database"); } }),
}));
vi.mock("@/lib/agents/onEvent", () => ({ runAgentAfterResponse: () => undefined }));

const {
  findSameJobFromOtherGc,
  sameJobReasons,
  nameTokens,
  normaliseStreet,
  normaliseCity,
  joinSameJobReasons,
  sameJobFlags,
} = await import("./bid-invitation");

type Inv = Parameters<typeof sameJobReasons>[1];
const on = (over: Partial<Inv>): Inv => ({
  id: "inv-1",
  contactId: "acme",
  contactName: "Acme Builders",
  projectName: "Riverside Medical",
  status: "INVITED",
  dueDate: "2026-11-04",
  site: null,
  ...over,
});
const asking = (over: Partial<Parameters<typeof sameJobReasons>[0]> = {}) => ({
  contactId: "baker" as string | null,
  projectName: "Riverside Medical",
  dueDate: "2026-11-04" as string | null,
  site: null as string | null,
  ...over,
});

describe("the sentence", () => {
  it("says the match in words a person reads: 'Same name and due date as Riverside Medical from Acme Builders'", () => {
    const [match] = findSameJobFromOtherGc(asking(), [on({})]);
    expect(match.sentence).toBe("Same name and due date as Riverside Medical from Acme Builders");
    expect(match.reasons).toEqual(["same name", "same due date"]);
  });

  it("names a near date by its distance, and a similar name as similar", () => {
    const [match] = findSameJobFromOtherGc(
      asking({ projectName: "Riverside Medical Office", dueDate: "2026-11-06" }),
      [on({ projectName: "Riverside Medical Office Building" })],
    );
    expect(match.sentence).toBe("Similar name and due dates 2 days apart as Riverside Medical Office Building from Acme Builders");
  });

  it("folds a repeated 'same' and lists three reasons with commas", () => {
    expect(joinSameJobReasons(["same name", "same site address", "same due date"])).toBe(
      "Same name, site address and due date",
    );
    expect(joinSameJobReasons(["similar name", "same city"])).toBe("Similar name and same city");
  });
});

describe("rule 1 — open invitations from a DIFFERENT GC only", () => {
  it("does not flag the same GC: that is reuseOpenDuplicate's case, not this one", () => {
    expect(sameJobReasons(asking({ contactId: "acme" }), on({}))).toBeNull();
  });

  it("does not flag a decided or declined invitation", () => {
    for (const status of ["WON", "LOST", "DECLINED"]) {
      expect(sameJobReasons(asking(), on({ status })), status).toBeNull();
    }
    expect(sameJobReasons(asking(), on({ status: "SUBMITTED" }))).not.toBeNull();
  });

  it("does not compare an invitation on file with itself", () => {
    expect(sameJobReasons(asking({ id: "inv-1", contactId: "baker" }), on({}))).toBeNull();
  });

  it("compares against every GC when none has been picked yet", () => {
    expect(sameJobReasons(asking({ contactId: null }), on({}))).toEqual(["same name", "same due date"]);
  });
});

describe("rule 2 — due dates more than 30 days apart are a re-bid, never the same job", () => {
  it("refuses an identical name 31 days apart, and accepts it 30 days apart", () => {
    expect(sameJobReasons(asking({ dueDate: "2026-12-05" }), on({}))).toBeNull();
    expect(sameJobReasons(asking({ dueDate: "2026-12-04" }), on({}))).toEqual(["same name"]);
  });

  it("refuses even the same street address 31 days apart", () => {
    expect(
      sameJobReasons(
        asking({ projectName: "Clinic", site: "1200 Main St, Riverside CA", dueDate: "2026-12-05" }),
        on({ projectName: "Hospital wing", site: "1200 Main Street, Riverside" }),
      ),
    ).toBeNull();
  });
});

describe("rule 3 — different numbers in the names are different jobs", () => {
  it("refuses Phase 1 against Phase 2, same date, same city", () => {
    expect(
      sameJobReasons(
        asking({ projectName: "Riverside Medical Phase 2", site: "Riverside, CA" }),
        on({ projectName: "Riverside Medical Phase 1", site: "Riverside, CA" }),
      ),
    ).toBeNull();
  });

  it("refuses Building 3 against Building 4 at the same street address", () => {
    expect(
      sameJobReasons(
        asking({ projectName: "Ontario Logistics Building 3", site: "500 Airport Dr, Ontario" }),
        on({ projectName: "Ontario Logistics Building 4", site: "500 Airport Drive, Ontario" }),
      ),
    ).toBeNull();
  });

  it("allows a number on ONE side only — the other GC may simply have left it off", () => {
    expect(
      sameJobReasons(asking({ projectName: "Riverside Medical Office 2" }), on({ projectName: "Riverside Medical Office" })),
    ).toEqual(["similar name", "same due date"]);
  });
});

describe("rule 4 — the same street address is the same job, on its own", () => {
  it("matches two unrelated names at one address with no dates at all", () => {
    expect(
      sameJobReasons(
        asking({ projectName: "Kaiser clinic remodel", dueDate: null, site: "1200 Main St., Suite 300, Riverside CA" }),
        on({ projectName: "KP Riverside TI", dueDate: null, site: "1200 Main Street, Riverside, CA 92501" }),
      ),
    ).toEqual(["same site address"]);
  });

  it("does not match a different street number on the same street", () => {
    expect(
      sameJobReasons(
        asking({ projectName: "Kaiser clinic remodel", dueDate: null, site: "1200 Main St, Riverside" }),
        on({ projectName: "KP Riverside TI", dueDate: null, site: "1202 Main St, Riverside" }),
      ),
    ).toBeNull();
  });

  it("normalises the spellings an address arrives in, and refuses a street with no number", () => {
    expect(normaliseStreet("1200 N. Main St., Ste 4")).toBe("1200 north main street");
    expect(normaliseStreet("1200 North Main Street #4")).toBe("1200 north main street");
    expect(normaliseStreet("Main Street")).toBeNull();
    expect(normaliseStreet(null)).toBeNull();
  });
});

describe("rule 5 — the same name is the same job, on its own", () => {
  it("matches the same words in any case and punctuation, with no date on either", () => {
    expect(
      sameJobReasons(asking({ projectName: "RIVERSIDE MEDICAL", dueDate: null }), on({ projectName: "Riverside-Medical", dueDate: null })),
    ).toEqual(["same name"]);
  });

  it("drops filler words and boilerplate before comparing", () => {
    expect(nameTokens("ITB: The New Riverside Medical Project")).toEqual(["riverside", "medical"]);
    expect(nameTokens("Riverside Med Ctr")).toEqual(["riverside", "medical", "center"]);
  });

  it("does not treat a one-word name as 'the same name' — 'Starbucks' is many jobs", () => {
    expect(sameJobReasons(asking({ projectName: "Starbucks", dueDate: null }), on({ projectName: "Starbucks", dueDate: null }))).toBeNull();
  });
});

describe("rule 6 — a similar name needs a supporting fact", () => {
  const similar = { projectName: "Riverside Medical Office" };
  const theirs = { projectName: "Riverside Medical Office Building" };

  it("matches a similar name with due dates 7 days apart, and refuses it 8 days apart", () => {
    expect(sameJobReasons(asking({ ...similar, dueDate: "2026-11-11" }), on(theirs))).toEqual([
      "similar name",
      "due dates 7 days apart",
    ]);
    expect(sameJobReasons(asking({ ...similar, dueDate: "2026-11-12" }), on(theirs))).toBeNull();
  });

  it("matches a similar name in the same city with no dates", () => {
    expect(
      sameJobReasons(
        asking({ ...similar, dueDate: null, site: "Riverside, CA" }),
        on({ ...theirs, dueDate: null, site: "4500 Brockton Ave, Riverside CA 92501" }),
      ),
    ).toEqual(["similar name", "same city"]);
  });

  it("refuses a similar name with no date and no site — a similar name alone is not enough", () => {
    expect(sameJobReasons(asking({ ...similar, dueDate: null }), on({ ...theirs, dueDate: null }))).toBeNull();
  });

  it("refuses a similar name in a DIFFERENT city with no dates", () => {
    expect(
      sameJobReasons(asking({ ...similar, dueDate: null, site: "Corona, CA" }), on({ ...theirs, dueDate: null, site: "Riverside, CA" })),
    ).toBeNull();
  });

  it("refuses names that share under 60% of their words even on the same day", () => {
    // {riverside, medical} vs {riverside, school, district}: 1 of 4 shared.
    expect(sameJobReasons(asking(), on({ projectName: "Riverside School District" }))).toBeNull();
    // {riverside, medical, office} vs {riverside, medical, imaging, center}: 2 of 5 = 40%.
    expect(sameJobReasons(asking(similar), on({ projectName: "Riverside Medical Imaging Center" }))).toBeNull();
  });

  it("reads the city from either shape of site line", () => {
    expect(normaliseCity("1200 Main St, Riverside, CA 92501")).toBe("riverside");
    expect(normaliseCity("1200 Main St, Riverside CA")).toBe("riverside");
    expect(normaliseCity("Los Angeles, CA")).toBe("los angeles");
    expect(normaliseCity("Riverside")).toBe("riverside");
    expect(normaliseCity(null)).toBeNull();
  });
});

describe("sameJobFlags — the bid list's view", () => {
  it("flags both sides of a cross-GC pair, and never a lone or closed invitation", () => {
    const flags = sameJobFlags([
      on({ id: "a", contactId: "acme", contactName: "Acme Builders" }),
      on({ id: "b", contactId: "baker", contactName: "Baker Construction" }),
      on({ id: "c", contactId: "cal", contactName: "Cal Pacific", status: "LOST" }),
      on({ id: "d", contactId: "dune", contactName: "Dune GC", projectName: "Ontario Warehouse" }),
    ]);
    expect([...flags.keys()]).toEqual(["a", "b"]);
    expect(flags.get("a")?.map((m) => m.sentence)).toEqual(["Same name and due date as Riverside Medical from Baker Construction"]);
    expect(flags.get("b")?.map((m) => m.sentence)).toEqual(["Same name and due date as Riverside Medical from Acme Builders"]);
  });

  it("does not flag two open invitations from the SAME GC", () => {
    expect(sameJobFlags([on({ id: "a" }), on({ id: "b" })]).size).toBe(0);
  });
});

describe("the list", () => {
  it("returns every match, strongest first, and nothing for a lone invitation", () => {
    const invitations = [
      on({ id: "a", contactId: "acme", contactName: "Acme Builders", projectName: "Riverside Medical Office Building", dueDate: "2026-11-06" }),
      on({ id: "b", contactId: "cal", contactName: "Cal Pacific", projectName: "Riverside Medical Office", dueDate: "2026-11-04", site: "1200 Main St, Riverside" }),
      on({ id: "c", contactId: "dune", contactName: "Dune GC", projectName: "Ontario Warehouse", dueDate: "2026-11-04" }),
    ];
    const matches = findSameJobFromOtherGc(
      asking({ projectName: "Riverside Medical Office", site: "1200 Main Street, Riverside CA" }),
      invitations,
    );
    expect(matches.map((m) => m.id)).toEqual(["b", "a"]);
    expect(matches[0].sentence).toBe("Same name, site address and due date as Riverside Medical Office from Cal Pacific");
    expect(findSameJobFromOtherGc(asking({ projectName: "Something else" }), invitations)).toEqual([]);
  });
});
