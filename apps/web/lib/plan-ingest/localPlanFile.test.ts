import { describe, expect, it } from "vitest";
import { isLocalPlanUrl, localPlanPath, productionLocalPlansAllowed } from "./localPlanFile";

/**
 * ── THE REFUSALS ARE THE WHOLE VALUE ──
 *
 * This lets a server read a file named by a value in the database, which is
 * the shape of a file-disclosure bug. It is acceptable only because of what it
 * refuses, so that is what is tested: a production build, an unset directory,
 * an absolute path, and every way out of the folder.
 */

const DEV = { NODE_ENV: "development", TAKEOFF_LOCAL_PLAN_DIR: "/plans" } as NodeJS.ProcessEnv;

/**
 * What `dev-local-plans.sh` produces with `BUILT=1`: a production build,
 * bound to loopback, opted in, with no Vercel anywhere.
 */
const BUILT = {
  NODE_ENV: "production",
  TAKEOFF_LOCAL_PLAN_DIR: "/plans",
  ALLOW_LOCAL_PLANS: "1",
  HOSTNAME: "127.0.0.1",
} as NodeJS.ProcessEnv;

describe("reading a plan from this machine", () => {
  it("resolves a file inside the configured folder", () => {
    expect(localPlanPath("local:camp.pdf", DEV)).toBe("/plans/camp.pdf");
    expect(localPlanPath("local:sets/camp.pdf", DEV)).toBe("/plans/sets/camp.pdf");
  });

  it("REFUSES IN A REAL DEPLOYMENT, which is the case that matters", () => {
    // ── WHAT A DEPLOYED BUILD ACTUALLY LOOKS LIKE ──
    //
    // Not a production build with the labelling variables removed, which is
    // easy to pass. A deployment with the directory variable SET BY ACCIDENT
    // — the exact mistake this guard exists for — and it still refuses,
    // because it fails the opt-in, the bind and the Vercel test separately.
    expect(
      localPlanPath("local:camp.pdf", {
        ...DEV,
        NODE_ENV: "production",
        VERCEL: "1",
        VERCEL_ENV: "production",
        HOSTNAME: "0.0.0.0",
      }),
    ).toBeNull();
    // And a plain production build with nothing else set.
    expect(localPlanPath("local:camp.pdf", { ...DEV, NODE_ENV: "production" })).toBeNull();
  });

  it("refuses on Vercel in ANY mode, whatever the value", () => {
    // Not `VERCEL === "1"`: any value means a Vercel runtime. A development
    // NODE_ENV there would otherwise walk straight past the production gate.
    for (const value of ["1", "0", "", "true", "preview"]) {
      expect(localPlanPath("local:camp.pdf", { ...DEV, VERCEL: value }), value).toBeNull();
      expect(localPlanPath("local:camp.pdf", { ...BUILT, VERCEL: value }), value).toBeNull();
    }
  });

  describe("a production build with the labelling opt-in", () => {
    it("reads the file when ALL FOUR conditions hold", () => {
      // The case the whole change exists for: `next start` always sets
      // NODE_ENV=production, so without this the no-recompile labelling
      // server can never serve a drawing.
      expect(localPlanPath("local:camp.pdf", BUILT)).toBe("/plans/camp.pdf");
      expect(productionLocalPlansAllowed(BUILT)).toBe(true);
    });

    // ── ONE CONDITION REMOVED AT A TIME ──
    //
    // A gate tested only as a whole is a gate where three of the four
    // conditions could be dead and nothing would say so.
    it("refuses without the explicit opt-in", () => {
      expect(localPlanPath("local:camp.pdf", { ...BUILT, ALLOW_LOCAL_PLANS: undefined })).toBeNull();
      // And only exactly "1" — not any truthy-looking value.
      for (const value of ["", "0", "true", "yes", "2"]) {
        expect(localPlanPath("local:camp.pdf", { ...BUILT, ALLOW_LOCAL_PLANS: value }), value).toBeNull();
      }
    });

    it("refuses when the server is not bound to loopback", () => {
      // `0.0.0.0` is every interface — the one case this refuses. A server
      // reachable from the network cannot read this machine's files.
      for (const bind of ["0.0.0.0", "", "192.168.1.40", "example.com", "::"]) {
        expect(localPlanPath("local:camp.pdf", { ...BUILT, HOSTNAME: bind }), bind).toBeNull();
      }
      for (const bind of ["127.0.0.1", "localhost", "::1", "LocalHost"]) {
        expect(localPlanPath("local:camp.pdf", { ...BUILT, HOSTNAME: bind }), bind).not.toBeNull();
      }
    });

    it("refuses with no plan directory, even with the opt-in", () => {
      expect(localPlanPath("local:camp.pdf", { ...BUILT, TAKEOFF_LOCAL_PLAN_DIR: "" })).toBeNull();
      expect(localPlanPath("local:camp.pdf", { ...BUILT, TAKEOFF_LOCAL_PLAN_DIR: "plans" })).toBeNull();
    });

    // ── THE PREDICATE IS TESTED ON ITS OWN, NOT ONLY THROUGH THE PATH ──
    //
    // Mutation found two conditions inside it that no test could kill:
    // `localPlanPath` checks Vercel and the plan directory itself, BEFORE and
    // AFTER calling this, so removing either from the predicate changed
    // nothing reachable. That is the "something else was already doing the
    // work" shape — and the predicate is exported, so a later caller would
    // get the weaker answer with nothing to say so.
    it("the predicate refuses each condition on its own", () => {
      expect(productionLocalPlansAllowed({ ...BUILT, VERCEL: "1" }), "Vercel").toBe(false);
      expect(productionLocalPlansAllowed({ ...BUILT, VERCEL: "" }), "VERCEL empty").toBe(false);
      expect(productionLocalPlansAllowed({ ...BUILT, ALLOW_LOCAL_PLANS: "0" }), "opt-in").toBe(false);
      expect(productionLocalPlansAllowed({ ...BUILT, HOSTNAME: "0.0.0.0" }), "bind").toBe(false);
      expect(productionLocalPlansAllowed({ ...BUILT, TAKEOFF_LOCAL_PLAN_DIR: "" }), "no dir").toBe(false);
      expect(productionLocalPlansAllowed({ ...BUILT, TAKEOFF_LOCAL_PLAN_DIR: "plans" }), "relative dir").toBe(
        false,
      );
      expect(productionLocalPlansAllowed(BUILT), "all four").toBe(true);
    });

    it("STILL cannot climb out of the folder", () => {
      // The opt-in buys a directory, not the filesystem.
      for (const asked of ["local:../secrets.pdf", "local:sets/../../secrets.pdf", "local:/etc/passwd"]) {
        expect(localPlanPath(asked, BUILT), asked).toBeNull();
      }
    });
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
