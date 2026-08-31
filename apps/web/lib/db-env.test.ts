import { describe, expect, it } from "vitest";
// @ts-expect-error - plain .mjs, no types, same as connection-target
import { parseEnv, loadEnvFiles } from "../../../packages/db/scripts/load-env.mjs";

/** These exist because `prisma migrate dev` reads .env and our own scripts
 * did not, and nobody noticed for weeks: the Prisma CLI loads .env itself,
 * which is a Prisma feature and not a Node one. migrate:deploy therefore
 * saw no DATABASE_URL on a developer's machine and told them to go and fix
 * this repository's GitHub Actions secrets — advice that is correct in CI
 * and useless on a laptop, where the answer is a file in the same folder. */
describe("parseEnv", () => {
  it("keeps a connection string whole", () => {
    // Every character that a naive splitter gets wrong: `=` inside the
    // value, `?`, `&`, and a `#` in the query string.
    const url =
      "postgresql://user:pw@ep-example-pooler.us-west-2.aws.neon.tech/neondb?sslmode=require&connection_limit=5";
    expect(parseEnv(`DATABASE_URL=${url}`).get("DATABASE_URL")).toBe(url);
  });

  it("handles quotes, export, comments and blank lines", () => {
    const parsed = parseEnv(
      [
        "# a comment",
        "",
        "export DIRECT_URL='postgresql://a/b'",
        'OTHER="spaced value"',
        "PLAIN=value   # trailing comment",
        "  INDENTED = padded  ",
      ].join("\n"),
    );
    expect(parsed.get("DIRECT_URL")).toBe("postgresql://a/b");
    expect(parsed.get("OTHER")).toBe("spaced value");
    expect(parsed.get("PLAIN")).toBe("value");
    expect(parsed.get("INDENTED")).toBe("padded");
  });

  it("does not treat a # inside a value as a comment", () => {
    // A password may contain one, and truncating it produces a URL that is
    // subtly wrong rather than absent — the failure that is hard to see.
    expect(parseEnv('PW="p#ssword"').get("PW")).toBe("p#ssword");
    expect(parseEnv("URL=host/db?opt=a#frag").get("URL")).toBe("host/db?opt=a#frag");
  });

  it("ignores malformed lines rather than guessing", () => {
    const parsed = parseEnv(["NOEQUALS", "=novalue", "1BAD=x", "GOOD=y"].join("\n"));
    expect(parsed.has("GOOD")).toBe(true);
    expect(parsed.size).toBe(1);
  });

  it("takes the first definition of a repeated key", () => {
    expect(parseEnv("K=first\nK=second").get("K")).toBe("first");
  });
});

describe("loadEnvFiles", () => {
  it("never overrides a variable that is already set", () => {
    // The security property: CI passes real secrets as env vars, and a
    // stray .env in a runner's checkout must not redirect a migration to
    // another database. Set beats file, always.
    const env: Record<string, string> = { DATABASE_URL: "real" };
    loadEnvFiles([], env);
    expect(env.DATABASE_URL).toBe("real");
  });

  it("reports nothing and changes nothing when no file exists", () => {
    const env: Record<string, string> = {};
    expect(loadEnvFiles(["/nonexistent/.env"], env)).toEqual([]);
    expect(Object.keys(env)).toHaveLength(0);
  });
});
