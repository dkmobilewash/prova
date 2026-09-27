# Getting the phone app onto a phone that isn't Diego's

Everything here runs from **Diego's terminal**, signed into Expo and
Apple. None of it can be done by an agent: `eas build` needs an Expo
session and Apple credentials, and App Store Connect needs a human in a
browser. What the repo can do — the config a build depends on — is
pinned by `lib/store-readiness.test.ts`, which fails the build if any of
it goes missing.

Today the app runs only from Metro on a laptop. Close the laptop and it
is dead, which is the whole distance between "built" and "in the field".

## 0. What is already true

- `app.json` carries the bundle id (`com.cstream.prova`), the EAS project
  id, the owner, permission strings, icons and the export-compliance
  answer.
- `eas.json` has development / preview / production profiles, each naming
  an EAS environment, and production auto-increments its build number.
  That takes TWO settings, not one: `autoIncrement` on the profile says to
  bump a number, and `cli.appVersionSource: "remote"` says which number —
  one kept in the EAS account rather than in `app.json`. With only the
  first, the CLI stops and asks; a non-interactive run fails there instead.
  Remote is deliberate: `local` makes every build rewrite `app.json`, a
  tracked file in a worktree two lanes share. `store-readiness.test.ts`
  pins both halves, having pinned only the first until 2026-09-26.
- `EXPO_ACCESS_TOKEN` is set in Vercel (production and preview) — that is
  the SERVER's key for sending pushes, and is unrelated to the credentials
  below.

## 1. Sign in and check the account

```
cd apps/mobile
npx eas-cli login
npx eas whoami            # must print the account that owns `diegocstream`
```

If `whoami` prints a different account, stop: a build made under the
wrong account cannot be submitted from the right one.

## 2. The environment values a cloud build cannot read from your laptop

`.env` is gitignored and Expo does not upload it to EAS Build, so the
values have to live in EAS. `EXPO_PUBLIC_API_URL` is already in
`eas.json` for production; the Clerk key is not, because a key does not
belong in the repo:

```
npx eas env:set --environment production \
  --name EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY --value pk_live_...
npx eas env:set --environment preview \
  --name EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY --value pk_test_...
npx eas env:set --environment preview \
  --name EXPO_PUBLIC_API_URL --value https://<the deployment to test>
```

`env:set`, not `env:create` — the CLI answers the old name with *"This
command is deprecated. Use eas env:set instead"* (eas-cli 24.7.0).

**It then asks for a visibility: Plain text, Sensitive or Secret. Choose
Plain text**, and the reason is worth more than the answer. Every
`EXPO_PUBLIC_` value is inlined into the JavaScript bundle at build time —
it ships on every phone and can be read out of the binary, so none of the
three options makes it a secret and marking it Secret claims a protection
that does not exist. What Secret *does* do is make the value write-only,
so it can never be read back — and reading it back is the one check worth
having here:

```
npx eas env:list --environment production   # confirm pk_live_, not pk_test_
```

A crossed pair does not error. It signs people in against one company's
users and reads another's data, which is a thing you can only catch by
looking.

**Match the pair.** `pk_live_` goes with `https://app.cstream.ai`;
`pk_test_` goes with a preview or a local server. Crossed, you get a
build that signs people in against one company's users and reads
another's data.

A build made without these does not fail — it installs and then says
*"This build isn't finished"*, naming what is missing. That screen is
`lib/env.ts`, and it exists because the alternative was an app that
reported "No connection" forever.

## 3. The first iOS build — this is where the push key is made

```
npx eas build --platform ios --profile production
```

EAS will ask to log into Apple and then offer to create, for this bundle
id:

- a **distribution certificate**,
- a **provisioning profile**,
- a **push key (APNs)** — say yes. **Without it no notification can ever
  arrive, no matter what the server does.** This is the missing half of
  the alert-push work; the server key (`EXPO_ACCESS_TOKEN`) has been in
  Vercel since 2026-09-17 and cannot help on its own.

Credentials are stored in the EAS account, so later builds stop asking.

## 4. The App Store Connect record

In App Store Connect, create an app:

- Bundle ID **com.cstream.prova** (it appears once the build above has
  registered it),
- SKU: anything stable, e.g. `cstream-prova`,
- Name: **C Stream**.

Then:

```
npx eas submit --platform ios --profile production
```

It asks for the Apple ID, the team, and the App Store Connect app id, and
remembers them.

**Wait for step 3 to report `finished` before running this.** With no
finished production build, submit cannot pick one and instead opens a menu
— *"What would you like to submit?"* — offering to select a build from
EAS. The list it shows is every iOS build on the account, and on a first
release those are all `development` profile, `internal` distribution.
Apple rejects one of those at upload: TestFlight takes `store`
distribution only, which is a different certificate and profile. So the
menu reads like a choice and is really a signal that the build step has
not happened yet. Confirm which kind you have before submitting:

```
npx eas build:list --platform ios --limit 1
#   Status        finished
#   Profile       production
#   Distribution  store        <- the line that matters
```

## 5. TestFlight

The build appears in TestFlight after Apple finishes processing
(minutes). Add testers by email under **Internal Testing** — internal
testers need no review. Each tester installs TestFlight, accepts, and
gets the app.

**This is the moment the app stops being Diego's.** Everything before it
is preparation.

## 6. Only when going public

Not needed for TestFlight, and not worth doing before the app has been
used on a site for a while:

- privacy labels (the app collects photos, location and the account's
  email),
- screenshots, description, support URL, a privacy policy URL,
- App Review, which is where the two known risks live:
  - **Account deletion.** Apple requires apps that support account
    creation to offer in-app deletion. This app signs people IN and never
    creates accounts — the office adds people — so the requirement should
    not apply, but be ready to say that in the review notes.
  - **Sign in with Apple.** Required when an app offers third-party
    login *exclusively*. Email and password sign-in landed in #427
    precisely so that is not the case here.

## What is deliberately not in this repo

Certificates, the APNs key, the App Store Connect record and the Apple
account all live in Apple's and Expo's systems. `store-readiness.test.ts`
asserts the things a file can see and stops there: a test that claimed a
push key existed would be the worst kind of green.
