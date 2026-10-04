const { withAppDelegate } = require("expo/config-plugins");

/**
 * ADOPT THE UIScene LIFE CYCLE, WHICH EXPO 57 SHIPS BUT DOES NOT WIRE UP.
 *
 * On iOS 27 an app that does not adopt scenes is TRAPPED at launch —
 * `_UIApplicationEvaluateRuntimeIssueForNoSceneLifecycleAdoption`, EXC_BREAKPOINT,
 * before any JS runs. Found 2026-10-04 on the iPhone 18 Pro simulator, which is
 * the only runtime installed; the app never reached its first screen.
 *
 * Expo 57.0.23 ships BOTH halves of the fix in its own iOS source —
 * `ExpoAppSceneDelegate` and the `ExpoReactNativeFactoryProvider` protocol — but
 * `@expo/prebuild-config` emits neither the Info.plist manifest nor an
 * AppDelegate that conforms (checked: zero hits for `UIApplicationSceneManifest`
 * in prebuild-config). So the generated template is the pre-scene one and this
 * plugin closes the gap until Expo's template catches up.
 *
 * Two edits, and the second is the one that is easy to miss. Declaring the
 * conformance alone still crashes: `ExpoAppSceneDelegate.scene(willConnectTo:)`
 * creates the window itself, so an AppDelegate that ALSO creates one and calls
 * `startReactNative(in:)` is mounting React twice into two different windows.
 *
 * THE MANIFEST ITSELF IS NOT HERE — it is `ios.infoPlist` in app.json, where it
 * is readable without opening a plugin. This file only does what app.json
 * cannot: patch generated Swift.
 */

const CONFORMANCE_FROM = "class AppDelegate: ExpoAppDelegate {";
const CONFORMANCE_TO = "class AppDelegate: ExpoAppDelegate, ExpoReactNativeFactoryProvider {";

// The pre-scene window block, verbatim from the 57.0.23 template.
const WINDOW_BLOCK = `#if os(iOS) || os(tvOS)
    window = UIWindow(frame: UIScreen.main.bounds)
    factory.startReactNative(
      withModuleName: "main",
      in: window,
      launchOptions: launchOptions)
#endif

`;

const WINDOW_REPLACEMENT = `// The window and the React Native mount belong to ExpoAppSceneDelegate under
    // the scene life cycle. Creating one here too mounts React twice.

`;

function patch(contents) {
  let next = contents;

  // Each edit asserts it found its anchor. A no-op plugin that "succeeds" is
  // the exact failure this repo keeps paying for: the build goes green and the
  // app traps at launch, with nothing anywhere saying the patch did nothing.
  if (next.includes(CONFORMANCE_TO)) {
    // already applied — prebuild can run repeatedly
  } else if (next.includes(CONFORMANCE_FROM)) {
    next = next.replace(CONFORMANCE_FROM, CONFORMANCE_TO);
  } else {
    throw new Error(
      "withSceneLifecycle: could not find the AppDelegate class declaration to add " +
        "ExpoReactNativeFactoryProvider to. The Expo template has changed — check whether it now " +
        "adopts scenes on its own, and delete this plugin if it does.",
    );
  }

  if (next.includes(WINDOW_REPLACEMENT.trim())) {
    // already applied
  } else if (next.includes(WINDOW_BLOCK)) {
    next = next.replace(WINDOW_BLOCK, WINDOW_REPLACEMENT);
  } else {
    throw new Error(
      "withSceneLifecycle: could not find the pre-scene window block in AppDelegate.swift. " +
        "If the Expo template stopped creating its own window, this half is done upstream and " +
        "should be removed here rather than left matching nothing.",
    );
  }

  return next;
}

module.exports = function withSceneLifecycle(config) {
  return withAppDelegate(config, (cfg) => {
    if (cfg.modResults.language !== "swift") {
      throw new Error(
        `withSceneLifecycle: expected a Swift AppDelegate, got ${cfg.modResults.language}.`,
      );
    }
    cfg.modResults.contents = patch(cfg.modResults.contents);
    return cfg;
  });
};

module.exports.patch = patch;
