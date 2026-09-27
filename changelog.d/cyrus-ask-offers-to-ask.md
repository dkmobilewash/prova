### When Ask doesn't know, it now says who would — from the rows — and offers to draft them the message (Cyrus)
`cyrus/ask-offers-to-ask`

The launch video's third beat asks the box "who actually showed up on
Riverside last Tuesday?" and the right answer is still "I don't know":
nothing in this app records attendance, and refusing to guess is the whole
point of the beat. What Cyrus asked for is the sentence after it — *"Would
you like me to draft a message to whoever would know?"* — then the draft,
then a confirm, then it goes.

**What was already there, and is reused rather than rebuilt.** The
propose → card → confirm flow (`AskProposal`, `confirmAskProposal`), the
HANDOFF mode where a card opens a page's own form prefilled
(`lib/ask/drafts.ts`), the `/messages` composer and its `sendOutboundEmail`
action, and `send_email`'s rule that the model supplies a NAME and the row
supplies the address. `sendHelpRequestEmail` was looked at and is not this:
it addresses only the support inbox by construction.

**What was added: two registry entries and one prompt rule.**

- `who_would_know` (read tool, MANAGE_FIELD). For a job and a day it reads the
  three rows that NAME somebody — who filed that day's daily field report,
  who was on the crew schedule for that day, who is assigned to the job —
  and returns each name with where it came from. The result carries
  `attendanceIsRecorded: false` beside the names, marks the asker (so nobody
  is offered an email to themselves), and lists a crew member with no login
  as `canBeEmailed: false` rather than dropping them. A day that names
  nobody comes back as `unavailable` in words, not an empty shape.
- `ask_teammate` (command, T4, HANDOFF, MANAGE_JOBS). Takes the teammate's
  name, the job, the day in the person's words and optionally their
  question; the address comes off the `User` row, the day is parsed by
  `dates.ts`, and the subject and body are COMPOSED IN CODE from the job,
  the day and the person's words — there is no body field for the model to
  write. The card opens the composer; the person presses Send there. A
  crew member is refused with where their phone is, the asker's own account
  is refused, a name matching nobody is refused, several is a chip row.
- The prompt rule (`answer.ts`): refuse first, in one sentence; call
  `who_would_know`; name ONLY what it returns, with sources, never as having
  been on site; ask whether to draft; call `ask_teammate` only on a yes; if
  it names nobody, say so and offer nothing.

**What a test proves** (`handlers.whoWouldKnow.test.ts`,
`commands/askTeammate.test.ts`, plus the registry censuses that now
include both): every name traces to a row and every query carries
`companyId`; the model cannot supply an address, subject or body; the crew
member, the asker and the stranger are each refused in words; the payload
is exactly what the composer loader reads. **What no test here can prove:**
what the model SAYS. CI runs with `ANTHROPIC_API_KEY` forced empty, so the
refusal-then-offer wording is checked only by a person asking a deployment
that has a key.

**Deferred, on purpose.** Cyrus's fuller ask — every "I don't know" ends
with what the box knows and where to find the answer — is not one thing:
some gaps name a person to ask, some name a screen to fill in, some are
outside the product, and some are refusals that exist because a human
must judge and must never grow an action. The general design (a declared
next step on every `KNOWN_GAPS` entry, from a closed set, with a census)
is written up in a comment on `KNOWN_GAPS` and built for none of them yet,
rather than half of them.
