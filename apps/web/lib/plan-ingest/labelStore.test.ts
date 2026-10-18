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
