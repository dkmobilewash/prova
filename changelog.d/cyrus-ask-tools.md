### Ask answers "what needs me today", looks up a phone number, and gives one job at a glance; it can also add a pursuit, move a pursuit's stage, put someone on the schedule and add a contact, each behind a confirm card (Cyrus)
`cyrus/ask-tools`

**Three new read tools. Each one reuses the query behind its page, so none of them counts anything a second way:**

- `needs_attention` calls `loadAlerts`, the same loader `/alerts` and the bell use. It passes the asker's principal, so a foreman is not told about a backcharge and money figures are stripped where their access does not include them. If there is no person to ask for, the tool refuses instead of falling back to `loadAlerts`'s OWNER default.
- `contact_lookup` returns the account's phone, email and address to everyone, because `/contacts` is open. It returns the people at the account only to MANAGE_ESTIMATING, which is the gate on `/contacts/[id]`'s People section. For anyone else the people query never runs; they get `peopleWithheld: true`.
- `job_overview` puts together what `job_margin`, `open_rfis`, `open_punch_list` and `change_order_status` already say about one job. Each section is gated on the capability its own tool takes, and the check happens before the section is read. A section someone cannot see is named in `withheldFromYou` and never shown as zero.

**Four new write commands.** Each is DIRECT over the ActionResult action the page's own form calls, so the capability check, the validation and the refusal sentences all come from that action. `resolve` never writes. Nothing is written until the person taps Confirm.

- `add_bid_pursuit` → `createBidPursuit`
- `set_pursuit_stage` → `setBidPursuitStage`. The stage is always the word the person said, mapped in code. An unknown word gets a row of chips with all five stages; the command never guesses one.
- `schedule_crew` → `scheduleCrewDay`. It finds a User or a crew member with no login, the way the `/schedule` form does. If that person is already on that job that day, the card links to the existing day instead of offering a button that can only fail.
- `add_contact` → `createContact`. **Its gate is stricter than the page, and that is on purpose.** `/contacts` is open, but a command has to name a capability, so it uses MANAGE_ESTIMATING, the gate the rest of the contacts surface uses for relationship work. It replaces the `company.*` wildcard exclusion with a reason for each action.

**Two candidates were dropped:**

- **"Who's clocked in right now."** #309's running clock lives only in the phone's AsyncStorage (`apps/mobile/lib/clock-session.ts`). The server writes a TimeEntry only once the interval closes, so there is no row to read. Answering this needs a schema change, so it is now a KNOWN_GAPS entry and census gap `q-clocked-in` (CENSUS_GAPS 3 → 4, raised on purpose).
- **Adding a lien deadline by chat.** `createLienDeadline` is on the exclusion list as "Never a command": a model carrying the date onto a card is the app supplying a legal deadline by another route. It is now census refusal `q-lien-add` (CENSUS_REFUSALS 1 → 2) and is a decision for Diego and Cyrus.

**The census is now 110 questions, up from 100.** Eight new routed questions, plus the gap and the refusal above.

**How this was checked:**

- 39 tests in six new files, plus 4 more in `commands.test.ts`. Each fake honours the where clause, and the other company has records with the same names.
- 23 mutations were requested and 23 verdicts came back, all red: dropped `companyId` (×8), a dropped principal or actor passthrough (×2), dropped capability checks (×4), commands calling the action on propose (×4), loosened command gates (×4), and a needs_attention gate. The first run had one survivor, the people query without `companyId`; a fixture was added so it now fails.
- Model eval: 8 new census cases, 8 of 8 passed, using 8 model calls.
