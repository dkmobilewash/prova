### A two-line fix should not cost a build and three hours in a queue (Diego)
`diego/eas-update`

No migration. `expo-updates`, an update URL, a runtime policy, three channels —
and two things the CLI broke on the way in.

**WHY, from today rather than from principle.** The note field was covered by
the keyboard. The first fix for it moved the content by zero pixels. Finding
that out took a full build, a submission that sat in EAS's queue for **nearly
three hours**, and a person with the phone in their hand. The real fix was two
lines. Then zoom landed with a coordinate assumption that may well need one
more line, and without this that is another build and another queue.

Installed with `npx expo install expo-updates` and configured with
`eas update:configure`, per the `expo:eas-update` skill, which says in as many
words not to hand-roll the url, policy, or channels.

**THE CLI DUPLICATED THE SCENE MANIFEST, AND THAT IS NOT COSMETIC.** It rewrote
`app.json` by APPENDING rather than merging:

```
UIWindowSceneSessionRoleApplication: [
  { UISceneConfigurationName: "Default Configuration", … },
  { UISceneConfigurationName: "Default Configuration", … }   <- added
]
```

That block is #620's fix for the iOS 27 launch trap — an app that does not
adopt the UIScene lifecycle is terminated at launch — and a malformed manifest
is exactly how that comes back, on a screen nobody can reach to report it. It
duplicated the Android permissions the same way. Both undone by hand, and the
scene manifest now diffs to **byte-identical** with what #620 shipped.

`lib/eas-update-config.test.ts` guards it, because the next Expo CLI command
that touches `app.json` will do the same thing and a second entry is invisible
in a diff full of legitimate config churn. It also pins the update config
itself, since a missing `updates.url` or a channel-less build profile **fails
silently**: the build succeeds, installs, and simply never updates.

| mutation | result |
| --- | --- |
| control | green |
| **the CLI's bug — scene config duplicated** | **RED** |
| `updates.url` removed | **RED** |
| duplicate android permissions | **RED** |
| the production profile loses its channel | **RED** |

The CLI also added an unrelated `android.permissions` block while normalising.
Removed: the config plugins inject those at build time regardless, this app
ships iOS only, and an unrelated change does not belong in this diff.

**TWO THINGS THIS DOES NOT DO.**

**No installed build can receive an update, including build 16.**
`expo-updates` is native, so the capability arrives with the next BUILD. Build
17 is the first that can be updated over the air; everything already on a phone
still needs a new build.

**The runtime policy is `appVersion`, which the CLI chose and I have left
alone** — the skill is explicit that changing it is a separate decision, not an
incidental fix. It is worth a deliberate look: `version` is `0.0.1` and has
been for sixteen builds, so every build shares the runtime `0.0.1` forever. A
JS update that needs a native module added later would be offered to builds
without it. The `fingerprint` policy hashes the native config instead and
cannot make that mistake. **That is a decision for Diego, not a side effect of
this PR.**

45 files / 365 tests and 16 / 78, both mobile suites, `expo lint` clean.
