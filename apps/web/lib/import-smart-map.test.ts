import { describe, expect, it } from "vitest";
import { readImportColumnSuggestion } from "@prova/integrations/src/importColumns";
import {
  KIND_FIELD_OPTIONS,
  PARSER_ALIASES,
  detectKind,
  headerKey,
  proposeColumns,
  resolveColumns,
  sampleForModel,
  toMapping,
} from "./import-smart-map";
import { applyColumnMapping } from "./import-mapping";
import { planClientImport, planJobImport, planPhaseCodeImport, type ImportKind } from "./spreadsheet-import";

type Blocks = Parameters<typeof readImportColumnSuggestion>[0];

/**
 * The deterministic layer of the import mapper, over header rows shaped like
 * each system's export. Which of these are read off vendor docs and which
 * are inferred is said on each one and in lib/import-smart-map.ts's header —
 * an "unverified" row tests the MACHINERY on a plausible shape, not the
 * claim that the vendor really writes it.
 */

function fields(kind: ImportKind, header: string[]) {
  return proposeColumns(kind, header).map((p) => p.field);
}

describe("realistic header sets, per system", () => {
  it("Sage 100 Contractor job list [S1, verified labels]: the job NAME, not the job number", () => {
    expect(fields("jobs", ["Job#", "Job Name", "Short Name", "Client", "Address 1", "Status"])).toEqual([
      null, "name", null, "client", null, "status",
    ]);
  });

  it("Sage 100 Contractor receivable clients [S2, verified labels]", () => {
    expect(fields("clients", ["Client Name", "Short Name", "Type", "Address 1", "City", "Phone#", "Email", "Contact Name"])).toEqual([
      "name", null, "type", "address", null, "phone", "email", null,
    ]);
  });

  it("Sage 100 Contractor cost codes [S3, verified labels]", () => {
    expect(fields("costCodes", ["Cost Code#", "Description", "Unit", "Division"])).toEqual(["code", "name", "unit", null]);
  });

  it("Foundation job list [F1, unverified]: Job No. + Description + Customer", () => {
    expect(fields("jobs", ["Job No.", "Description", "Customer", "Contract Amount"])).toEqual([
      null, "name", "client", null,
    ]);
  });

  it("QuickBooks Online customers [Q1, third-party]", () => {
    expect(fields("clients", ["Customer", "Company", "Address", "Phone", "Email", "Attachments", "Open Balance", "Notes"])).toEqual([
      null, "name", "address", "phone", "email", null, null, null,
    ]);
  });

  it("QuickBooks Desktop customer:job list [Q2, unverified]", () => {
    expect(fields("jobs", ["Customer", "Job Description", "Job Status", "Start Date", "Projected End", "Main Phone"])).toEqual([
      "client", "name", "status", "startDate", "endDate", null,
    ]);
    expect(fields("clients", ["Customer", "Main Phone", "Main Email", "Bill to 1"])).toEqual(["name", "phone", "email", "address"]);
  });

  it("Jobber clients [J1] and jobs [J2, unverified]", () => {
    expect(fields("clients", ["Display Name", "First Name", "Last Name", "E-mails", "Main Phone #s", "Billing Street 1"])).toEqual([
      "name", null, null, "email", null, "address",
    ]);
    expect(fields("jobs", ["Job #", "Client name", "Title", "Schedule start date", "Closed date", "Total $"])).toEqual([
      null, "client", "name", "startDate", "endDate", null,
    ]);
  });

  it("a hand-made Excel sheet with abbreviations", () => {
    expect(fields("jobs", ["Project Number", "Cust. Name", "Proj Name", "Start"])).toEqual([
      "name", "client", null, "startDate",
    ]);
    expect(fields("crew", ["EMP NO", "First Name", "Last Name", "SSN Last 4", "Hire Date"])).toEqual([
      "employeeNumber", "legalFirstName", "legalLastName", "identifyingNumberLast4", "hiredOn",
    ]);
  });

  it("labels a parser alias exact and a dictionary hit synonym", () => {
    const [jobName, custName] = proposeColumns("jobs", ["Job Name", "Cust Name"]);
    expect(jobName.confidence).toBe("exact");
    expect(custName.confidence).toBe("synonym");
  });

  it("never gives one field to two columns", () => {
    expect(fields("clients", ["Customer", "Company", "Client"]).filter(Boolean)).toEqual(["name"]);
  });
});

describe("headerKey", () => {
  it("folds #, No., Num and punctuation into one key", () => {
    const one = headerKey("job number");
    for (const header of ["Job #", "Job#", "JOB_NO", "Job No.", "job num"]) expect(headerKey(header)).toBe(one);
  });
});

describe("the dictionary never loses a header the parser reads", () => {
  for (const kind of Object.keys(PARSER_ALIASES) as ImportKind[]) {
    it(`${kind}: every parser alias, alone, is proposed onto its own field`, () => {
      let checked = 0;
      for (const [field, aliases] of Object.entries(PARSER_ALIASES[kind])) {
        for (const alias of aliases) {
          const [proposal] = proposeColumns(kind, [alias]);
          // An alias two fields share goes to the earlier field, the same
          // rule mapColumns has — it must still land on SOME field.
          expect(proposal.field, `${kind}.${field} "${alias}"`).not.toBeNull();
          checked += 1;
        }
      }
      expect(checked).toBe(Object.values(PARSER_ALIASES[kind]).flat().length);
      expect(checked).toBeGreaterThan(2);
    });
  }
});

describe("detectKind", () => {
  it.each([
    [["Job#", "Job Name", "Client", "Status"], "jobs"],
    [["Customer", "Email", "Phone", "Address"], "clients"],
    [["Name", "Email"], "clients"],
    [["First Name", "Last Name", "Phone", "Hire Date"], "crew"],
    [["Cost Code#", "Description", "Unit"], "costCodes"],
    [["Job No.", "Description", "Customer"], "jobs"],
    [["Display Name", "E-mails", "Main Phone"], "clients"],
  ] as [string[], ImportKind][])("%j reads as %s", (header, kind) => {
    expect(detectKind(header)).toBe(kind);
  });

  it("prefers a kind whose required fields are complete — a jobs file with no job name can't import a row", () => {
    // Raw count would say jobs (Client + two dates); completeness says
    // clients (its only required field, plus Email), which would import.
    expect(detectKind(["Company", "Email", "Start Date", "End Date"])).toBe("clients");
  });

  it("says nothing when no kind's required field is there", () => {
    expect(detectKind(["Open Balance", "Attachments"])).toBeNull();
  });
});

describe("what reaches the planner", () => {
  it("a Sage job list imports Job Name as the name — the Job# column is skipped, not read back", () => {
    const csv = "Job#,Job Name,Client\n1001,Tower,Acme\n1002,Harbor,Zenith";
    const header = ["Job#", "Job Name", "Client"];
    const labels = Object.fromEntries(KIND_FIELD_OPTIONS.jobs.map((o) => [o.field, o.label]));
    const mapped = applyColumnMapping(csv, toMapping(proposeColumns("jobs", header)), labels, { skipUnmapped: true });
    expect(mapped.split("\n")[0]).toBe("Skipped: Job#,Job name,Client");
    expect(planJobImport(mapped, [], []).create.map((row) => row.name)).toEqual(["Tower", "Harbor"]);
    // Without skipUnmapped the parser grabs Job# first, left to right — the bug.
    const unskipped = applyColumnMapping(csv, toMapping(proposeColumns("jobs", header)), labels);
    expect(planJobImport(unskipped, [], []).create.map((row) => row.name)).toEqual(["1001", "1002"]);
  });

  it("a QuickBooks customer list imports Company as the client and leaves the rest alone", () => {
    const csv = "Customer,Company,Phone,Open Balance\nJo Smith,Acme Builders,555-0100,$1200";
    const header = csv.split("\n")[0].split(",");
    const labels = Object.fromEntries(KIND_FIELD_OPTIONS.clients.map((o) => [o.field, o.label]));
    const mapped = applyColumnMapping(csv, toMapping(proposeColumns("clients", header)), labels, { skipUnmapped: true });
    const plan = planClientImport(mapped, []);
    expect(plan.create.map((row) => [row.name, row.phone])).toEqual([["Acme Builders", "555-0100"]]);
  });

  it("a skipped column stays skipped even when its header is a parser alias", () => {
    const csv = "Code,Name,Unit\n04112,Framing,SF";
    const columns = resolveColumns(proposeColumns("costCodes", ["Code", "Name", "Unit"]), {}, [{ index: 2, field: null }]);
    const labels = Object.fromEntries(KIND_FIELD_OPTIONS.costCodes.map((o) => [o.field, o.label]));
    const mapped = applyColumnMapping(csv, toMapping(columns), labels, { skipUnmapped: true });
    expect(planPhaseCodeImport(mapped, []).create[0].unit).toBeNull();
  });
});

describe("resolveColumns — the person's pick always wins", () => {
  const base = proposeColumns("jobs", ["Job Name", "Client", "Notes", "Region"]);

  it("fills an empty column from the model, never one the dictionary placed", () => {
    const out = resolveColumns(base, { 1: "status", 3: "status" }, []);
    expect(out[1]).toEqual({ field: "client", confidence: "exact" });
    expect(out[3]).toEqual({ field: "status", confidence: "ai" });
  });

  it("drops a model guess for a field already placed", () => {
    expect(resolveColumns(base, { 3: "client" }, [])[3].field).toBeNull();
  });

  it("a pick moves its field off the column that held it, and the latest pick wins", () => {
    const out = resolveColumns(base, {}, [
      { index: 3, field: "client" },
      { index: 2, field: "client" },
    ]);
    expect(out.map((c) => c.field)).toEqual(["name", null, "client", null]);
    expect(out[2].confidence).toBe("you");
  });

  it("a skip beats both the dictionary and the model", () => {
    const out = resolveColumns(base, { 3: "status" }, [{ index: 0, field: null }, { index: 3, field: null }]);
    expect(out[0].field).toBeNull();
    expect(out[3].field).toBeNull();
  });
});

describe("what the model may see", () => {
  it("is at most 5 rows, every digit masked, cells cut short", () => {
    const out = sampleForModel("SSN", ["123-45-6789", "2", "3", "4", "5", "6", "x".repeat(200)]);
    expect(out.samples).toEqual(["###-##-####", "#", "#", "#", "#"]);
    expect(sampleForModel("Notes", ["y".repeat(200)]).samples[0]).toHaveLength(80);
  });
});

describe("readImportColumnSuggestion — a model answer is filtered before it reaches the screen", () => {
  const block = (input: unknown) =>
    [{ type: "tool_use", id: "t", name: "map_columns", input }] as unknown as Blocks;

  it("keeps only asked-about columns, real fields, one column per field", () => {
    const out = readImportColumnSuggestion(
      block({
        matches: [
          { column: 2, field: "status" },
          { column: 3, field: "status" },
          { column: 9, field: "scope" },
          { column: 3, field: "contractValue" },
          { column: 4, field: "scope" },
        ],
      }),
      ["status", "scope"],
      [2, 3, 4],
    );
    expect(out).toEqual({ 2: "status", 4: "scope" });
  });

  it("throws when the model answered in prose", () => {
    expect(() => readImportColumnSuggestion([{ type: "text", text: "hi" }] as unknown as Blocks, [], [])).toThrow();
  });
});
