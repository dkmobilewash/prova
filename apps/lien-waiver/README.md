# Free lien waiver tool (`apps/lien-waiver`)

A public, no-account tool: a commercial framing, drywall or EIFS/stucco sub
picks a state, answers two questions, fills in the blanks one screen at a
time on a phone, and gets that state's **statutory** lien waiver as a PDF
**by email only** -- there is no download, and the API never returns the
PDF, so every waiver leaves a name and an address behind (Diego,
2026-10-13). A lead magnet for
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

**Where it is served.** `cstream.ai/lien-waiver`. The C-Stream app (`apps/web`, project
prova-web) owns `/lien-waiver` itself, which is Cyrus's landing page, and rewrites
`/lien-waiver/*` to this app. Set `LIEN_WAIVER_TOOL_ORIGIN` on prova-web to this project's
production origin. This app is built with `basePath: "/lien-waiver"`, so its picker is
`/lien-waiver/start` and its forms are `/lien-waiver/<state>`. The landing page's button
reads `LIEN_WAIVER_TOOL_URL` on prova-web (`/lien-waiver/start`).

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
| `LIEN_TOOL_MAILING_ADDRESS` | printed at the foot of every email (C-Stream's email rule) |
| `NEXT_PUBLIC_CSTREAM_URL` | where "Get a free job breakdown" points (default `https://cstream.ai`) -- **set** |

Optional extra layer, not configured by code: a Vercel Firewall rate-limit rule
on `/api/waiver`, `/api/change-order` and `/api/notify`.

## Change order request (2026-10-17)

The second free tool, at `/lien-waiver/change-order` (`app/change-order`,
`components/ChangeOrderTool.tsx`, `lib/change-order*.ts`). Not statutory, so no
attorney gate; `lib/content.test.ts` fails the build on anything in it that
reads as legal advice or a payment promise. Same frame (`components/StepShell.tsx`),
same email-only delivery and the same rate-limit counters as the waiver
(`deliverPdf` in `lib/waiver-request.ts`). Backup documents are listed by name
on the PDF, not uploaded. No new environment variables.

On cstream.ai it already works at `cstream.ai/lien-waiver/change-order` through
the existing `/lien-waiver/:path+` rewrite. A bare `cstream.ai/change-order`
needs its own rewrite on prova-web (`/change-order` ->
`${LIEN_WAIVER_TOOL_ORIGIN}/lien-waiver/change-order`); the page's assets and
API stay under `/lien-waiver/*`. Check it on a preview before linking it: the
browser URL would then not start with this app's basePath.

After a send only the sub's company (and, on the send screen, their name and
email) is kept: the next request starts empty and dated today. An unfinished
draft survives a reload, but a past date on it moves up to today.

## T&M / extra-work ticket (2026-10-18)

The third free tool, at `/lien-waiver/tm-ticket` (`app/tm-ticket`,
`components/TmTicketTool.tsx`, `lib/tm-ticket*.ts`). The end-of-day ticket a
foreman writes for work outside scope: company, project and GC, date of work,
a one-line description and details, the crew as chips, each person's hours,
material and equipment (quantities and units), then the GC superintendent
reads it, signs ON THE SCREEN (a canvas, pointer events, one SVG path, no
library) and types name, title and email. One email carries the PDF to the
foreman and the super together (`cc` through `deliverPdf`); each address is
held to the daily cap, and only the foreman is a lead.

- **No money.** Hours and quantities only; `lib/content.test.ts` fails the
  build on a `$`, a price/cost/rate/amount word, "paid", "payment" or
  "approved" in the PDF or the email, and on payment promises anywhere in the
  tool's files.
- **Ticket number** `TM-<second, base 32>-<3 random>`, issued by the browser
  (`issueTicketNumber`). Never repeats within one browser with its storage
  intact (each number's second is later than the last one issued there);
  across devices it relies on the random part (1 in 32,768 within the same
  second). Not globally unique, not sequential, no server counter.
- **No photo.** The app has no file storage; the work screen says to send
  photos with the PDF.
- **"Turn these tickets into a change order"** on the sent screen opens
  `/change-order?from=tm-ticket`. Only that flag is in the URL: the tickets
  sent from this browser (kept in `localStorage`, newest 20) are added to the
  change order as lines with the price EMPTY, listed under Backup, and
  cleared.

A bare `cstream.ai/tm-ticket` needs its own rewrite on prova-web, like the
change order request. No new environment variables.

## Pre-fill links (2026-10-14)

An outreach link can open a waiver that is already started. Every parameter
is optional and only ever fills a blank, which stays editable; with no
parameters the tool is exactly what it was.

    /lien-waiver/start?state=CA&type=cp&company=Test%20Drywall%20Inc&gc=Test%20GC&ref=TEST-0001

| parameter | what it does |
| --- | --- |
| `state` | `AZ` `CA` `NV` `TX`: skips the picker. Anything else, or a state this deployment hides (Texas in production), shows the picker. |
| `type` | `cp` `up` `cf` `uf`: pre-selects the two answers on the waiver-type screen, which is still shown with its warnings. |
| `company` `owner` `project` `address` `gc` | fill the matching blank -- per state, via `PREFILL_MAP` in `lib/prefill.ts`. `company` also fills the send screen's Company. |
| `license` | accepted and ignored: no state's statutory form has a licence blank. |
| `ref` | tracking code, letters/digits/`.-_`, 40 max. Never on screen or in the PDF; goes on the lead note to Diego (subject and body) and on the Resend contact as the `ref` property. |

Which blank each one fills, per state (from the forms themselves):

| | company | gc | owner | project | address |
| --- | --- | --- | --- | --- | --- |
| AZ | companyName | customer | owner | project | jobDescription ("located at") |
| CA | companyName | customer | owner | -- | jobLocation |
| NV | companyName | customer | -- | project ("Property name") | jobLocation ("Property location") |
| TX | companyName | customer | owner | project | jobLocation |

Values are plain text: tags stripped, trimmed, 120 characters (address 200).
Unknown parameters -- `email`, `phone`, anything else -- are dropped and not
even forwarded from `/start`. Link values override this browser's memory for
the visit and are only saved to it when the person sends. Opening a link with
a `ref` logs one JSON line, `{"event":"prefill_link_opened","ref":...,"state":...}`
(`/api/prefill-opened`), and nothing about the person.

**For the `ref` to show in Resend's contact list and CSV, create a contact
property named `ref` in Resend first.** Until it exists Resend refuses the
property; the contact is then saved without it (the lead note still carries
the ref) and the runtime log says so.

