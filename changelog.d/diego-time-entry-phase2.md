### A craft is required on the phone, each worker sees only their own crafts, and an over-ratio day is flagged while the crew can still change (Diego)
`diego/time-entry-phase2`

Gap 1's certified-payroll half. The phone offered "No craft" as the default
on every hour, which is the Raken failure: WH-347 column 3 cannot place an
untagged hour, so wh347.ts marks the form not fileable. And the craft list
was every craft the company had, for everyone.

- **Required.** "No craft" is gone whenever the company has any crafts; Start
  and Save stay disabled until one is picked. A company with none set up can
  still log, and is told payroll will flag the hours.
- **Filtered by the worker (D-12), kept simple.** New `WorkerCraft` table —
  "this person works under this craft", a login or a crew member, XOR-checked
  like TimeEntry. Ticked per person on /union-compliance ("Who works under
  each craft"). One ticked craft is picked automatically; a person with none
  ticked is shown every craft, so nobody is ever blocked by setup not done.
- **Ratio at entry.** GET /api/v1/jobs/[id]/apprentice-ratio?date= returns
  today's breaches from the crew schedule (people — the only signal before
  anyone clocks out) and from logged hours. The time screen shows them as a
  banner. The deciding half is `reviewDayByLocal` in apprentice-ratio.ts,
  unit-tested, with the unclassified-folding test mutation-checked.

Not enforced when an hour is saved, on purpose: the phone's offline queue
stops at the first refused write, so a server-side refusal would strand
everything queued behind it. Overtime is unchanged — pay type stays entered.

`setWorkerCraft` asserts MANAGE_COMPLIANCE itself and returns the refusal;
action-capability-guards.test.ts now executes it as a principal without it.
