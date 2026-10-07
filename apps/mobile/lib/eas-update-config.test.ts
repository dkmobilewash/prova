import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * THE SCENE MANIFEST MUST STAY SINGULAR, AND `eas update:configure` DUPLICATED
 * IT.
 *
 * Running that command to add EAS Update also rewrote `app.json`, and it
 * appended rather than merged: `UIWindowSceneSessionRoleApplication` came out
 * with **two identical configurations** where iOS expects one. It did the same
 * to the Android permissions.
 *
 * That block is not decoration. It is the fix from #620 for the iOS 27 launch
 * trap — an app that does not adopt the UIScene lifecycle is terminated at
 * launch — and a malformed manifest is exactly the shape that brings that back,
 * on a screen nobody can reach to report it.
 *
 * Both duplications were undone by hand. This file exists because the next
 * person to run an Expo CLI command that touches `app.json` will hit the same
 * behaviour, and a second entry is invisible in a diff full of legitimate
 * config churn.
 *
 * It also pins what EAS Update itself needs, because a missing `updates.url` or
 * a build profile with no channel fails SILENTLY: the build succeeds, installs,
 * and simply never receives an update.
 */

const APP = join(__dirname, "..", "app.json");
const EAS = join(__dirname, "..", "eas.json");

type SceneConfig = { UISceneConfigurationName?: string; UISceneDelegateClassName?: string };

function app(): Record<string, any> {
  return JSON.parse(readFileSync(APP, "utf8")).expo;
}

describe("the app is configured for EAS Update without breaking the launch", () => {
  it("declares exactly ONE window scene configuration", () => {
    const scenes: SceneConfig[] =
      app().ios?.infoPlist?.UIApplicationSceneManifest?.UISceneConfigurations
        ?.UIWindowSceneSessionRoleApplication ?? [];
    expect(
      scenes.length,
      "the window scene role has more than one configuration. `eas update:configure` appends rather " +
        "than merges and produced exactly this; iOS expects one, and a malformed scene manifest is " +
        "the iOS 27 launch trap #620 exists to prevent.",
    ).toBe(1);
    expect(scenes[0]?.UISceneDelegateClassName, "the scene delegate changed").toBe("EXExpoAppSceneDelegate");
  });

  it("points updates at this project and gives every build profile a channel", () => {
    // A missing url or channel does not fail the build. It produces an app
    // that installs fine and never updates, which is the worst way to find out.
    const updates = app().updates ?? {};
    expect(updates.url, "updates.url is gone — no build will ever receive an update").toMatch(
      /^https:\/\/u\.expo\.dev\/[0-9a-f-]{36}$/,
    );
    // FINGERPRINT, NOT appVersion, and the difference is a crash.
    //
    // `appVersion` makes the runtime the version string — which has been
    // `0.0.1` for seventeen builds and shows no sign of moving. Every build
    // would share one runtime forever, so a JS update that needs a native
    // module added later would be offered to builds that do not have it.
    //
    // `fingerprint` hashes the native inputs instead: config plugins, eas.json,
    // every autolinked module. Verified to resolve rather than assumed —
    // `expo-updates runtimeversion:resolve` returns a real hash over exactly
    // those sources. A native change moves the runtime automatically, so an
    // incompatible update is never offered at all.
    expect(
      app().runtimeVersion,
      "the runtime policy left fingerprint. Under appVersion every build shares one runtime and a JS " +
        "update needing new native code would reach builds without it.",
    ).toEqual({ policy: "fingerprint" });

    const profiles = JSON.parse(readFileSync(EAS, "utf8")).build ?? {};
    const names = Object.keys(profiles);
    expect(names.length, "no build profiles — this census is guarding nothing").toBeGreaterThan(0);
    for (const name of names) {
      expect(profiles[name].channel, `build profile "${name}" has no channel, so it can never update`).toBeTruthy();
    }
  });

  it("keeps duplicate-free arrays wherever the CLI has rewritten them", () => {
    // The same append-not-merge behaviour hit the permissions list. Generalised
    // rather than fixed in one place, because the next command will do it again
    // somewhere else.
    const permissions: string[] = app().android?.permissions ?? [];
    expect(new Set(permissions).size, "duplicate android permissions are back").toBe(permissions.length);
  });
});
