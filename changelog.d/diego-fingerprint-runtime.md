### The runtime is what the native code actually is, not what the version says (Diego)
`diego/fingerprint-runtime`

No migration. One policy value, and a build.

`eas update:configure` chose `runtimeVersion: { policy: "appVersion" }`, which
#659 left alone on purpose — the `expo:eas-update` skill is explicit that
changing the policy is a separate decision rather than an incidental fix.
Diego's decision, taken before the first update is published.

**WHY appVersion IS A CRASH HERE RATHER THAN A PREFERENCE.** It makes the
runtime the version string, and `version` has been `0.0.1` for **seventeen
builds** with nothing moving it. Every build past, present and future would
share one runtime forever — so a JS update that needs a native module added
later would be offered to builds that do not have it, and the app would open
and die on the first import. The compatibility boundary would exist in name
only.

`fingerprint` hashes the native inputs instead. **Verified by resolving it, not
by trusting the word:**

```
runtimeVersion  087238454c25e7c1b7e5cc870f697a6c39726636
sources         eas.json, plugins/withSceneLifecycle.js,
                assets/icon.png, and every autolinked iOS module —
                @clerk/expo, async-storage, masked-view, @expo/ui …
```

So adding a native module moves the runtime by itself, and an incompatible
update is never offered at all. It fails by withholding an update, which is the
safe direction.

| mutation | result |
| --- | --- |
| control | green |
| the policy reverted to `appVersion` | **RED** |

**THE COST, AND IT IS REAL: BUILD 17 CANNOT RECEIVE THESE UPDATES.** Its
runtime is the literal string `0.0.1`, baked in at build time, and a
fingerprint runtime will never match it. **Build 18 is the first that can be
updated over the air.**

Doing it now is still the cheap moment, and that is the whole argument for not
waiting: no update has been published, nobody is depending on 17's OTA, and the
same build would be needed whenever this change happened. Later it would cost
the same build PLUS a stranded set of installs.

**One thing to expect with pnpm.** The fingerprint's sources include autolinked
module directories, and pnpm puts content hashes in those paths — so a
dependency bump that changes a path changes the runtime, and the old builds
stop being updatable. That is more churn than npm would produce, and it errs
the right way: it refuses to send an update rather than sending one that might
not run.

46 files / 368 tests, `expo lint` clean.
