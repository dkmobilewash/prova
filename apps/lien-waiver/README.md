# Free lien waiver tool (`apps/lien-waiver`)

A public, no-account tool: a commercial framing, drywall or EIFS/stucco sub
picks a state, answers two questions, fills in the blanks on a phone and
downloads that state's **statutory** lien waiver as a PDF. A lead magnet for
C-Stream, and deliberately **separate** from it: its own Vercel project and
domain, no Clerk, no access to C-Stream's database, nothing imported from
`apps/web`. It lives in this repo only so CI tests it.

## The rule everything here serves

**Statutory text is never written or paraphrased by a person or a model.** It
is captured from the legislature's own site, stored byte for byte with its
SHA-256, and every form is *derived* from that capture by an enumerated,
reviewed list of removals. Tests re-derive the whole chain on every run and
fail on a one-character difference — including in the text read back out of
the PDF. Read `lib/statutes/generated.test.ts`, `lib/statutes/render.test.ts`
and `lib/pdf.test.ts` before changing anything under `lib/statutes/`.

**No state is shown in production until an attorney has reviewed it**, and a
review is bound to a digest of the exact text reviewed (`lib/statutes/review.ts`).
`REVIEWS` is empty today, so production shows only New Mexico's
no-statutory-form page.

**The tool computes no deadlines and never says a waiver is safe to sign.**
`lib/content.test.ts` fails the build on reassuring phrases.

## Layout

| Path | What |
| --- | --- |
| `statutes/sources.json` | every official page a form comes from |
| `statutes/raw/` | the captured bytes + `.meta.json` (URL, time, SHA-256, method) |
| `statutes/text/` | one paragraph per line, derived from `raw/` |
| `lib/statutes/states/*.ts` | each form as a paragraph span + enumerated removals + blanks |
| `lib/statutes/generated/forms.json` | the derived forms the app imports |
| `lib/statutes/normalization.ts` | the approved normalization list |
| `lib/statutes/questions.ts` | open questions for the attorney |
| `docs/attorney-packet.md` | GENERATED packet: text, removals, digests, questions |
| `docs/research.md` | the research note, with sources |

## Changing a statute or a form

1. Statute amended, or a new state: add it to `statutes/sources.json` and push.
   The **Capture statutes** workflow fetches it and commits the bytes. For a
   site that refuses scripts or only renders in a browser (Texas, California),
   capture a rendered copy and import it with `scripts/import-rendered.mjs`.
2. Write or adjust the definition in `lib/statutes/states/`.
3. `pnpm --filter @prova/lien-waiver statutes:update`, then **read the diff** of
   `forms.json` and `docs/attorney-packet.md`. Changed form text means the
   state's review no longer matches and it drops out of production.
4. Send the packet section to the attorney; record the review in `REVIEWS`.

## Deploying (Diego)

Vercel project **`lien-waiver-tool`** (team "Diego's projects",
`prj_Dd1q4nwsBrAsFJuYG0oNYhNY8oMM`), Root Directory `apps/lien-waiver`, set to
skip deployments for commits that do not touch this app. Its `vercel.json`
sets the install and build commands.

The import screen cannot offer `apps/lien-waiver` as a root directory while the
app exists only on a branch -- it browses the default branch. Create the
project at the repo root, let that first build fail, then set the root in
Settings (or through the API), which takes any path. Environment variables:

| Variable | Needed for |
| --- | --- |
| `LIEN_TOOL_DATABASE_URL` | Postgres for rate-limit counters only (no lead data). A tiny Neon project of its own. Production refuses to send without it. |
| `RATE_LIMIT_SALT` | random string; salts the hashed IPs and emails. Required in production. |
| `RESEND_API_KEY` | sending the PDF and the lead note |
| `LIEN_TOOL_EMAIL_FROM` | the sender, on a domain verified in Resend |
| `RESEND_AUDIENCE_ID` | the Resend audience leads are added to |
| `LEAD_NOTIFY_EMAIL` | where lead notes go (default `diego@cstream.ai`) -- **set** |
| `EMAIL_ALLOWLIST` | outside production, the ONLY addresses email goes to (default `diego@cstream.ai`) -- **set** |
| `LIEN_TOOL_MAILING_ADDRESS` | printed at the foot of every email (C-Stream's email rule) |
| `NEXT_PUBLIC_CSTREAM_URL` | where "Get a free job breakdown" points (default `https://cstream.ai`) -- **set** |

Optional extra layer, not configured by code: a Vercel Firewall rate-limit rule
on `/api/waiver` and `/api/notify`.
