import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { EXPORT_DATASETS, csvCell, datasetByKey, exportFilename, toCsv } from "./export";

describe("csv cells", () => {
  it("leaves ordinary text alone", () => {
    expect(csvCell("Level 2 corridor")).toBe("Level 2 corridor");
  });

  it("quotes commas, quotes and newlines", () => {
    expect(csvCell("Smith, John")).toBe('"Smith, John"');
    expect(csvCell('5/8" Type X')).toBe('"5/8"" Type X"');
    expect(csvCell("line one\nline two")).toBe('"line one\nline two"');
  });

  it("writes nothing for null and undefined rather than the word", () => {
    // "null" in a cell reads as a value somebody typed.
    expect(csvCell(null)).toBe("");
    expect(csvCell(undefined)).toBe("");
  });

  it("renders dates as ISO and objects as JSON", () => {
    expect(csvCell(new Date("2026-09-02T00:00:00.000Z"))).toBe("2026-09-02T00:00:00.000Z");
    expect(csvCell({ a: 1 })).toBe('"{""a"":1}"');
  });

  it("RENDERS A DECIMAL AS A NUMBER, not as a JSON string", () => {
    // Every money and quantity column comes back from Prisma as a Decimal,
    // which is an object — so the JSON branch would write """4200""" into
    // the cell. Stood in for here by the same duck type the code checks,
    // so this stays a database-free test.
    const decimalLike = { toFixed: (n: number) => (4200).toFixed(n), toString: () => "4200.00" };
    expect(csvCell(decimalLike)).toBe("4200.00");
  });
});

describe("formula injection", () => {
  // A description reading =1+1 is a string in the database and an executed
  // formula the moment Excel opens the file. Values reach these columns from
  // CSV imports and from GC documents, so "only what our users typed" is not
  // a defence.
  it("neutralises every character a spreadsheet treats as a formula", () => {
    // Compared after unwrapping the RFC-4180 quotes, because the two rules
    // interact: "\r" trips the quoting rule too, so the neutralised cell is
    // "'\r..." and does not START with the apostrophe. My first version of
    // this test asserted startsWith and failed on exactly that — the code
    // was right and the assertion was naive about its own output format.
    const unquoted = (cell: string) =>
      cell.startsWith('"') ? cell.slice(1, -1).replace(/""/g, '"') : cell;

    for (const lead of ["=", "+", "-", "@", "\t", "\r"]) {
      const payload = `${lead}cmd|'/c calc'!A1`;
      expect(unquoted(csvCell(payload)), `lead ${JSON.stringify(lead)}`).toBe(`'${payload}`);
    }
  });

  it("still quotes a neutralised value that also contains a comma", () => {
    expect(csvCell("=SUM(A1,A2)")).toBe(`"'=SUM(A1,A2)"`);
  });

  it("does not touch a value that merely contains those characters later", () => {
    // Negative numbers are the case worth protecting: a leading minus IS
    // neutralised, but an ordinary description is not mangled for having a
    // hyphen in the middle of it.
    expect(csvCell("As-built drawings")).toBe("As-built drawings");
  });

  it("neutralises a negative number, which is the accepted cost of the rule", () => {
    // Documented rather than hidden: the CSV is not byte-faithful, which is
    // exactly why the JSON export exists beside it and does not do this.
    expect(csvCell(-4200)).toBe("'-4200");
  });
});

describe("a whole csv", () => {
  it("puts the header first and follows the column order", () => {
    const csv = toCsv(["b", "a"], [{ a: 1, b: 2 }]);
    expect(csv).toBe("b,a\n2,1\n");
  });

  it("writes an empty cell for a column the row does not have", () => {
    expect(toCsv(["a", "missing"], [{ a: 1 }])).toBe("a,missing\n1,\n");
  });

  it("still emits the header when there are no rows", () => {
    // An empty file and an empty table are different facts. The header says
    // "this table exists and is empty" rather than "something went wrong".
    expect(toCsv(["a", "b"], [])).toBe("a,b\n");
  });
});

/* ------------------------------------------------------- the actual guard */

const SCHEMA_DIR = join(__dirname, "../../../packages/db/prisma/schema");

function schemaText(): string {
  return readdirSync(SCHEMA_DIR)
    .filter((f) => f.endsWith(".prisma"))
    .map((f) => readFileSync(join(SCHEMA_DIR, f), "utf8"))
    .join("\n");
}

/** Field names that carry a credential, a bearer token, or an identity
 * belonging to another system. Deliberately broad: a false positive costs
 * somebody renaming a column in this test, a false negative ships a key. */
const CREDENTIAL_FIELD = /^(.*(token|secret|password|apiKey)|access|refresh|clerkId|encrypted.*)$/i;

function credentialFieldsInSchema(): string[] {
  const found = new Set<string>();
  for (const line of schemaText().split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("//") || trimmed.startsWith("@@")) continue;
    const name = trimmed.split(/\s+/)[0];
    if (/^[a-z]\w*$/.test(name) && CREDENTIAL_FIELD.test(name)) found.add(name);
  }
  return [...found];
}

describe("no export column is ever a credential", () => {
  it("finds the credential columns that exist, so the guard is not vacuous", () => {
    // A guard that passes because it found nothing to check is not a guard.
    // These are the ones in the schema today; the point of reading the file
    // rather than listing them here is that a NEW one is caught too.
    const found = credentialFieldsInSchema();
    expect(found).toEqual(
      expect.arrayContaining([
        "accessToken",
        "refreshToken",
        "portalToken",
        "encryptedAccessToken",
        "encryptedRefreshToken",
        "clerkId",
      ]),
    );
  });

  it("EXPORTS NONE OF THEM", () => {
    // Two of these are plaintext in the database. portalToken and
    // SignatureRequest.token are live bearer keys — a copy in a spreadsheet
    // is a copy that leaks. If this fails because a column was added to a
    // dataset above, the column is the bug, not this test.
    const credentials = credentialFieldsInSchema();
    const leaked: string[] = [];
    for (const dataset of EXPORT_DATASETS) {
      for (const column of dataset.columns) {
        if (credentials.includes(column)) leaked.push(`${dataset.key}.${column}`);
      }
    }
    expect(leaked).toEqual([]);
  });

  it("exports no bare `token` column either", () => {
    // SignatureRequest.token is named just `token`, which the pattern above
    // catches only through its `.*token` arm. Asserted separately so a change
    // to that regex cannot quietly stop covering it.
    const columns = EXPORT_DATASETS.flatMap((d) => d.columns.map((c) => c.toLowerCase()));
    expect(columns).not.toContain("token");
  });
});

describe("the dataset registry holds together", () => {
  it("has unique keys", () => {
    const keys = EXPORT_DATASETS.map((d) => d.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("names a model that actually exists in the schema", () => {
    // A typo here is a runtime crash on the one feature that must not fail
    // when somebody is trying to leave.
    const models = new Set([...schemaText().matchAll(/^model (\w+) \{/gm)].map((m) => m[1]));
    for (const dataset of EXPORT_DATASETS) {
      const pascal = dataset.model[0].toUpperCase() + dataset.model.slice(1);
      expect(models, `${dataset.key} names model ${pascal}`).toContain(pascal);
    }
  });

  it("EVERY dataset narrows to one company", () => {
    // The worst possible bug in a data-export feature is handing somebody
    // another company's rows. Several of these models have no companyId of
    // their own and reach it through a relation, so this walks the where
    // clause and insists it bottoms out at companyId somewhere.
    const reachesCompany = (value: unknown): boolean => {
      if (typeof value !== "object" || value === null) return false;
      return Object.entries(value).some(
        ([key, child]) => key === "companyId" || reachesCompany(child),
      );
    };
    for (const dataset of EXPORT_DATASETS) {
      expect(reachesCompany(dataset.scope("company-1")), `${dataset.key} is scoped`).toBe(true);
    }
  });

  it("says something about every dataset, because a filename is not documentation", () => {
    for (const dataset of EXPORT_DATASETS) {
      expect(dataset.note.length, `${dataset.key} has a note`).toBeGreaterThan(0);
      expect(dataset.label.length).toBeGreaterThan(0);
    }
  });

  it("looks datasets up by key", () => {
    expect(datasetByKey("jobs")?.model).toBe("job");
    expect(datasetByKey("nope")).toBeUndefined();
  });
});

describe("filenames", () => {
  it("carries the date so two exports do not collide", () => {
    expect(exportFilename("jobs", new Date("2026-09-02T12:00:00.000Z"), "csv")).toBe(
      "prova-export-jobs-2026-09-02.csv",
    );
  });
});
