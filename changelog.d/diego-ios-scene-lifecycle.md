### The app traps at launch on iOS 27, and every suite was green (Diego)
`diego/ios-scene-lifecycle`

No migration. One `app.json` key, one config plugin, one test file, two
`.gitignore` lines.

**WHAT HAPPENS WITHOUT THIS.** On iOS 27 an app that does not adopt the
UIScene life cycle is TRAPPED at launch —
`_UIApplicationEvaluateRuntimeIssueForNoSceneLifecycleAdoption`,
EXC_BREAKPOINT/SIGTRAP, on `com.apple.main-thread`, **before a line of JS
runs**. No splash, no error, straight back to the home screen. Found
2026-10-04 while trying to drive a simulator for something else entirely;
the iPhone 18 Pro on iOS 27.0 is the only runtime installed on this Mac.

**Expo 57.0.23 ships BOTH halves of the fix and wires up neither.**
`ExpoAppSceneDelegate` and the `ExpoReactNativeFactoryProvider` protocol are
in the package's own iOS source. `@expo/prebuild-config` emits no
`UIApplicationSceneManifest` (zero hits) and generates the pre-scene
AppDelegate, so a stock prebuild produces an app that cannot launch on 27.

**Two edits, and the second is the one that is easy to miss.** Declaring the
conformance alone still crashes — it just moves the crash INTO
`ExpoAppSceneDelegate.scene(willConnectTo:)`, which was the single most
useful signal in the whole investigation:

| build | what happened at launch |
| --- | --- |
| stock prebuild | trap in `…NoSceneLifecycleAdoption`, no UI |
| manifest only, no conformance | `fatalError` inside `ExpoAppSceneDelegate` |
| manifest + conformance + window removed | **launches, mounts React Native, renders** |

The scene delegate creates the window itself, so an AppDelegate that also
creates one and calls `startReactNative(in:)` mounts React twice into two
different windows.

**Where each half lives, and why they are not in the same place.** The
manifest is CONFIG and sits in `app.json`'s `ios.infoPlist`, where a reader
sees it without opening a plugin. `plugins/withSceneLifecycle.js` does only
what `app.json` cannot: patch generated Swift.

**The plugin THROWS when an anchor is missing, and that is the part worth
keeping.** A patch that silently matches nothing produces a green build and
an app that traps on a phone — this repo's most expensive recurring shape. If
Expo's template moves, `prebuild` fails loudly and names what to check
instead of shipping a dead binary.

| mutation | result |
| --- | --- |
| control | green |
| **plugin made a no-op** | **RED** |
| conformance added, window block left in | **RED** |
| manifest names the wrong delegate class | **RED** |

Each was confirmed to have RUN rather than merely gone red, because a build
break reports itself as a caught regression.

**READ WHAT THE TEST CANNOT DO.** `lib/scene-lifecycle.test.ts` proves the two
Swift edits are present and correctly shaped. It cannot prove iOS HONOURS
them — only a launch does, and a launch is what found this. Same shape as the
`expo-router` header entry in CLAUDE.md one layer down: *nothing is ever
missing from a question nobody is asking.* Every suite in this repo was green
while the app could not start.

**What is NOT established, deliberately.** The trap was observed on a DEBUG
build. Apple's `EvaluateRuntimeIssue…` family is typically debug-only, and
**whether a release/TestFlight build also traps on iOS 27 is UNVERIFIED**.
Diego's phone is on iOS 26.7.1, where build 13 runs fine, so nothing is
broken for anyone today. The fix is correct regardless — scene adoption is
required going forward — but nobody should read this entry as saying the
shipped app is currently crashing, and nobody should read it as saying it
isn't. It needs one device on iOS 27 running a release build.

`apps/mobile/ios` and `android` are now ignored: prebuild writes 1.2GB, and
this PR is what makes people run it.

Mobile: 40 files / 333 tests, screens 15 / 74, typecheck clean.
