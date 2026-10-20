import { describe, expect, it } from "vitest";
import { plural } from "@/components/closeoutPackageLabels";

describe("plural", () => {
  // "1 jobs", "1 items" and "1 days with them" were all on /closeout, all
  // reachable with a single row.
  it("does not say '1 jobs'", () => {
    expect(plural(1, "job", "jobs")).toBe("1 job");
    expect(plural(0, "job", "jobs")).toBe("0 jobs");
    expect(plural(2, "job", "jobs")).toBe("2 jobs");
  });
});
