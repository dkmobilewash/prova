### The release runbook, corrected by being the first person to run it (Diego)
`diego/eas-remote-version`

`RELEASE.md` and `store-readiness.test.ts` landed together to make the
phone app releasable. This is what running that path end to end for the
first time — a real production build, now `in progress` as `store`
distribution — found wrong with it.

**`autoIncrement` is half a setting, and the census pinned the half that
cannot fail.** `store-readiness.test.ts` asserted
`eas.build.production.autoIncrement === true`, with a comment about Apple
refusing a build number it has already seen. Correct, and not enough:
`autoIncrement` says to bump a number and `cli.appVersionSource` says
WHICH number, and the CLI will not guess. `eas build --profile production`
stopped and asked, on a repo where every test was green. Interactively
that is one keystroke and a prompt nobody documented; in CI or under
`--non-interactive` it is a build that never starts.

The shape is this repo's own, one notch further out than the entries it
already carries: not a census with the wrong pattern or the wrong scope,
but a census asserting **one half of a two-part requirement**. It could
not tell "the build number is handled" from "the build number is handled
up to a question we have not answered", because the half it checked was
true either way. `cli.appVersionSource` is now pinned beside it.

**`remote` is a decision, not the recommended default.** `local` makes
`autoIncrement` rewrite `app.json` on every build — a tracked file, in a
worktree two lanes share, dirtied by the act of building, conflicting
with anything else that touches it. Remote keeps the number in the EAS
account and the repo untouched.

**Two more corrections, both from the CLI's own output.** `eas env:create`
is deprecated in favour of `eas env:set` (eas-cli 24.7.0), which
`RELEASE.md` and `.env.example` both still taught. And `env:set` asks for
a visibility the runbook did not mention: **Plain text** is right, because
every `EXPO_PUBLIC_` value is inlined into the shipped bundle and is
therefore not a secret under any of the three options — while **Secret**
is write-only, which would forfeit the one check that matters here,
reading the value back to confirm `pk_live_` and not `pk_test_`. A crossed
pair does not error; it signs people in against one company's users and
reads another's data.

**And the trap between step 3 and step 4.** `eas submit` run before a
production build has finished does not say so. It opens a
*"What would you like to submit?"* menu listing every iOS build on the
account — which, on a first release, is development builds at `internal`
distribution that Apple rejects at upload, because TestFlight takes
`store` only. The menu reads as a choice and is really a signal that the
previous step has not happened. The runbook now says to check
`Distribution: store` before submitting.

**THE PUSH-KEY PROMPT DID NOT FIRE, AND THE RUNBOOK SAID IN CAPITALS THAT
IT WOULD.** Section 3 was headed "this is where the push key is made" and
told you to say yes to an APNs key, *"without it no notification can ever
arrive"*. The production build never asked. Nothing was wrong — key
`H84XACSPNN` had existed since 16 Sep, made by a DEVELOPMENT build, and
the very next line of that section says credentials are stored in the EAS
account so later builds stop asking. The two sentences contradicted each
other and the louder one was read first.

The cost was a session hunting a fault that did not exist, on the one
credential the file calls fatal. The prompt fires on the first build that
NEEDS the credential, which is usually months before release; **an absent
prompt is not evidence in either direction, so the runbook now says to
LOOK at the credentials list instead of inferring from a question.**

**AND THE SUBMIT FAILED ON A CREDENTIAL THAT HAD BEEN WRONG FOR TEN DAYS
WITHOUT SAYING SO.** An APNs key had been uploaded into the App Store
Connect API Key slot on 16 Sep. Both are `.p8` files and are
indistinguishable by eye; they come from different places and authorize
different things. Nothing complained at upload, nothing complained during
the build, and it surfaced only at the first authenticated submit call as
a 401 `NOT_AUTHORIZED` about a bearer token — an error naming none of it.

What DOES say so is the credentials page, which is now in the runbook: a
real key resolves to a team and a role, and the wrong one resolves to
`None` and `None`. Fixed with a new key at **App Manager** — least
privilege that can upload a build, manage TestFlight and read the app
record — and the SAME build then submitted, so the binary was never
implicated.

**A sub-second step never did the work it names.** `eas submit:view`
prints `errored` and no reason; the reason is the submission's step list,
where `Upload to App Store Connect` read `<1s` failing and `3s`
succeeding, on one build, twenty minutes apart. That duration is the
diagnosis, and it is the cheap reusable part: a submit that dies in under
a second has not touched the binary, so rebuilding is wasted time.

**What this still does NOT claim.** TestFlight itself — Test Information,
internal testers, the app arriving on a phone — happens in Apple's
systems and no test here can see it. `RELEASE.md` carries those as steps
a person takes, which is what they remain. What IS verified is the chain
up to Apple accepting the binary: build `adcf98b8` finished as `store`
distribution, submission `fed2eb3d` succeeded, same build id.

Mutation-tested: removing `appVersionSource` from `eas.json` turns the new
assertion red and names it; the assertion above it stays green, which is
the whole point of adding a second one.
