import { describe, expect, it } from "vitest";
import { isLocalPlanUrl, localPlanPath } from "./localPlanFile";

/**
 * ── THE REFUSALS ARE THE WHOLE VALUE ──
 *
 * This lets a server read a file named by a value in the database, which is
 * the shape of a file-disclosure bug. It is acceptable only because of what it
 * refuses, so that is what is tested: a production build, an unset directory,
 * an absolute path, and every way out of the folder.
 */

const DEV = { NODE_ENV: "development", TAKEOFF_LOCAL_PLAN_DIR: "/plans" } as NodeJS.ProcessEnv;

describe("reading a plan from this machine", () => {
  it("resolves a file inside the configured folder", () => {
    expect(localPlanPath("local:camp.pdf", DEV)).toBe("/plans/camp.pdf");
    expect(localPlanPath("local:sets/camp.pdf", DEV)).toBe("/plans/sets/camp.pdf");
  });

  it("REFUSES IN PRODUCTION, whatever is configured", () => {
    // The variable could be set by accident; a production build must not care.
    expect(localPlanPath("local:camp.pdf", { ...DEV, NODE_ENV: "production" })).toBeNull();
    expect(localPlanPath("local:camp.pdf", { ...DEV, VERCEL: "1" })).toBeNull();
  });

  it("refuses when no folder is configured, which is every deployment", () => {
    expect(localPlanPath("local:camp.pdf", { NODE_ENV: "development" } as NodeJS.ProcessEnv)).toBeNull();
    expect(localPlanPath("local:camp.pdf", { ...DEV, TAKEOFF_LOCAL_PLAN_DIR: "" })).toBeNull();
    // A relative folder is not a permission anybody can reason about.
    expect(localPlanPath("local:camp.pdf", { ...DEV, TAKEOFF_LOCAL_PLAN_DIR: "plans" })).toBeNull();
  });

  it("CANNOT CLIMB OUT of the folder", () => {
    for (const asked of [
      "local:../secrets.pdf",
      "local:sets/../../secrets.pdf",
      "local:./../../etc/passwd",
      "local:..",
    ]) {
      expect(localPlanPath(asked, DEV), `escaped with ${asked}`).toBeNull();
    }
  });

  it("is not fooled by a SIBLING whose name starts the same", () => {
    // `/plans-secret` is not inside `/plans`, and a prefix test without the
    // separator would say it is.
    expect(localPlanPath("local:../plans-secret/x.pdf", DEV)).toBeNull();
  });

  it("refuses an absolute path, because the folder IS the permission", () => {
    expect(localPlanPath("local:/etc/passwd", DEV)).toBeNull();
    expect(localPlanPath("local:/plans/camp.pdf", DEV)).toBeNull();
  });

  it("refuses an empty name", () => {
    expect(localPlanPath("local:", DEV)).toBeNull();
  });

  it("leaves every other URL alone, so the blob path is untouched", () => {
    expect(isLocalPlanUrl("https://abc.public.blob.vercel-storage.com/x.pdf")).toBe(false);
    expect(localPlanPath("https://abc.public.blob.vercel-storage.com/x.pdf", DEV)).toBeNull();
  });
});
