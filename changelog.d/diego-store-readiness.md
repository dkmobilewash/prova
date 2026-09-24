### The phone app gets a release path, and push gets the id it was missing

**A build that cannot register for push, silently.** `registerForPush`
called `getExpoPushTokenAsync()` with no arguments. Expo's docs are
explicit that the project id "defaults to
`Constants.expoConfig.extra.eas.projectId` … When using EAS Build, this
value is automatically set. However, it is recommended to set it
manually" — and the case that matters is the one where inference fails,
a development build, which is the only kind this app has ever run as.
Without an id the call throws; the function is fire-and-forget at launch,
so the throw is swallowed and push simply never works with nothing said.
It now resolves the id from either place `expo-constants` can hold it,
passes it explicitly, and says so in the log when there is none.

**And a census for the things that fail late and expensively.**
`store-readiness.test.ts` pins what an EAS build and an App Store review
depend on: the bundle id, the project id, the owner, the images actually
existing on disk, the export-compliance answer that otherwise turns every
submit into a manual question, and a real sentence behind every
permission the app asks for — derived from the plugins list rather than a
hardcoded roster, so a new permission is covered without editing the
test. Each failure here is one that would otherwise appear twenty minutes
into a build, a day later in review, or never: as a feature that quietly
does nothing on a foreman's phone.

Mutation-tested three ways: removing the project id, shortening a
permission string to "Needs camera", and pointing the icon at a file that
is not there each turn it red with the reason named.

**What the repo deliberately does NOT assert**, and `RELEASE.md` carries
instead: certificates, the APNs push key, the App Store Connect record.
Those live in Apple's and Expo's systems, a test cannot see them, and one
that claimed a push key existed would be the worst kind of green. The
document is the command sequence for a person — including the step where
EAS offers to create the APNs key, which is the missing half of alert
push. The server's `EXPO_ACCESS_TOKEN` has been in Vercel since
2026-09-17 and cannot help without it.
