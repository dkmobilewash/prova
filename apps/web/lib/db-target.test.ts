import { describe as group, expect, it } from "vitest";
// The build script is plain .mjs in packages/db so the Vercel build can run
// it with bare node. Tested from here because this is where vitest lives.
import {
  connectionProblems,
  describe as describeTarget,
  isPooled,
  neonEndpointId,
  sameDatabase,
  scratchProblem,
  wrongTarget,
} from "../../../packages/db/scripts/connection-target.mjs";

// The two real endpoints from the incident this exists to prevent. Passwords
// are fake; the hosts are the ones that actually disagreed.
const APP = "postgresql://u:p@ep-icy-hat-afqau56u-pooler.c-2.us-west-2.aws.neon.tech/neondb";
const APP_DIRECT = "postgresql://u:p@ep-icy-hat-afqau56u.c-2.us-west-2.aws.neon.tech/neondb";
const OTHER_DIRECT = "postgresql://u:p@ep-little-sea-a6bdnaw2.us-west-2.aws.neon.tech/neondb";

const fatals = (db: string, direct: string) =>
  connectionProblems(db, direct).problems.filter((p) => p.level === "fatal");

group("reading a connection string", () => {
  it("never returns the credential", () => {
    // This output goes into build logs, which are not private.
    const target = describeTarget("postgresql://someone:hunter2@ep-a-b.neon.tech/neondb");
    if (target === null) throw new Error("expected a parsed target");
    expect(JSON.stringify(target)).not.toContain("hunter2");
    expect(JSON.stringify(target)).not.toContain("someone");
    expect(target.label).toBe("ep-a-b.neon.tech/neondb");
  });

  it("pulls out the Neon endpoint id, pooled or direct", () => {
    expect(neonEndpointId("ep-icy-hat-afqau56u-pooler.c-2.us-west-2.aws.neon.tech")).toBe(
      "ep-icy-hat-afqau56u",
    );
    expect(neonEndpointId("ep-icy-hat-afqau56u.c-2.us-west-2.aws.neon.tech")).toBe(
      "ep-icy-hat-afqau56u",
    );
    expect(neonEndpointId("localhost")).toBeNull();
  });

  it("knows a pooled host from a direct one", () => {
    expect(isPooled("ep-a-b-pooler.neon.tech")).toBe(true);
    expect(isPooled("ep-a-b.neon.tech")).toBe(false);
  });

  it("returns null instead of throwing on junk", () => {
    // A thrown error here would print a stack trace carrying the string.
    expect(describeTarget("")).toBeNull();
    expect(describeTarget("not a url")).toBeNull();
    expect(describeTarget(undefined)).toBeNull();
  });
});

group("sameDatabase", () => {
  it("treats a Neon branch's pooled and direct endpoints as one database", () => {
    expect(sameDatabase(describeTarget(APP), describeTarget(APP_DIRECT))).toBe(true);
  });

  it("catches the two endpoints that actually disagreed", () => {
    // ep-icy-hat vs ep-little-sea: the app read one, the build migrated the
    // other, and every "successfully applied" was true about the wrong one.
    expect(sameDatabase(describeTarget(APP), describeTarget(OTHER_DIRECT))).toBe(false);
  });

  it("does not call two databases the same just because the host is", () => {
    expect(
      sameDatabase(
        describeTarget("postgresql://u:p@localhost:5433/prova"),
        describeTarget("postgresql://u:p@localhost:5433/prova_ci"),
      ),
    ).toBe(false);
  });

  it("compares local Postgres by host and database, having no endpoint id", () => {
    expect(
      sameDatabase(
        describeTarget("postgresql://u:p@localhost:5433/prova"),
        describeTarget("postgresql://u:p@localhost:5433/prova"),
      ),
    ).toBe(true);
  });

  it("refuses to guess when only one side is Neon", () => {
    expect(sameDatabase(describeTarget(APP), describeTarget("postgresql://u:p@localhost:5433/neondb"))).toBe(
      false,
    );
  });
});

group("connectionProblems", () => {
  it("passes a correctly configured pair", () => {
    expect(connectionProblems(APP, APP_DIRECT).problems).toEqual([]);
  });

  it("is fatal when the two point at different databases, and names both", () => {
    const [problem] = fatals(APP, OTHER_DIRECT);
    expect(problem.message).toContain("DIFFERENT databases");
    expect(problem.message).toContain("ep-icy-hat-afqau56u-pooler");
    expect(problem.message).toContain("ep-little-sea-a6bdnaw2");
  });

  it("is fatal when DIRECT_URL is pooled — migrate can't hold the lock", () => {
    expect(fatals(APP, APP)[0].message).toContain("pooled endpoint");
  });

  it("is fatal when either is missing, naming which", () => {
    expect(fatals("", APP_DIRECT)[0].message).toContain("DATABASE_URL");
    expect(fatals(APP, "")[0].message).toContain("DIRECT_URL");
  });

  it("only warns when DATABASE_URL is unpooled — it works, it just wastes connections", () => {
    const { problems } = connectionProblems(APP_DIRECT, APP_DIRECT);
    expect(problems).toHaveLength(1);
    expect(problems[0].level).toBe("warning");
  });

  it("says nothing about pooling for a local database", () => {
    const local = "postgresql://u:p@localhost:5433/prova";
    expect(connectionProblems(local, local).problems).toEqual([]);
  });
});

// The assertion that answers "is this the database you SAID you meant?" —
// a different question from "do these two URLs agree", which is all the
// checks above ask. Two wrong-but-matching URLs pass every one of them.
group("asserting the named target", () => {
  const demo = describeTarget(
    "postgresql://u:p@ep-patient-lake-afizorh1-pooler.c-2.us-west-2.aws.neon.tech/neondb",
  );
  const demoDirect = describeTarget(
    "postgresql://u:p@ep-patient-lake-afizorh1.c-2.us-west-2.aws.neon.tech/neondb",
  );
  const production = describeTarget(OTHER_DIRECT);

  it("accepts the endpoint through its -pooler twin", () => {
    // Both doors onto one database, so naming the endpoint must accept both
    // or the pooled URL could never be asserted at all.
    expect(wrongTarget("ep-patient-lake", demo, demoDirect)).toBeNull();
  });

  it("refuses when the secret holds production instead", () => {
    // The whole point. These two URLs would agree with each other perfectly.
    const problem = wrongTarget("ep-patient-lake", production, production);
    expect(problem?.level).toBe("fatal");
    expect(problem?.message).toContain("ep-little-sea");
  });

  it("refuses when only ONE of the pair is wrong", () => {
    expect(wrongTarget("ep-patient-lake", demo, production)).not.toBeNull();
  });

  it("is opt-in: blank or whitespace asserts nothing", () => {
    // Production's migrate job predates this and must keep working untouched.
    expect(wrongTarget(undefined, production)).toBeNull();
    expect(wrongTarget("", production)).toBeNull();
    expect(wrongTarget("   ", production)).toBeNull();
  });

  // Issue #182. The other half of the opt-in above, and the opposite
  // decision: a name WAS given, so a check was promised. Returning null
  // here — which is what it used to do — answers "no problem" to a
  // question it never got to ask, and that reads exactly like a pass.
  it("is fatal when a target is named but nothing can be read", () => {
    const problem = wrongTarget("ep-patient-lake", null, null);
    expect(problem?.level).toBe("fatal");
    expect(problem?.message).toContain("NO connection string could be read");
  });

  it("is fatal when a target is named and no target is passed at all", () => {
    expect(wrongTarget("ep-patient-lake")?.level).toBe("fatal");
  });

  it("says the assertion did not run, not that the target was right", () => {
    // The distinction this whole issue is about. An operator reading a log
    // must not be able to mistake "could not check" for "checked, fine".
    const message = wrongTarget("ep-patient-lake", null)?.message ?? "";
    expect(message).toContain("not the same as the target being correct");
    expect(message).toContain("Nothing has been applied");
    expect(message).toContain("ep-patient-lake");
  });

  it("returns null ONLY for the deliberate opt-in, never for an empty check", () => {
    // Stated as one assertion because the two null-returning paths looked
    // identical from the call site and one of them was a defect: the guard
    // that cannot fail and the guard that passed returned the same value.
    const nulls = [
      wrongTarget(undefined, null),
      wrongTarget("", null),
      wrongTarget("ep-patient-lake", demo, demoDirect),
    ].filter((p) => p === null);
    expect(nulls).toHaveLength(3);
    expect(wrongTarget("ep-patient-lake", null)).not.toBeNull();
  });

  it("does not leak the credential into the refusal", () => {
    const problem = wrongTarget("ep-patient-lake", describeTarget(OTHER_DIRECT));
    expect(JSON.stringify(problem)).not.toContain("hunter2");
    expect(problem?.message).not.toContain(":p@");
  });
});

group("the scratch-only rule for the db suite", () => {
  // The endpoint that was actually reset on 2026-09-18, by tooling handed
  // a real URL where a throwaway one belonged. The db suite deletes rows,
  // so it gets the same refusal, by name.
  it("refuses every real Neon endpoint, pooled or direct", () => {
    for (const url of [APP, APP_DIRECT, OTHER_DIRECT]) {
      const problem = scratchProblem(url, "DATABASE_URL");
      expect(problem).toMatch(/not a local database/);
      // The message reaches a terminal; the credential must not.
      expect(problem).not.toContain(":p@");
    }
  });

  it("accepts the scratch recipe's own shapes and nothing fancier", () => {
    expect(scratchProblem("postgresql://me@localhost:5433/prova_test", "DATABASE_URL")).toBeNull();
    expect(scratchProblem("postgresql://me@127.0.0.1:5432/prova_test", "DIRECT_URL")).toBeNull();
    // The unix-socket form from vitest.db.config.mts's comment.
    expect(
      scratchProblem("postgresql://me@localhost:5433/prova_test?host=/tmp/pgsock", "DATABASE_URL"),
    ).toBeNull();
  });

  it("a socket path that is not a path does not smuggle a remote host through", () => {
    expect(
      scratchProblem(`${APP_DIRECT}?host=tmp`, "DATABASE_URL"),
    ).toMatch(/not a local database/);
  });

  it("rejects host overrides and remote authorities even when a socket is present", () => {
    for (const url of [
      `${APP_DIRECT}?host=/tmp/pgsock`,
      "postgresql://me@localhost/prova_test?host=remote.example",
      "postgresql://me@localhost/prova_test?host=/tmp/pgsock&host=remote.example",
      "postgresql://me@localhost/prova_test?host=//remote/share",
      "postgresql://me@localhost/prova_test?hostaddr=203.0.113.1",
      "postgresql://me@localhost/prova_test?service=production",
    ]) expect(scratchProblem(url, "DATABASE_URL")).not.toBeNull();
  });

  it("requires a test database even on localhost", () => {
    for (const database of ["", "postgres", "prova", "neondb", "prova_test/other"]) {
      expect(scratchProblem(`postgresql://me@localhost/${database}`, "DATABASE_URL")).not.toBeNull();
    }
    expect(scratchProblem("postgresql://me@[::1]/prova_dbtest", "DIRECT_URL")).toBeNull();
    expect(scratchProblem("https://localhost/prova_test", "DATABASE_URL")).not.toBeNull();
  });

  it("missing or malformed is refused, not waved through", () => {
    expect(scratchProblem(undefined, "DATABASE_URL")).toMatch(/missing or not a valid/);
    expect(scratchProblem("not a url", "DIRECT_URL")).toMatch(/missing or not a valid/);
  });
});
