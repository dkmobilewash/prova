import { describe, expect, it } from "vitest";
import { CslbHeaderError, titleCase } from "./masterFile";
import { cslbPrincipals, personName, preferredPrincipal, principalsForLicences } from "./personnelFile";
import { isCommonSpanishSurname, surnameOf } from "./spanishSurnames";

/**
 * Every licence here is a fixture shape `lib/sales-licence.ts` already cites;
 * every person is invented. The header is the real file's, including the
 * pipe-delimited association columns that align by position.
 */
const HEADER =
  "LIC-NO,LastUpdated,REC-TP,SEQ-NO,Name-TP,Name,EMP-Titl-CDE,CL-CDE,CL-CDE-STAT,ASSN-DT,DIS-ASSN-DT,SURETY-TP,SuretyCompany,BOND-NO,BOND-AMT,EffectiveDate,CancellationDate,JointVentureLicenseType,JointVentureLicenseNumber";

const ROWS = [
  // two associations, the second still live → current; RMO wins the pick
  '884201,01/03/2024,Class/Title,1, Principal,"ALVAREZ        RAMON          J", Officer| Responsible Managing Officer, | C9, N| N, 03/06/2002| 11/06/2018, 04/04/2007| ,,,,,,,,',
  // every association disassociated → not current
  '884201,01/03/2024,Class/Title,2, Principal,"OKAFOR         DANA", Officer, , N, 03/05/2003, 04/30/2003,,,,,,,,',
  // an alias row, not a person to ask for
  '884201,01/03/2024,Class/Title,3, Principal| AKA,"ALVAREZ        RAY", Officer, , N, 03/06/2002, ,,,,,,,,',
  // a different licence, one live officer
  '61234,01/15/2015,Class/Title,1, Principal,"MENDOZA        LUIS", Officer, , N, 01/01/2010, ,,,,,,,,',
  // a corporate parent, skipped
  '91594,01/15/2015,Class/Title,1, Business,"SOME HOLDINGS INC", , , , , ,,,,,,,,',
];
const FILE = [HEADER, ...ROWS].join("\r\n") + "\r\n";

async function all<T>(gen: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const item of gen) out.push(item);
  return out;
}

describe("a padded fixed-width name becomes what a caller says", () => {
  it.each([
    ["ALVAREZ        RAMON          J", "Ramon Alvarez"],
    ["MENDOZA        LUIS", "Luis Mendoza"],
    ["CHER", "Cher"],
    ["   ", ""],
  ])("reads %j as %j", (raw, expected) => {
    expect(personName(raw)).toBe(expected);
  });

  it("title-cases what the file shouts, including hyphenated and spaced names", () => {
    expect(titleCase("SAN DIEGO")).toBe("San Diego");
    expect(titleCase("VILLA-LOBOS")).toBe("Villa-Lobos");
  });
});

describe("reading principals", () => {
  it("keeps people, drops aliases and businesses, and reads 'current' off the disassociation dates by position", async () => {
    const people = await all(cslbPrincipals([FILE]));
    expect(people.map((p) => [p.licence, p.name, p.current])).toEqual([
      ["884201", "Ramon Alvarez", true],
      ["884201", "Dana Okafor", false],
      ["61234", "Luis Mendoza", true],
    ]);
    expect(people[0]!.titles).toEqual(["Officer", "Responsible Managing Officer"]);
  });

  it("reads the same rows however the stream is chunked", async () => {
    const whole = await all(cslbPrincipals([FILE]));
    for (let cut = 1; cut < FILE.length; cut += 7) {
      expect(await all(cslbPrincipals([FILE.slice(0, cut), FILE.slice(cut)])), `cut at ${cut}`).toEqual(whole);
    }
    expect(whole).toHaveLength(3);
  });

  it("refuses a file whose header lost the disassociation column, naming it", async () => {
    const file = [HEADER.replace("DIS-ASSN-DT", "GONE-DT"), ...ROWS].join("\n");
    await expect(all(cslbPrincipals([file]))).rejects.toThrow(CslbHeaderError);
    await expect(all(cslbPrincipals([file]))).rejects.toThrow(/DIS-ASSN-DT/);
  });
});

describe("who to ask for", () => {
  it("prefers the responsible managing officer, then an officer, never someone who left", () => {
    const rmo = { licence: "1", name: "A", titles: ["Officer", "Responsible Managing Officer"], current: true };
    const officer = { licence: "1", name: "B", titles: ["Officer"], current: true };
    const gone = { licence: "1", name: "C", titles: ["Responsible Managing Officer"], current: false };
    expect(preferredPrincipal([officer, rmo, gone])?.name).toBe("A");
    expect(preferredPrincipal([officer, gone])?.name).toBe("B");
    expect(preferredPrincipal([gone])).toBeNull();
    expect(preferredPrincipal([])).toBeNull();
  });

  it("returns one person per wanted licence and counts every row it read", async () => {
    const { owners, rowsRead } = await principalsForLicences([FILE], new Set(["884201", "61234", "999"]));
    expect(rowsRead).toBe(3);
    expect(owners.get("884201")?.name).toBe("Ramon Alvarez");
    expect(owners.get("61234")?.name).toBe("Luis Mendoza");
    expect(owners.has("999")).toBe(false);
  });
});

describe("the surname count", () => {
  it("matches the last word, accent-insensitively, and nothing else", () => {
    expect(surnameOf("Ramón Alvárez")).toBe("alvarez");
    expect(isCommonSpanishSurname("Ramon Alvarez")).toBe(true);
    expect(isCommonSpanishSurname("Dana Okafor")).toBe(false);
    expect(isCommonSpanishSurname("")).toBe(false);
  });
});
