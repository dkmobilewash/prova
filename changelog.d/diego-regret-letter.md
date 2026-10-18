### Declining well, which is what keeps you on the bid list (Diego)
`diego/regret-letter`

A sub who ignores an invitation to bid gets dropped from the GC's list. One who
declines politely stays on it. That is the whole business case, and the
estimating workflow names it — *"send a polite Regret / Decline to Bid letter to
the GC to maintain relationship status"*.

#695 recorded the decision and why. This is the outward half: a one-page letter
at `/bids/[id]/regret`, print-styled HTML and the browser's own Save as PDF —
the same mechanism the proposal and the G702/G703 use, and **no new dependency,
no migration and no stored state.**

#### The internal reason is not the outward message

The reason recorded on a bid is for the sub's own reporting. *"We will not sign
your indemnity"*, *"you have paid us late before"* and *"your drawings were not
complete enough to price"* are all true, all useful internally, and none belong
in a letter whose purpose is being invited again.

`proposal/page.tsx` already sets this rule for a different document — *"a note
on the PRINTED page would be telling a customer our prices may be wrong, which
is a different and much worse sentence"* — so it is copied rather than
re-argued.

**Three of the nine reasons reach the letter. Six never do.**

| shared | why it helps both sides |
| --- | --- |
| `SCOPE_MISMATCH` | a GC inviting a drywall sub to bid glazing will keep doing it until somebody says so |
| `CAPACITY` | a neutral fact about our own book, reflecting on nobody |
| `SCHEDULE` | the same |

| withheld | why |
| --- | --- |
| `BONDING` | our balance sheet is nobody else's business, and saying it loses work we could carry |
| `CONTRACT_TERMS` | a refusal to sign is a negotiating position, not a farewell note |
| `DRAWINGS_INCOMPLETE` | true, and a criticism of their architect delivered while asking to be invited again |
| `PRICE_RISK` | reads as "we could not work out how to price this" — the opposite of the impression this letter exists to leave |
| `RELATIONSHIP` | the one that must never print. It is about this GC, and the letter is addressed to them |
| `OTHER` | uncontrolled text this module cannot vet. The sender can add it themselves |

`SHAREABLE` is a `Record` over the whole union, so **adding a reason to the enum
fails the build here** rather than silently defaulting — and the safe direction
is the one that requires a decision.

#### The omission is stated to the sender, print-hidden

An omission nobody is told about reads as a bug. So the page says the recorded
reason is deliberately not in the letter, names it, and sits inside a
`print:hidden` block — along with the free-text note.

Also print-hidden: a caution when the bid is **not** marked declined. The letter
renders for any bid on purpose, because somebody may write it before changing
the status, and refusing would send them to alter a record in order to print a
draft.

#### What the letter always says, and never says

Always: that we are not bidding **this** package, named and dated so it cannot
be mistaken for another; thanks for the invitation; and that we want the next
one — **a regret letter without that sentence is a resignation.** The ask names
the trade where it is known, because "keep us in mind" is forgettable and
"invite us on metal framing and drywall" is a note somebody can act on.

Never: a price, an apology that reads as incompetence, or any commitment about
future availability somebody would have to honour. No name is printed above the
company either — the app does not know which estimator is sending it, and a
letter signed by the wrong one is worse than one signed by hand.

#### Checks

- **Seven mutations, every one red**, and the two that matter most are the leak
  cases: making `RELATIONSHIP` shareable, and **removing `print:hidden` from the
  sender-note block so the GC would see the internal reason.**
  The others: `CONTRACT_TERMS` shareable; the sender never told why it was
  omitted; the letter dropping its ask for the next job; the sender note
  rendering on no screen; and nothing linking to the page.
- A test walks **every** reason and asserts the letter contains neither the
  enum value nor the dropdown's own label — the blunt form of the rule, since
  `RELATIONSHIP` is labelled "Not this GC" on a letter addressed to them.
- 22 tests. Preflight green. **No migration.**
- One assertion of mine was wrong and is recorded in the test: "prints no
  figure" first forbade any run of three digits and failed on the year in the
  bid date. A date is the one number this document should carry.

#### Click-list

1. On `/bids`, set a bid to **Declined** with reason **Not our scope**. A
   "Write the regret letter →" link must appear on that row — and on no row
   that is not declined.
2. Open it. The letter must name the project and the bid date, thank them, and
   say it sits outside the scope you take on. There must be **no** amber
   sender-note box, because that reason is shareable.
3. Change the reason to **Contract terms** and reload. The letter must now say
   nothing about why — and a bordered box above it, which must **not** appear
   in the browser's print preview, must say the reason is deliberately omitted
   and name it.
4. Press **Print**. Check the preview: no sender note, no internal reason, no
   back link, no print button.
5. Set the bid back to **Invited** and open the letter directly. An amber
   caution must say it is still marked invited, and must also be absent from
   the print preview.
