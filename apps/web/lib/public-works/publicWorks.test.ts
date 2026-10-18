import { describe, expect, it } from "vitest";
import { csvObjects, csvRecords, parseCsvLine } from "./csv";
import { bareLicence, classCodes, cslbDate, firmFromMasterRow, ownerFromPersonnelRow } from "./cslb";
import { flattenRow, parseEcprResults } from "./dir";
import { COUNTIES, ecprWindows, factFor, nameIndex, nameKey, nextSlice, SLICE_KEYS, tierFor } from "./signals";
import { signalFromEcpr } from "./sync";

/** Every firm, licence and project here is invented. The column names are
 * the ones the real files use, matched case-insensitively. */

async function* chunks(parts: string[]) {
  for (const p of parts) yield p;
}

describe("the CSV reader survives any chunking", () => {
  it("splits fields, honours quotes, and keeps a newline inside a quote", async () => {
    expect(parseCsvLine('a,"b, c","say ""hi""",d\r')).toEqual(["a", "b, c", 'say "hi"', "d"]);
    const text = 'H1,H2\nx,"multi\nline"\ny,z\n';
    const cut = [text.slice(0, 7), text.slice(7, 13), text.slice(13)];
    const rows: string[][] = [];
    for await (const r of csvRecords(chunks(cut))) rows.push(r);
    expect(rows).toEqual([["H1", "H2"], ["x", "multi\nline"], ["y", "z"]]);
  });

  it("keys objects by a lower-cased header", async () => {
    const out: Record<string, string>[] = [];
    for await (const o of csvObjects(chunks(["LicenseNo,BusinessName\n", "0012345,ACME DRYWALL\n"]))) out.push(o);
    expect(out).toEqual([{ licenseno: "0012345", businessname: "ACME DRYWALL" }]);
  });
});

describe("CSLB rows become firms only when they are prospects", () => {
  const base = {
    licenseno: "0012345",
    businessname: "ACME DRYWALL",
    fullbusinessname: "Acme Drywall Inc",
    businessphone: "(805) 555 0100",
    mailingaddress: "1 Main St",
    city: "OXNARD",
    county: "Ventura",
    zipcode: "93030",
    businesstype: "Corporation",
    issuedate: "03/15/2010",
    primarystatus: "CLEAR",
    "classifications(s)": "C-9 | B",
    workerscompcoveragetype: "Workers' Compensation Insurance",
  };

  it("keeps a CLEAR C-9 with employees and normalises what it keeps", () => {
    const firm = firmFromMasterRow(base)!;
    expect(firm.licence).toBe("12345");
    expect(firm.classes).toEqual(["C9", "B"]);
    expect(firm.hasEmployees).toBe(true);
    expect(firm.issuedOn?.toISOString()).toBe("2010-03-15T00:00:00.000Z");
  });

  it("drops ACTIVE (the spelling trap), a plumber, and keeps an Exempt licence as no-employees", () => {
    expect(firmFromMasterRow({ ...base, primarystatus: "ACTIVE" })).toBeNull();
    expect(firmFromMasterRow({ ...base, "classifications(s)": "C36" })).toBeNull();
    expect(firmFromMasterRow({ ...base, workerscompcoveragetype: "Exempt" })!.hasEmployees).toBe(false);
  });

  it("reads both classification spellings and bare licences", () => {
    expect(classCodes("C9|C-35 | d12")).toEqual(["C9", "C35", "D12"]);
    expect(bareLicence("0001000002")).toBe("1000002");
    expect(cslbDate("not a date")).toBeNull();
  });

  it("collapses the padded surname-first personnel name", () => {
    expect(ownerFromPersonnelRow({ "lic-no": "12345", name: " DAVIS        DANA     MICHAEL", "emp-titl-cde": " Officer| RMO" })).toEqual({
      licence: "12345",
      owner: { name: "DAVIS DANA MICHAEL", title: "Officer" },
    });
  });
});

describe("DIR rows", () => {
  it("flattens a ServiceNow cell to display and id", () => {
    expect(flattenRow({ sys_id: "abc", customer_account: { display_value: "X", value: "id1" }, is_sub_contractor: { display_value: "true", value: "true" } })).toEqual({
      sys_id: "abc",
      customer_account: "X",
      customer_account__id: "id1",
      is_sub_contractor: "true",
      is_sub_contractor__id: "true",
    });
  });

  it("unwraps the eCPR result however deep DIR nested it", () => {
    const row = { IDPAYROLL_TRANSACTION: "PRRUN1", CONTRACTORNAME: "ACME DRYWALL INC." };
    expect(parseEcprResults(JSON.stringify({ success: true, results: JSON.stringify([row]) }))).toEqual([row]);
    expect(parseEcprResults({ results: [row] })).toEqual([row]);
    expect(parseEcprResults("not json at all".length ? "[]" : "")).toEqual([]);
  });

  it("turns a filing into a signal keyed on DIR's transaction id", () => {
    const s = signalFromEcpr("12345", {
      IDPAYROLL_TRANSACTION: "PRRUN1", START_DATE: "2026-09-01", END_DATE: "2026-09-07", CONTRACTORNAME: "ACME DRYWALL INC.",
      CONTRACTORPWCR: "1", PROJECTNAME: "Elm School Mod", PROJECTID: "9", AWARDINGBODY: "Elm USD", COUNTY: "Ventura",
      SUBMISSIONDATE: "2026-09-10", STATEMENTOFNP: "false", REPORTINGTYPE: "weekly",
    });
    expect(s.vendorKey).toBe("ecpr:PRRUN1");
    expect(s.occurredOn.toISOString()).toBe("2026-09-10T00:00:00.000Z");
    expect(s.awardingBody).toBe("Elm USD");
  });
});

describe("tier and fact are derived, never stored", () => {
  const today = new Date("2026-10-13T00:00:00Z");
  const filing = { kind: "ECPR_FILING" as const, project: "Elm School Mod", awardingBody: "Elm USD", primeContractor: null, occurredOn: new Date("2026-10-07T00:00:00Z") };
  const oldListing = { kind: "PROJECT_LISTING" as const, project: "Old Job", awardingBody: "City", primeContractor: "Big GC", occurredOn: new Date("2025-01-01T00:00:00Z") };

  it("a filing inside 60 days is tier 1; an old listing alone is tier 2; nothing is tier 3", () => {
    expect(tierFor([filing], today)).toBe(1);
    expect(tierFor([oldListing], today)).toBe(2);
    expect(tierFor([], today)).toBe(3);
    expect(tierFor([{ ...filing, occurredOn: new Date("2026-08-01T00:00:00Z") }], today)).toBe(2);
  });

  it("the fact names the source and prefers the newest filing", () => {
    expect(factFor([oldListing, filing])).toBe("filed certified payroll 2026-10-07 on Elm School Mod for Elm USD (DIR eCPR list)");
    expect(factFor([oldListing])).toBe("listed as a sub on Old Job (City, GC Big GC), awarded 2025-01-01 (DIR project list)");
    expect(factFor([])).toBe("");
  });
});

describe("names match across CSLB and DIR, and never ambiguously", () => {
  it("strips corporate furniture, DBA tails and punctuation", () => {
    expect(nameKey("Acme Drywall, Inc.")).toBe("ACMEDRYWALL");
    expect(nameKey("ACME DRYWALL INC DBA ACME WALLS")).toBe("ACMEDRYWALL");
    expect(nameKey("J & J Lath Co.")).toBe("JANDJLATH");
  });

  it("drops a key two firms share", () => {
    const index = nameIndex([
      { licence: "1", name: "ACME DRYWALL", fullName: "Acme Drywall Inc" },
      { licence: "2", name: "ACME DRYWALL", fullName: null },
      { licence: "3", name: "SOLO PLASTER", fullName: null },
    ]);
    expect(index.get("ACMEDRYWALL")).toBeUndefined();
    expect(index.get("SOLOPLASTER")).toBe("3");
  });
});

describe("the sync plans the stalest slice first and stops when nothing is stale", () => {
  const now = new Date("2026-10-13T12:00:00Z");
  const fresh = (key: string) => ({ key, syncedAt: new Date("2026-10-13T00:00:00Z") });
  it("firms before links before the oldest county, then null", () => {
    expect(nextSlice([], now)).toBe(SLICE_KEYS.master);
    expect(nextSlice([fresh(SLICE_KEYS.master)], now)).toBe(SLICE_KEYS.personnel);
    expect(nextSlice([fresh(SLICE_KEYS.master), fresh(SLICE_KEYS.personnel)], now)).toBe(SLICE_KEYS.links);
    const base = [fresh(SLICE_KEYS.master), fresh(SLICE_KEYS.personnel), fresh(SLICE_KEYS.links)];
    expect(nextSlice(base, now)).toBe(SLICE_KEYS.ecpr("Alameda"));
    const allCounties = COUNTIES.map((c) => fresh(SLICE_KEYS.ecpr(c)));
    const butVentura = allCounties.map((s) => (s.key === SLICE_KEYS.ecpr("Ventura") ? { ...s, syncedAt: new Date("2026-10-01T00:00:00Z") } : s));
    expect(nextSlice([...base, ...butVentura], now)).toBe(SLICE_KEYS.ecpr("Ventura"));
    expect(nextSlice([...base, ...allCounties], now)).toBeNull();
  });

  it("has all 58 counties", () => {
    expect(COUNTIES).toHaveLength(58);
    expect(new Set(COUNTIES).size).toBe(58);
  });

  it("halves a capped window down to two days and leaves an uncapped one whole", () => {
    const from = new Date("2026-08-14T00:00:00Z");
    const to = new Date("2026-10-13T00:00:00Z");
    expect(ecprWindows(from, to, false)).toEqual([{ dateFrom: "2026-08-14", dateTo: "2026-10-13" }]);
    const halves = ecprWindows(from, to, true);
    expect(halves.length).toBeGreaterThan(16);
    expect(halves[0].dateFrom).toBe("2026-08-14");
    expect(halves[halves.length - 1].dateTo).toBe("2026-10-13");
    for (let i = 1; i < halves.length; i++) expect(halves[i].dateFrom > halves[i - 1].dateTo).toBe(true);
  });
});
