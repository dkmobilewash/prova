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

**What this does NOT claim.** The build was still running when this was
written, so nothing here asserts that the submit, the App Store Connect
record or TestFlight itself work — those remain what `RELEASE.md` has
always said they are, steps a person takes in Apple's systems that no
test in this repo can see. Only the prompts above were observed, and each
correction is one of them.

Mutation-tested: removing `appVersionSource` from `eas.json` turns the new
assertion red and names it; the assertion above it stays green, which is
the whole point of adding a second one.
