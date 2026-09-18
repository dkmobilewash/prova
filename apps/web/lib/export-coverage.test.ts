import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";
import {
  ExportCoverageIntro,
  ExportOmissionsPanel,
  exportAllLabel,
} from "@/components/ExportCoverage";
import {
  EXPORT_DATASETS,
  EXPORT_OMISSIONS,
  EXPORT_WITHHELD,
  type ExportDataset,
  exportCoverageNote,
  exportNotIncludedLines,
} from "./export";

/**
 * Does the export page describe the export it actually performs?
 *
 * It did not. "Everything <company> has put into C Stream" sat over a
 * button reading "Download everything", above 18 tables out of a 93-model
 * schema, with three omissions disclosed — all three about keys and files,
 * and one of them ("documents appear as their metadata rows") simply false.
 * Nothing could have caught it: the copy made no checkable claim. A
 * sentence with no number in it cannot be off by any amount.
 *
 * So the copy now counts the registry and names the missing categories by
 * MODEL, and this file holds both halves to something that cannot drift
 * with them — the rendered output for the count, the .prisma files for the
 * names.
 */

const SCHEMA_DIR = join(__dirname, "../../../packages/db/prisma/schema");

function schemaText(): string {
  return readdirSync(SCHEMA_DIR)
    .filter((f) => f.endsWith(".prisma"))
    .map((f) => readFileSync(join(SCHEMA_DIR, f), "utf8"))
    .join("\n");
}

const schemaModels = (): string[] =>
  [...schemaText().matchAll(/^model (\w+) \{/gm)].map((m) => m[1]);

const exportedModels = (): string[] =>
  EXPORT_DATASETS.map((d) => d.model[0].toUpperCase() + d.model.slice(1));

const fakeDataset = (key: string): ExportDataset => ({
  key,
  model: "job",
  label: "Fake",
  note: "Only ever exists inside a test.",
  columns: ["id"],
  scope: (companyId: string) => ({ companyId }),
});

/** Adds a dataset for the length of one assertion. The registry is module
 * state shared with every other test in this run, so it is always put back. */
function withExtraDataset<T>(body: () => T): T {
  EXPORT_DATASETS.push(fakeDataset("zz-test-only"));
  try {
    return body();
  } finally {
    const i = EXPORT_DATASETS.findIndex((d) => d.key === "zz-test-only");
    if (i >= 0) EXPORT_DATASETS.splice(i, 1);
  }
}

afterEach(() => {
  expect(EXPORT_DATASETS.some((d) => d.key === "zz-test-only")).toBe(false);
});

/* ---------------------------------------- the number is read, not written */

describe("the page counts the tables it is about to hand over", () => {
  const render = () =>
    renderToStaticMarkup(createElement(ExportCoverageIntro, { companyName: "Kestrel Drywall" }));

  it("renders the registry's length", () => {
    // Floor first: a registry of one would make every assertion below pass
    // for the wrong reason.
    expect(EXPORT_DATASETS.length).toBeGreaterThan(5);
    expect(render()).toContain(`The ${EXPORT_DATASETS.length} tables Kestrel Drywall`);
  });

  it("THE RENDERED NUMBER FOLLOWS THE REGISTRY", () => {
    // The mutation, run as a test rather than by hand: add a dataset and the
    // sentence has to move. A hardcoded 18 passes the test above and fails
    // this one, which is the entire reason this component exists separately
    // from the page.
    const before = EXPORT_DATASETS.length;
    expect(render()).not.toContain(`The ${before + 1} tables`);
    withExtraDataset(() => {
      const html = render();
      expect(html).toContain(`The ${before + 1} tables Kestrel Drywall`);
      expect(html).not.toContain(`The ${before} tables`);
    });
  });

  it("the download button counts them too, and the rows it was given", () => {
    expect(exportAllLabel(1234)).toBe(
      `Download all ${EXPORT_DATASETS.length} tables (1,234 rows)`,
    );
    withExtraDataset(() => {
      expect(exportAllLabel(0)).toBe(`Download all ${EXPORT_DATASETS.length} tables (0 rows)`);
    });
  });

  it("the JSON bundle says the same thing, because the file outlives the page", () => {
    expect(exportCoverageNote()).toContain(`${EXPORT_DATASETS.length} tables`);
    withExtraDataset(() => {
      expect(exportCoverageNote()).toContain(`${EXPORT_DATASETS.length} tables`);
    });
  });
});

describe("the page does not make its own coverage claim", () => {
  const pageSource = readFileSync(
    join(__dirname, "../app/(app)/settings/export/page.tsx"),
    "utf8",
  );

  it("read the page it is asserting about", () => {
    // A path that stopped resolving would make every assertion below vacuous
    // — the failure mode this codebase keeps meeting, a check answering a
    // question nobody asked.
    expect(pageSource.length).toBeGreaterThan(1000);
    expect(pageSource).toContain("export default async function ExportPage");
  });

  it("delegates the intro, the button label and the omissions", () => {
    expect(pageSource).toContain("<ExportCoverageIntro");
    expect(pageSource).toContain("exportAllLabel(total)");
    expect(pageSource).toContain("<ExportOmissionsPanel />");
  });

  it("no longer promises everything", () => {
    const rendered = pageSource.split("return (")[1] ?? "";
    expect(rendered.toLowerCase()).not.toContain("download everything");
    expect(rendered).not.toContain("Everything {company.name}");
  });
});

/* ------------------------------------- the omissions are real and checked */

describe("what the page says is missing, is missing", () => {
  it("parses the schema without silently matching nothing", () => {
    // Counted a second way, by a method that cannot share a bug with the
    // regex above: if the pattern ever stops matching, this says so instead
    // of letting an empty set satisfy every loop below.
    const byRegex = schemaModels();
    const byLine = schemaText()
      .split("\n")
      .filter((l) => l.startsWith("model ")).length;
    expect(byRegex.length).toBe(byLine);
    expect(byRegex.length).toBeGreaterThan(50);
  });

  it("names models that actually exist", () => {
    const models = new Set(schemaModels());
    for (const omission of EXPORT_OMISSIONS) {
      expect(omission.models.length, `${omission.key} names something`).toBeGreaterThan(0);
      for (const model of omission.models) {
        expect(models, `${omission.key} names ${model}`).toContain(model);
      }
    }
  });

  it("NAMES NOTHING THAT IS ACTUALLY EXPORTED", () => {
    // The claim is "this is not in your file". The day one of these becomes
    // a dataset, the page starts under-promising and this fails — which is
    // the only way a disclosure list stays true on its own.
    const exported = new Set(exportedModels());
    const wrong: string[] = [];
    for (const omission of EXPORT_OMISSIONS) {
      for (const model of omission.models) {
        if (exported.has(model)) wrong.push(`${omission.key}.${model}`);
      }
    }
    expect(wrong).toEqual([]);
  });

  it("names each model once", () => {
    const all = EXPORT_OMISSIONS.flatMap((o) => o.models);
    expect(new Set(all).size).toBe(all.length);
  });

  it("names the four a person was actually caught out by", () => {
    // From the week-long run-the-business simulation: these are records
    // somebody went looking for in the export, having been told it held
    // everything, and did not find. Listed explicitly so the disclosure
    // cannot be quietly generalised back into vagueness.
    const all = EXPORT_OMISSIONS.flatMap((o) => o.models);
    for (const model of [
      "RetainageRelease",
      "CompanyBond",
      "CompanyLicense",
      "ComplianceDocument",
    ]) {
      expect(all, `${model} is disclosed`).toContain(model);
    }
  });

  it("discloses lien deadlines, which the export does not carry", () => {
    // Review finding on cyrus/lien-deadlines: LienDeadline was added to the
    // schema, to no dataset, and to no line here — so the page told a
    // customer their file held everything but these categories, while a
    // record of which legal notices went out, and when, quietly stayed
    // behind. Same defect this file exists for, one table later.
    const all = EXPORT_OMISSIONS.flatMap((o) => o.models);
    expect(all).toContain("LienDeadline");
  });

  it("discloses the pre-bid chase list, which is not a dataset", () => {
    // BidPursuit shipped with /pipeline's chase list and no line here, so
    // the export quietly left out months of somebody's chasing — the same
    // defect as a costing row quietly leaving out a cost.
    const all = EXPORT_OMISSIONS.flatMap((o) => o.models);
    expect(exportedModels()).not.toContain("BidPursuit");
    expect(all, "BidPursuit is disclosed").toContain("BidPursuit");
  });

  it("holds the withheld list to columns that are real credentials", () => {
    const fieldNames = new Set(
      schemaText()
        .split("\n")
        .map((l) => l.trim().split(/\s+/)[0])
        .filter((n) => /^[a-z]\w*$/.test(n)),
    );
    const datasetColumns = new Set(EXPORT_DATASETS.flatMap((d) => d.columns));
    expect(EXPORT_WITHHELD.length).toBeGreaterThan(0);
    for (const withheld of EXPORT_WITHHELD) {
      expect(withheld.columns.length, `${withheld.key} names a column`).toBeGreaterThan(0);
      for (const column of withheld.columns) {
        expect(fieldNames, `${withheld.key} names field ${column}`).toContain(column);
        expect(
          /(token|secret|password|apiKey)/i.test(column),
          `${withheld.key}.${column} is a credential`,
        ).toBe(true);
        expect(datasetColumns, `${column} is not exported`).not.toContain(column);
      }
    }
    // The one a reader is most likely to go looking for.
    expect(EXPORT_WITHHELD.flatMap((w) => w.columns)).toContain("portalToken");
  });
});

/* ------------------------------------------- and the panel renders it all */

describe("the omissions panel", () => {
  const html = () => renderToStaticMarkup(createElement(ExportOmissionsPanel));

  it("renders every entry in both lists", () => {
    const rendered = html();
    for (const item of [...EXPORT_WITHHELD, ...EXPORT_OMISSIONS]) {
      // Titles carry apostrophes and dashes through HTML escaping; the key
      // phrase is enough to prove the entry reached the page.
      expect(rendered, `${item.key} is on the page`).toContain(item.title);
    }
    const items = rendered.match(/<li>/g) ?? [];
    expect(items.length).toBe(EXPORT_WITHHELD.length + EXPORT_OMISSIONS.length);
  });

  it("is fair about what it is not listing", () => {
    // Counters, sync logs and notification rows are most of the numerical
    // gap between 18 tables and 93 models, and nobody wants them. Saying so
    // is the difference between honesty and alarm.
    expect(html()).toContain("bookkeeping the app does for itself");
  });

  it("the JSON bundle's notIncluded carries the same lines", () => {
    const lines = exportNotIncludedLines();
    expect(lines.length).toBe(EXPORT_WITHHELD.length + EXPORT_OMISSIONS.length);
    for (const item of [...EXPORT_WITHHELD, ...EXPORT_OMISSIONS]) {
      expect(
        lines.some((l) => l.startsWith(`${item.title} — `)),
        `${item.key} is in the file, not only on the page`,
      ).toBe(true);
    }
  });
});
