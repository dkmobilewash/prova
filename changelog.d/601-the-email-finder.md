### A cold lead gets an email address, and the address says where it came from (Cyrus)
`cyrus/sales-signals`

CSLB's master file gave every lead a phone and states in so many words that it carries no
email. The outbound engine sends email. So every address on a cold lead has to be FOUND, and
a found address is only as good as how it was found — "printed on their contact page and
verified" and "guessed from the owner's name, nothing checked it" are both an email column,
and only one of them is safe to send to.

**Find email** on a lead, and **Find emails** on `/sales` for the 25 oldest leads with none:
the lead's website (typed, or found by a Brave search on name + city that skips Yelp, BBB,
CSLB, Facebook and the rest, and returns nothing rather than a doubtful match), then the
addresses that site prints on its own domain, then — only with an owner name — the nine
shapes a small shop's address usually takes. MillionVerifier checks at most six, stopping at
the first it accepts. Every result is a sentence on screen.

Three new nullable columns on `SalesLead`: `website`, `emailSource` (site / pattern /
caller) and `emailVerifiedAt`, which is set ONLY on the verifier's ok or catch-all verdict.
A guess with no verifier key is stored as a guess. An existing email is never overwritten —
the write is conditional on the column still being empty — and a do-not-contact lead is
never looked up. Typing an email by hand marks it "caller" and clears the verified time.

The fetch is SSRF-guarded: every hop, redirects included, is resolved first and refused if
any address is private, loopback, link-local or metadata; IP literals and non-web schemes
are refused before any lookup; redirects must stay on the same site. A refusal reaches the
screen as a sentence. Known ceiling, written beside the code: the address is checked and
then resolved again by `fetch`, so DNS rebinding gets one blind GET whose body is only
scanned for addresses.

**Click check:** open a lead with no email, type `example.com` into Website and Save, press
**Find email**. With no keys set it reads "example.com has no address on its site and there
is no owner name to guess from." when the lead has no contact name, or "Guessed
first@example.com from the owner's name — unverified, no verifier key set." when it has one —
and after the refresh the button is gone and the line reads "— guessed from the owner's
name, not verified."
