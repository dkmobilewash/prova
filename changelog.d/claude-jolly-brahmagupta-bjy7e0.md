### A free lien waiver tool that prints statutory wording, which C-Stream itself still never does (Diego)
`claude/jolly-brahmagupta-bjy7e0`

`apps/lien-waiver` is a new, separate app: a public, no-account page where a
framing, drywall or EIFS sub picks Arizona, California, Nevada or Texas, answers
two questions, fills in the blanks on a phone and downloads that state's
statutory waiver as a PDF. It is a lead magnet. It has its own Vercel project and
domain, no Clerk and no access to C-Stream's database, and imports nothing from
`apps/web`. It lives in this repo only so CI tests it.

**THE DECISION THIS RECORDS, because two files in this repo say the opposite and
both are still right.** `apps/web/lib/lien-waiver.ts` says the app "does not
generate statutory wording", and `lien-waivers.prisma` says "no
state-rules table, and no generated statutory wording". `lien-deadlines.ts` says
the app "never computes a legal deadline". This tool DOES print statutory
wording, deliberately: Diego decided it on 2026-10-08. Neither C-Stream file
changes, because both are about C-Stream, which still does neither. The
deadline rule is untouched everywhere: this tool computes no date of any kind.

What makes printing statutory text defensible is how the text gets there, and
that is the whole build:

- **Nobody writes it.** Each statute page is captured from the legislature's own
  site, stored byte for byte with its SHA-256, and each form is *derived* from
  that capture: a span of paragraphs plus an enumerated list of the characters
  removed and the rule each removal falls under. Five rules, approved as a list
  (`lib/statutes/normalization.ts`): whitespace, NFC, Texas's paragraph quote
  marks, drafting punctuation, and drafting instructions. Nothing else may differ.
- **A test fails on one character.** `generated.test.ts` re-derives raw → text →
  forms → attorney packet on every run. `render.test.ts` takes every filled form
  back to the statute. `pdf.test.ts` does the same to the text pdf.js reads OUT OF
  THE PDF, with the header and footer cut away by position.
- **No state ships unreviewed.** Production hides a state until a construction
  attorney's review is recorded against a digest of its exact forms and our copy
  (`lib/statutes/review.ts`). Change a character afterwards and the review stops
  matching. `REVIEWS` is empty today, so production would show only New Mexico.
- **New Mexico has no statutory form**, so the tool offers none. It explains why
  and takes a "notify me" sign-up instead of inventing one.

**Two things that would have shipped silently.** Node's
`TextDecoder("windows-1252")` decodes as Latin-1 on a build without full ICU, so
Nevada's byte `0x92` became an invisible control instead of `’`. "Undersigned’s
Customer" read "Undersigneds Customer", and nothing on screen showed a character
had gone. Extraction now decodes from the WHATWG table and refuses any control
character. And pdf-lib measures text WITH kerning but draws it WITHOUT, so the
word after a bold "PAYMENT." started 4pt early, on top of it. The PDF test caught
it by reading "PAYMENT.A" back out of the file.

Capture runs in a workflow (`capture-statutes.yml`) because an agent container
cannot reach any legislature host. Texas (a JavaScript app) and California (403
to GitHub's runners) are captured as headless-browser renders written straight
to disk, and their `.meta.json` says so.

The check: `pnpm --filter @prova/lien-waiver test`. Edit any character in
`lib/statutes/generated/forms.json` or `statutes/text/*.txt` and it fails.
