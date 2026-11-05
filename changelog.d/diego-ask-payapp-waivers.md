### Ask starts a pay application, a retainage bill and a lien waiver, and each form's own button is still the write (Diego)
`diego/ask-payapp-waivers`

"Bill Fulton for October" used to reach only `draft_invoice`, which needs an amount
said out loud. It now gets a pay application card: the job's Billing tab opens with
the G702/G703 form open and its period-to set to October 31 (`periodEndFromWords`:
a bare month is the latest one that has already started, because nobody bills for a
period that hasn't happened). The card carries no line and no amount, and the person
enters each line's work on the form, so the reason `submitPayApplication` was never
a command still holds. "Bill the retainage on Fulton" opens Bill the retainage with
the held balance, or the figure said, refused when it is above what is held.

"Send the lien waiver for Hutto pay app 4" opens the Billing tab's own Issue a waiver
form with what `waiverOfferFor` decides for that application: conditional, progress
or final, the application's current payment due and its period-to. There is no
exception field anywhere in the card's payload — putting one there fails the test —
so the excepted amount opens empty, as it always has. Issuing is the form's button,
and sending stays on the waiver's row.

`pnpm test:e2e -- --ask-click` is new and LOCAL ONLY. It types four sentences into
Ask, taps each card, checks the page opened with the form filled in, presses the
page's button and reads the record back from the throwaway database. Without
ANTHROPIC_API_KEY the model's choice of command is stubbed, but the card row is
written by the command's real `resolve` and `recordProposal`. The stub first sent
a `done` after the card, which the real stream never does, and it crashed the
panel. Breaking two expected values fails exactly those two tests.

The closeout package to the GC is not here: it lives on `/closeout` in Cyrus's lane,
and goes with his PR.
