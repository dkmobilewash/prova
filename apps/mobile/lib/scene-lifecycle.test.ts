import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { patch } = require("../plugins/withSceneLifecycle.js");

/**
 * THE APP TRAPPED AT LAUNCH ON iOS 27 AND NO TEST IN THIS REPO COULD SEE IT.
 *
 * `_UIApplicationEvaluateRuntimeIssueForNoSceneLifecycleAdoption` — EXC_BREAKPOINT
 * before a line of JS runs, on an app that does not adopt the UIScene life cycle.
 * Found 2026-10-04 on the iPhone 18 Pro simulator (iOS 27, the only runtime
 * installed); every suite was green the whole time, because a unit test cannot
 * launch an app.
 *
 * SO READ WHAT THIS FILE CAN AND CANNOT DO, because the `expo-router` header scar
 * in CLAUDE.md is the same shape one layer down. These tests prove the two Swift
 * edits are PRESENT and correctly shaped. They cannot prove iOS honours them —
 * only a launch does that, and the launch is what found the bug in the first
 * place. "Nothing is ever missing from a question nobody is asking."
 *
 * What makes the plugin safe is not this file: it is that `patch()` THROWS when
 * an anchor is missing. A patch that silently matches nothing is the exact
 * failure mode that ships a green build and a dead app, so the next Expo
 * template change fails `prebuild` loudly instead of producing a binary that
 * traps on a user's phone.
 */

const TEMPLATE_BEFORE = `internal import Expo
import React
import ReactAppDependencyProvider

@main
class AppDelegate: ExpoAppDelegate {
  var window: UIWindow?

  var reactNativeDelegate: ExpoReactNativeFactoryDelegate?
  var reactNativeFactory: RCTReactNativeFactory?

  public override func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
  ) -> Bool {
    let delegate = ReactNativeDelegate()
    let factory = ExpoReactNativeFactory(delegate: delegate)
    delegate.dependencyProvider = RCTAppDependencyProvider()

    reactNativeDelegate = delegate
    reactNativeFactory = factory

#if os(iOS) || os(tvOS)
    window = UIWindow(frame: UIScreen.main.bounds)
    factory.startReactNative(
      withModuleName: "main",
      in: window,
      launchOptions: launchOptions)
#endif

    return super.application(application, didFinishLaunchingWithOptions: launchOptions)
  }
}
`;

describe("the AppDelegate adopts the scene life cycle", () => {
  it("declares the protocol the scene delegate actually looks for", () => {
    // ExpoAppSceneDelegate does `appDelegate as? ExpoReactNativeFactoryProvider`
    // and fatalErrors when that cast fails. Subclassing ExpoAppDelegate is NOT
    // enough — the generated template already did that and still trapped.
    expect(patch(TEMPLATE_BEFORE)).toContain(
      "class AppDelegate: ExpoAppDelegate, ExpoReactNativeFactoryProvider {",
    );
  });

  it("stops the app delegate building a second window", () => {
    // The half that is easy to miss. Under the scene life cycle the WINDOW is
    // created by ExpoAppSceneDelegate; an app delegate that also creates one and
    // calls startReactNative mounts React twice, into two different windows.
    const after = patch(TEMPLATE_BEFORE);
    expect(after).not.toContain("UIScreen.main.bounds");
    expect(after).not.toContain("factory.startReactNative(");
  });

  it("can be applied twice, because prebuild runs more than once", () => {
    const once = patch(TEMPLATE_BEFORE);
    expect(patch(once)).toBe(once);
  });

  it("THROWS rather than silently matching nothing when the template moves", () => {
    // The load-bearing assertion. A no-op patch produces a build that succeeds
    // and an app that traps at launch — green everywhere, dead on the phone.
    expect(() => patch("class SomethingElse {}\n")).toThrow(/could not find/i);
    expect(() =>
      patch(TEMPLATE_BEFORE.replace("#if os(iOS) || os(tvOS)", "#if os(watchOS)")),
    ).toThrow(/window block/i);
  });

  it("keeps the Info.plist manifest in app.json, where it is readable", () => {
    // The manifest is config, not generated Swift, so it lives in app.json and
    // not in the plugin. Deleting it re-opens the crash with no Swift change.
    const app = JSON.parse(readFileSync(join(__dirname, "..", "app.json"), "utf8"));
    const scene = app.expo.ios.infoPlist.UIApplicationSceneManifest;
    const role = scene.UISceneConfigurations.UIWindowSceneSessionRoleApplication[0];
    expect(role.UISceneDelegateClassName).toBe("EXExpoAppSceneDelegate");
    expect(app.expo.plugins).toContain("./plugins/withSceneLifecycle");
  });
});
