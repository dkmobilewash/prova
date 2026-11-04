import path from "node:path";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import baseConfig from "./playwright.config";

/**
 * The takeoff click list as a spec, LOCAL ONLY. Run from the repo root:
 *
 *     TAKEOFF_CLICK_PLANS="/abs/folder/of/training/sets" pnpm test:e2e -- --takeoff-click
 *     … --takeoff-click --skip-build    reuses the last build
 *
 * The training sets are real drawings and never enter the repository: the
 * folder is named by TAKEOFF_CLICK_PLANS and read by the SERVER as `local:`
 * plans, which `localPlanFile.ts` allows on a production build only with
 * ALLOW_LOCAL_PLANS=1, a loopback HOSTNAME and an absolute TAKEOFF_LOCAL_PLAN_DIR,
 * all set here and nowhere else. The wall model is the committed one rather than
 * the suite's invented stump, because the steps check what an estimator would see.
 *
 * It lives in `local/`, which the main config's `testDir: "./specs"` never
 * reaches, so no CI job runs it. One worker, no retries: the steps are one story
 * per sheet, in order.
 */
const plans = process.env.TAKEOFF_CLICK_PLANS ?? "";
const labelDir = process.env.TAKEOFF_CLICK_LABEL_DIR ?? mkdtempSync(path.join(tmpdir(), "takeoff-click-labels-"));
const webServer = Array.isArray(baseConfig.webServer) ? baseConfig.webServer[0]! : baseConfig.webServer!;

export default {
  ...baseConfig,
  testDir: "./local",
  testMatch: "takeoff-click.local.spec.ts",
  workers: 1,
  retries: 0,
  projects: [{ name: "chromium", use: { browserName: "chromium" as const, viewport: { width: 1600, height: 1000 } } }],
  webServer: {
    ...webServer,
    env: {
      ...webServer.env,
      ALLOW_LOCAL_PLANS: "1",
      HOSTNAME: "localhost",
      TAKEOFF_LOCAL_PLAN_DIR: plans,
      TAKEOFF_WALL_MODEL: path.resolve(__dirname, "..", "models", "wall-model.json"),
      // Answer-key saves land in a throwaway folder, never the real labels.
      TAKEOFF_LABEL_DIR: labelDir,
    },
  },
};
