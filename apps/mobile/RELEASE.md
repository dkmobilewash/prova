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
npx eas env:create --environment production \
  --name EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY --value pk_live_...
npx eas env:create --environment preview \
  --name EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY --value pk_test_...
npx eas env:create --environment preview \
  --name EXPO_PUBLIC_API_URL --value https://<the deployment to test>
```

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
