import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { EXPORT_DATASETS, EXPORT_INTERNAL_MODELS, EXPORT_OMISSIONS } from "./export";

/**
 * Every model in the schema is accounted for by the export, exactly once.
 *
 * `export-coverage.test.ts` checks that what the page CLAIMS is missing is
 * really missing. It could not check the other direction — that everything
 * missing is claimed — and three tables in one week walked through that gap:
 * `ExperienceModRate` (#306), `LienDeadline` (#307) and `BidPursuit` (#308)
 * each shipped in no dataset and on no omission line, and each was caught by
 * a reviewer reading the diff rather than by anything that runs.
 * `CrewScheduleDay` (#304) was not caught at all. On its first run this file
 * found three more that had been sitting there longer: signed T&M tickets,
 * the outbound message log, and phase codes.
 *
 * So a new model now fails the build until somebody decides which of three
 * things it is: exported (a dataset), a record the page admits it does not
 * carry (`EXPORT_OMISSIONS`), or the app's own bookkeeping
 * (`EXPORT_INTERNAL_MODELS`, with a reason). Exactly one — a model in two
 * buckets is a page contradicting itself.
 */

const SCHEMA_DIR = join(__dirname, "../../../packages/db/prisma/schema");

function schemaFiles(): string[] {
  return readdirSync(SCHEMA_DIR).filter((f) => f.endsWith(".prisma"));
}

function schemaText(): string {
  return schemaFiles()
    .map((f) => readFileSync(join(SCHEMA_DIR, f), "utf8"))
    .join("\n");
}

/** The census's own parse. */
function parseModels(text: string): string[] {
  return [...text.matchAll(/^model\s+(\w+)\s*\{/gm)].map((m) => m[1]);
}

/**
 * The independent count, by a method that shares no pattern with the one
 * above: every line whose first word is `model`. If the regex stops
 * matching — a formatting change, a typo in an edit — the two disagree and
 * the census fails with both numbers instead of reasoning about an empty set.
 */
function countModelLines(text: string): number {
  return text.split("\n").filter((line) => line.split(/\s/)[0] === "model").length;
}

type Buckets = {
  datasets: string[];
  omissions: string[];
  internal: string[];
};

function currentBuckets(): Buckets {
  return {
    datasets: EXPORT_DATASETS.map((d) => d.model[0].toUpperCase() + d.model.slice(1)),
    omissions: EXPORT_OMISSIONS.flatMap((o) => o.models),
    internal: Object.keys(EXPORT_INTERNAL_MODELS),
  };
}

/** Which models are in no bucket, which are in more than one, and which
 * bucket entries name no model at all. */
function account(models: string[], buckets: Buckets) {
  const inBucket = new Map<string, string[]>();
  for (const [bucket, names] of Object.entries(buckets)) {
    for (const name of names) inBucket.set(name, [...(inBucket.get(name) ?? []), bucket]);
  }
  const known = new Set(models);
  return {
    unaccounted: models.filter((m) => !inBucket.has(m)),
    doubled: [...inBucket].filter(([, where]) => where.length > 1).map(([m, where]) => `${m} (${where.join(" + ")})`),
    phantom: [...inBucket.keys()].filter((m) => !known.has(m)),
  };
}

describe("the schema parse is not vacuous", () => {
  it("parses as many models as there are `model` lines", () => {
    const text = schemaText();
    const parsed = parseModels(text);
    expect(
      parsed.length,
      `the schema has ${countModelLines(text)} model lines and this file parsed ${parsed.length}`,
    ).toBe(countModelLines(text));
    // A floor as well as an equality: a schema directory that stopped
    // resolving would make both counts zero and equal.
    expect(schemaFiles().length).toBeGreaterThan(10);
    expect(parsed.length).toBeGreaterThan(90);
    expect(new Set(parsed).size).toBe(parsed.length);
  });

  it("the parse and the count DISAGREE on a model the regex cannot see", () => {
    // The mutation, kept as a test: the size check above is only worth
    // something if a real divergence makes it fail.
    const text = "model Job {\n}\nmodel  Spaced{\n}\nmodel\tTabbed {\n}\n";
    expect(parseModels(text)).toEqual(["Job", "Spaced", "Tabbed"]);
    expect(countModelLines(text)).toBe(3);
    const broken = [...text.matchAll(/^model (\w+) \{/gm)].map((m) => m[1]);
    expect(broken.length).not.toBe(countModelLines(text));
  });
});

describe("every model is accounted for by the export", () => {
  it("EVERY MODEL IS IN EXACTLY ONE BUCKET", () => {
    const { unaccounted, doubled } = account(parseModels(schemaText()), currentBuckets());
    expect(
      unaccounted,
      "these models are in no export dataset, not in EXPORT_OMISSIONS and not in " +
        "EXPORT_INTERNAL_MODELS — decide which, in lib/export.ts. A real record belongs " +
        "in a dataset or an omission line; only the app's own bookkeeping is internal",
    ).toEqual([]);
    expect(doubled, "these models are claimed by more than one bucket").toEqual([]);
  });

  it("names no model that does not exist", () => {
    const { phantom } = account(parseModels(schemaText()), currentBuckets());
    expect(phantom, "a renamed or deleted model is still listed in lib/export.ts").toEqual([]);
  });

  it("gives every internal model a reason", () => {
    for (const [model, reason] of Object.entries(EXPORT_INTERNAL_MODELS)) {
      expect(reason.trim().length, `${model} has a reason`).toBeGreaterThan(8);
    }
  });

  it("carries the crew schedule — the table that started this file", () => {
    expect(currentBuckets().datasets).toContain("CrewScheduleDay");
  });

  it("reports a new model, a double claim and a phantom — the census can fail", () => {
    const buckets: Buckets = { datasets: ["Job"], omissions: ["Job", "Gone"], internal: [] };
    const result = account(["Job", "BrandNew"], buckets);
    expect(result.unaccounted).toEqual(["BrandNew"]);
    expect(result.doubled).toEqual(["Job (datasets + omissions)"]);
    expect(result.phantom).toEqual(["Gone"]);
  });
});
