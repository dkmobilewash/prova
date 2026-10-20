import { describe, expect, it } from "vitest";
import { LABEL_DIR_VAR, labelPath } from "./labelStore";

/**
 * The refusals are the whole value of this module, so they are what is tested.
 * A path that is never checked is a path that is wrong on the day it matters,
 * and this one is built from a sheet name that arrives in a request.
 */
describe("where a label file is allowed to go", () => {
  const dir = "/tmp/prova-labels";
  const env = (extra: Record<string, string | undefined> = {}) =>
    ({ [LABEL_DIR_VAR]: dir, NODE_ENV: "development", ...extra }) as unknown as NodeJS.ProcessEnv;

  it("writes inside the configured folder, one folder per plan set", () => {
    expect(labelPath("Camp Bow Wow", "A101", env())).toBe(`${dir}/Camp_Bow_Wow/A101.json`);
  });

  it("REFUSES WHEN THE VARIABLE IS NOT SET, which is every deployment", () => {
    expect(labelPath("set", "A101", env({ [LABEL_DIR_VAR]: undefined }))).toBeNull();
    expect(labelPath("set", "A101", env({ [LABEL_DIR_VAR]: "   " }))).toBeNull();
  });

  it("REFUSES IN A PRODUCTION BUILD whatever the variable says", () => {
    // A server that can be told to write to its own filesystem by a value in a
    // request is the shape of a file-write bug, and an environment variable is
    // one accident away from being set.
    expect(labelPath("set", "A101", env({ NODE_ENV: "production" }))).toBeNull();
  });

  /**
   * ── THE LABELLING SERVER IS A PRODUCTION BUILD, AND MUST BE ABLE TO SAVE ──
   *
   * `next start` always sets NODE_ENV=production, so a flat refusal made the
   * no-recompile server unable to write — worse than being unable to read,
   * because the reviewer finds out AFTER doing the sheet. On 2026-10-20 a
   * finished sheet sat in an open tab with nowhere to put itself.
   *
   * The conditions are `localPlanFile.ts`'s, imported rather than restated.
   */
  describe("a production build with the labelling opt-in", () => {
    const built = (extra: Record<string, string | undefined> = {}) =>
      env({
        NODE_ENV: "production",
        ALLOW_LOCAL_PLANS: "1",
        HOSTNAME: "localhost",
        TAKEOFF_LOCAL_PLAN_DIR: "/plans",
        ...extra,
      });

    it("writes when ALL the conditions hold", () => {
      expect(labelPath("Camp Bow Wow", "A101", built())).toBe(`${dir}/Camp_Bow_Wow/A101.json`);
    });

    // One condition removed at a time: a gate tested only as a whole is a
    // gate where three of four conditions could be dead.
    it("refuses without the opt-in", () => {
      expect(labelPath("set", "A101", built({ ALLOW_LOCAL_PLANS: undefined }))).toBeNull();
      expect(labelPath("set", "A101", built({ ALLOW_LOCAL_PLANS: "0" }))).toBeNull();
    });

    it("refuses when not bound to loopback", () => {
      for (const bind of ["0.0.0.0", "", "10.0.0.5"]) {
        expect(labelPath("set", "A101", built({ HOSTNAME: bind })), bind).toBeNull();
      }
    });

    it("refuses on Vercel, whatever the value", () => {
      for (const value of ["1", "0", "", "preview"]) {
        expect(labelPath("set", "A101", built({ VERCEL: value })), value).toBeNull();
      }
    });

    it("REFUSES A REAL DEPLOYMENT even with the label folder set by accident", () => {
      // Not a production build with the labelling variables removed, which is
      // easy to pass — the actual mistake this guard exists for.
      expect(
        labelPath(
          "set",
          "A101",
          env({
            NODE_ENV: "production",
            VERCEL: "1",
            VERCEL_ENV: "production",
            HOSTNAME: "0.0.0.0",
          }),
        ),
      ).toBeNull();
    });

    it("still cannot be climbed out of", () => {
      // The opt-in buys a folder, not the filesystem. Asserted as
      // CONTAINMENT rather than an exact spelling: `safeName` is stricter
      // than it looks — `../../etc` becomes `_.._etc`, not `etc` — and a test
      // pinning the spelling would fail the day it is made stricter still,
      // which is the wrong direction to make somebody defend.
      for (const [set, sheet] of [
        ["../../etc", "passwd"],
        ["set", "../../../etc/passwd"],
        ["..", ".."],
      ]) {
        const got = labelPath(set, sheet, built());
        expect(got, `${set}/${sheet}`).not.toBeNull();
        expect(got?.startsWith(`${dir}/`), `${set}/${sheet} escaped to ${got}`).toBe(true);
        expect(got?.includes("/../"), `${set}/${sheet} kept a climb`).toBe(false);
      }
    });
  });

  it("CANNOT BE CLIMBED OUT OF by a crafted sheet or set name", () => {
    // `..` is flattened by the name cleaner before the path is built, so these
    // land inside the folder rather than above it.
    for (const [set, sheet] of [
      ["..", ".."],
      ["../..", "../../etc/passwd"],
      ["set", "../../../tmp/evil"],
      ["/etc", "passwd"],
    ] as const) {
      const got = labelPath(set, sheet, env());
      expect(got, `${set} / ${sheet}`).not.toBeNull();
      expect(got!.startsWith(`${dir}/`), `${set} / ${sheet} escaped to ${got}`).toBe(true);
    }
  });

  it("does not mistake a sibling folder for the configured one", () => {
    // `/tmp/prova-labels-other` starts with the configured path as a string
    // and is not inside it, which is why the comparison appends a separator.
    expect(labelPath("x", "y", env())!.startsWith(`${dir}/`)).toBe(true);
    expect(labelPath("x", "y", env({ [LABEL_DIR_VAR]: `${dir}-other` }))).toBe(
      `${dir}-other/x/y.json`,
    );
  });

  it("keeps a readable name where it can", () => {
    expect(labelPath("ELEVEN03 PERMIT SET", "A4.B-Y2", env())).toBe(
      `${dir}/ELEVEN03_PERMIT_SET/A4.B-Y2.json`,
    );
  });
});
