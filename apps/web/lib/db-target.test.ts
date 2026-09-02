import { describe as group, expect, it } from "vitest";
// The build script is plain .mjs in packages/db so the Vercel build can run
// it with bare node. Tested from here because this is where vitest lives.
import {
  connectionProblems,
  describe as describeTarget,
  isPooled,
  neonEndpointId,
  sameDatabase,
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

  it("does not leak the credential into the refusal", () => {
    const problem = wrongTarget("ep-patient-lake", describeTarget(OTHER_DIRECT));
    expect(JSON.stringify(problem)).not.toContain("hunter2");
    expect(problem?.message).not.toContain(":p@");
  });
});
