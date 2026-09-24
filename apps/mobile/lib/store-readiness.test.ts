import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * WHAT A BUILD NEEDS BEFORE ANYONE ELSE CAN HOLD IT.
 *
 * Every failure this file pins is one that shows up late and expensively:
 * not at typecheck, not in a unit run, but twenty minutes into an EAS
 * build, or in an App Store review a day later, or — worst — on a
 * foreman's phone as a feature that quietly does nothing.
 *
 * The ones that have a name already:
 *
 *  - **No project id** and `getExpoPushTokenAsync` throws. It is called
 *    fire-and-forget at launch, so push just never works.
 *  - **A missing or lazy permission string** is an App Store rejection,
 *    and before that a permission dialog with a blank reason, which
 *    people decline.
 *  - **A missing icon or splash** fails the build itself.
 *  - **No `ITSAppUsesNonExemptEncryption`** turns every single submit
 *    into a manual export-compliance question.
 *
 * Deliberately NOT asserted: anything living in an Apple or Expo account
 * — certificates, the APNs key, the App Store Connect record. A test
 * cannot see them, and a test that pretended to would be the worst kind
 * of green. RELEASE.md carries those as steps a person takes.
 */

const mobile = join(__dirname, "..");
const app = JSON.parse(readFileSync(join(mobile, "app.json"), "utf8")).expo as {
  name?: string;
  slug?: string;
  scheme?: string;
  version?: string;
  owner?: string;
  icon?: string;
  splash?: { image?: string };
  plugins?: (string | [string, Record<string, unknown>])[];
  ios?: { bundleIdentifier?: string; infoPlist?: Record<string, unknown> };
  android?: { package?: string; adaptiveIcon?: { foregroundImage?: string } };
  extra?: { eas?: { projectId?: string } };
};
const eas = JSON.parse(readFileSync(join(mobile, "eas.json"), "utf8")) as {
  build: Record<string, { autoIncrement?: boolean; environment?: string }>;
  submit?: Record<string, unknown>;
};

describe("the app config a store build depends on", () => {
  it("names the app and the bundle it ships as", () => {
    expect(app.name).toBeTruthy();
    expect(app.slug).toBeTruthy();
    expect(app.scheme).toBeTruthy();
    expect(app.version).toBeTruthy();
    // The owner decides WHICH Expo account a build belongs to. Wrong or
    // missing, and `eas build` either fails or builds under a personal
    // account nobody else can submit from.
    expect(app.owner).toBeTruthy();
    expect(app.ios?.bundleIdentifier).toBe("com.cstream.prova");
    expect(app.android?.package).toBe("com.cstream.prova");
  });

  it("carries the EAS project id that push registration needs", () => {
    // See push-project-id.ts: without this, a build installs, launches,
    // and never registers a device — silently.
    expect(app.extra?.eas?.projectId, "no extra.eas.projectId — push cannot register").toMatch(
      /^[0-9a-f-]{20,}$/i,
    );
  });

  it("answers the export-compliance question once, in the repo", () => {
    // Otherwise every submit stops to ask it by hand.
    expect(app.ios?.infoPlist?.ITSAppUsesNonExemptEncryption).toBe(false);
  });

  it("has the images a build refuses to proceed without", () => {
    const assets = [app.icon, app.splash?.image, app.android?.adaptiveIcon?.foregroundImage];
    expect(assets.filter(Boolean).length, "an image path went missing from app.json").toBe(3);
    for (const asset of assets) {
      expect(existsSync(join(mobile, asset as string)), `${asset} is named but not on disk`).toBe(
        true,
      );
    }
  });
});

describe("every permission this app asks for explains itself", () => {
  /** The permission strings the config plugins declare, derived from the
   * plugins list rather than from a hardcoded roster — add a plugin with
   * a new permission and it is covered without editing this file. */
  function declaredPermissionStrings(): { plugin: string; key: string; text: unknown }[] {
    const out: { plugin: string; key: string; text: unknown }[] = [];
    for (const entry of app.plugins ?? []) {
      if (typeof entry === "string") continue;
      const [name, config] = entry;
      for (const [key, text] of Object.entries(config ?? {})) {
        if (/permission$/i.test(key)) out.push({ plugin: name, key, text });
      }
    }
    return out;
  }

  it("finds the permission strings at all — the scan is not empty", () => {
    // The size half: this app uses the camera, the photo library and
    // location, so a parse returning nothing means the plugin shape
    // changed and every assertion below stopped meaning anything.
    expect(declaredPermissionStrings().length).toBeGreaterThanOrEqual(3);
  });

  it("gives each one a real sentence, not a placeholder", () => {
    const weak = declaredPermissionStrings().filter(({ text }) => {
      if (typeof text !== "string") return true;
      // Apple rejects terse strings ("needs camera"), and a person
      // reading a blank-sounding reason declines. A real sentence names
      // the app and what it does with the thing.
      return text.trim().length < 40 || !/C Stream/.test(text);
    });
    expect(
      weak.map((w) => `${w.plugin}.${w.key}`),
      "these read as placeholders; Apple rejects them and people decline them",
    ).toEqual([]);
  });

  it("asks for nothing it does not use", () => {
    // Every permission plugin here must correspond to something the app
    // actually does: camera and library for site photos, location for
    // the stamp on them. A permission the app never exercises is a
    // review question with no good answer.
    const plugins = (app.plugins ?? []).map((p) => (typeof p === "string" ? p : p[0]));
    for (const plugin of plugins.filter((p) => /location|image-picker|camera|contacts|calendar/.test(p))) {
      expect(["expo-location", "expo-image-picker"]).toContain(plugin);
    }
  });
});

describe("the build profiles a release goes through", () => {
  it("keeps a production profile that bumps its own build number", () => {
    // Apple refuses a build number it has already seen, and doing it by
    // hand is how a submission fails at the last step.
    expect(eas.build.production?.autoIncrement).toBe(true);
    expect(eas.build.production?.environment).toBe("production");
  });

  it("keeps a submit profile, even empty — its absence is what breaks", () => {
    // `eas submit --profile production` needs the key to exist; the
    // Apple identifiers under it are prompted for and stored by EAS
    // rather than committed here.
    expect(eas.submit).toHaveProperty("production");
  });
});
