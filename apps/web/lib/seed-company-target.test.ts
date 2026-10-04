import { describe as group, expect, it } from "vitest";
// The seed script is plain .mjs in packages/db so a workflow can run it with
// bare node. Tested from here because this is where vitest lives — same
// arrangement as db-target.test.ts.
import {
  companyNameKey,
  companyTargetRequest,
  resolveCompanyTarget,
} from "../../../packages/db/scripts/company-target.mjs";

/**
 * The names here are the real shapes, not placeholders. `lib/auth.ts` builds
 * a first-sign-in company as `${name}'s Company`, so two people — or one
 * person with two email addresses — collide on a generated name by design.
 * That collision is what this resolver exists to refuse.
 */
const cyrus = { id: "cmp_1", name: "Cyrus's Company" };
const cyrusAgain = { id: "cmp_2", name: "cyrus's company" };
const drywall = { id: "cmp_3", name: "Cyrus Drywall Inc" };
const oldest = { id: "cmp_0", name: "Prova Interiors" };

const lines = (r: { lines?: string[]; error?: string[] }) => (r.lines ?? r.error ?? []).join("\n");

group("reading the request off the environment", () => {
  it("is the oldest company when neither variable is given", () => {
    // The historical behaviour, and it must not move: an empty environment
    // resolves the same way it did before this module existed.
    expect(companyTargetRequest({})).toEqual({ by: "oldest" });
    expect(companyTargetRequest({ SEED_COMPANY_ID: "", SEED_COMPANY_NAME: "  " })).toEqual({
      by: "oldest",
    });
  });

  it("takes a name on its own", () => {
    expect(companyTargetRequest({ SEED_COMPANY_NAME: "  Cyrus's Company " })).toEqual({
      by: "name",
      name: "Cyrus's Company",
    });
  });

  it("reports both being given as a conflict rather than letting one win", () => {
    // Neither quietly wins. The realistic way to get here is a name typed
    // into a form that still held an id from the previous run, so "the id
    // wins" means a stale id decides the target while the log reads as
    // though the name had.
    expect(companyTargetRequest({ SEED_COMPANY_ID: "cmp_1", SEED_COMPANY_NAME: "Other Co" })).toEqual(
      { by: "conflict", id: "cmp_1", name: "Other Co" },
    );
  });
});

group("the name comparison key", () => {
  it("folds case, surrounding and internal whitespace", () => {
    expect(companyNameKey("  Cyrus's   Company ")).toBe(companyNameKey("cyrus's company"));
  });

  it("folds a typographic apostrophe onto an ASCII one", () => {
    // The stored name comes from a name typed into Clerk, and macOS/iOS
    // substitute U+2019 as you type. Two spellings that look identical on
    // screen have to compare equal or the feature is unusable by the one
    // person it is for.
    expect(companyNameKey("Cyrus’s Company")).toBe(companyNameKey("Cyrus's Company"));
  });

  it("does NOT fold two different names together", () => {
    // The boundary: everything normalised above is a difference between two
    // spellings of one name. A substring rule would cross this line, and a
    // single wrong match has no backstop — it looks exactly like success.
    expect(companyNameKey("Cyrus")).not.toBe(companyNameKey("Cyrus Drywall Inc"));
    expect(companyNameKey("Cyrus's Company")).not.toBe(companyNameKey("Cyrus's Company LLC"));
  });
});

group("resolving by name", () => {
  it("finds the one match, case-insensitively", () => {
    const r = resolveCompanyTarget({ by: "name", name: "cyrus's COMPANY" }, [oldest, cyrus, drywall]);
    expect(r.company).toBe(cyrus);
    expect(lines(r)).toContain("resolved by NAME");
    expect(lines(r)).toContain("1 of 3 companies matched");
  });

  it("REFUSES when two companies share the name, and prints both ids", () => {
    // Never the first. A demo seed writes ~50 models into whatever it picks,
    // and picking wrong is not something anybody notices afterwards.
    const r = resolveCompanyTarget({ by: "name", name: "Cyrus's Company" }, [cyrus, cyrusAgain]);
    expect(r.company).toBeUndefined();
    expect(r.error).toBeTruthy();
    expect(lines(r)).toContain("matches 2 companies");
    expect(lines(r)).toContain("cmp_1");
    expect(lines(r)).toContain("cmp_2");
    expect(lines(r)).toContain("company_id");
    // The refusal has to say where to look, because nothing in the app does.
    expect(lines(r)).toContain("list-companies");
  });

  it("refuses a name that matches nothing, and lists what is really there", () => {
    // The list IS the recovery path: a person who mistyped cannot look the
    // id up anywhere in the app, so the run's own log has to show them the
    // spellings they can copy.
    const r = resolveCompanyTarget({ by: "name", name: "Cyruss Company" }, [oldest, cyrus]);
    expect(r.company).toBeUndefined();
    expect(lines(r)).toContain('no company is named "Cyruss Company"');
    expect(lines(r)).toContain("Prova Interiors (cmp_0)");
    expect(lines(r)).toContain("Cyrus's Company (cmp_1)");
  });

  it("never substring-matches, even when exactly one company would match", () => {
    // The one-match case is the dangerous one, because it cannot be told
    // apart from a correct answer by reading the output.
    const r = resolveCompanyTarget({ by: "name", name: "Cyrus" }, [oldest, drywall]);
    expect(r.company).toBeUndefined();
    expect(lines(r)).toContain("no company is named");
  });

  it("says the database is empty rather than listing nothing", () => {
    const r = resolveCompanyTarget({ by: "name", name: "Anything" }, []);
    expect(r.company).toBeUndefined();
    expect(lines(r)).toContain("no companies at all");
    expect(lines(r)).toContain("Sign in to the app once first");
  });
});

group("resolving by id", () => {
  it("takes the row it was handed", () => {
    const r = resolveCompanyTarget({ by: "id", id: "cmp_1" }, [cyrus]);
    expect(r.company).toBe(cyrus);
    expect(lines(r)).toContain("resolved by ID");
  });

  it("refuses an id nothing matches, and points at the name input", () => {
    const r = resolveCompanyTarget({ by: "id", id: "cmp_nope" }, [null]);
    expect(r.company).toBeUndefined();
    expect(lines(r)).toContain('no company has id "cmp_nope"');
    expect(lines(r)).toContain("company_name");
  });

});

group("refusing two answers to one question", () => {
  it("names both inputs and picks neither", () => {
    const r = resolveCompanyTarget({ by: "conflict", id: "cmp_1", name: "Cyrus's Company" }, [cyrus]);
    expect(r.company).toBeUndefined();
    expect(lines(r)).toContain("BOTH company_id");
    expect(lines(r)).toContain("cmp_1");
    expect(lines(r)).toContain("Cyrus's Company");
    expect(lines(r)).toContain("Nothing has been written");
  });

  it("refuses even when the two inputs agree", () => {
    // A resolver that resolved an agreeing pair would be teaching the
    // operator that passing both is fine, and the next pair will not agree.
    const r = resolveCompanyTarget({ by: "conflict", id: cyrus.id, name: cyrus.name }, [cyrus]);
    expect(r.company).toBeUndefined();
  });
});

group("resolving the old way", () => {
  it("takes the single row the caller fetched", () => {
    const r = resolveCompanyTarget({ by: "oldest" }, [oldest]);
    expect(r.company).toBe(oldest);
    expect(lines(r)).toContain("OLDEST");
  });

  it("keeps the original refusal wording, byte for byte", () => {
    // The seed script prints each line prefixed with "seed: ", so this is
    // the message that has always come out of an empty database. Changing
    // it would be a gratuitous break in the one path nobody is changing.
    const r = resolveCompanyTarget({ by: "oldest" }, [null]);
    expect(r.error).toEqual(["no company found. Sign in to the app once first."]);
  });
});
