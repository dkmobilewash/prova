### The crew, schedule and contract writes on a job refuse the people their section already refuses (Cyrus)
`cyrus/action-capability-guards-crew`

Second pass of #383. #392 closed the money surface — 35 actions behind the
Billing, Retainage and Estimate tabs — and named exactly what it was
leaving: the Overview and Crew & time tabs, because those pages withhold
**two different capabilities section by section**, so which one each action
answers to could not be read off the file the way the rest could. This is
that judgement, made and written down.

Eighteen actions now assert a capability that did not before, and ten more
that already asserted one are executed against a real principal for the
first time.

**The count was re-derived rather than inherited.** #392's own number was a
correction of an earlier audit's, so it was treated as a claim: a second,
independently written copy of the import-graph walk finds **292 Server
Actions reachable from a page, 170 asserting a capability, 122 asserting
none.** That agrees with #392 exactly (157 minus the 35 it closed), so its
figure stands — confirmed, not assumed.

**Where each capability comes from, since this is the pass that could not
just read it off a page.** Nothing is invented and no new capability name
exists:

- **Contract paperwork** — signing links and the subcontract file — takes
  `VIEW_JOB_COSTS`, because both live inside the Overview tab's
  `{showsJobMoney && …}` sections, and because `DocuSignPanel` renders
  *inside those same two sections* and its three actions already asserted
  exactly that. Three controls in a section asserting it and two not was
  the inconsistency.
- **Schedule and crew** takes `MANAGE_JOBS`. That section withholds
  nothing at all, so the page cannot supply an answer — but the
  `reschedule_job` Ask command declares `MANAGE_JOBS` and names
  `updateJobSchedule`, this exact function. The two surfaces now agree
  instead of one being open, which is what #392 did with
  `log_payment`/`logPayment`.
- **Crew hours** takes `MANAGE_FIELD`, from `log_time_entry`, which
  imports and calls `logTimeEntry` directly. Same shape again.
- **Hiring-hall dispatch** takes `MANAGE_FIELD`, and it is the one genuinely
  arguable call, so the argument is in the code rather than left to be
  reconstructed. It reads like union compliance paperwork. It is
  `MANAGE_FIELD` on `ROUTE_CAPABILITY`'s own stated reasoning for
  `/certifications`: `PAYROLL_COMPLIANCE` holds *both* capabilities, so
  nobody who would own it under the compliance reading loses it — while
  FIELD and PROJECT_MANAGER hold only `MANAGE_FIELD` and would lose a
  control they use today. Closing a hole must not take something from
  somebody who already has it.
- **Backcharges** takes `MANAGE_BILLING`, the ordinary one-door rule, and
  all six were taken together so `/backcharges` is not left half-enforced.
  A backcharge is the GC deducting money from what it owes; these were
  already recorded as known debt and what was missing was the enforcement.

**The census needed a third shape, and that is the part worth reviewing.**
#392 taught it to read a soft gate, which is what made these visible. It
did not make them *decidable*: a page withholding two capabilities yields
`null`, and `null` is indistinguishable downstream from "no page reaches
this at all". Neither existing list fitted — `KNOWN_OPEN` is keyed on a
capability the rule *did* derive, and `MIXED_DOORS` reports itself stale
unless the doors actually disagree, which for six of these they do not
(there is one door, with several gates on it). So the decision is recorded
per **section**, naming the heading in the page source the action's form
sits inside, so a reviewer can check the claim against the file instead of
trusting it.

Alongside it, a debt list for the actions behind such pages this pass did
*not* decide, and an assertion that **every** action behind an ambiguous
page is in exactly one of the two. Wire a new form to `/contacts/[id]` or
`/dashboard` and the suite fails by name until somebody decides or writes
down why not. The remainder is counted debt now rather than silence.

**The enumeration immediately found something nobody was looking for.** Ten
actions — the three DocuSign ones, both `jobDetails` writes,
`setJobStatus`, `recordExecutedSubcontract`, both timesheet sign-off
actions and `recordIntakeDocument` — *already* asserted the right
capability and had **never once been executed by this suite**, because
their only door was an ambiguous page and so they never entered the derived
set. A correct guard nothing exercises is one careless edit from being an
incorrect guard nothing exercises. They change no behaviour; they are now
run against every job function that lacks the capability, and against an
owner.

One real defect fell out of running them: `deleteEstimateJob` checked
**owner before capability**, so a PAYROLL_COMPLIANCE member was told "only
the account owner can remove a job" — true, and the wrong sentence. They
would go and ask to be made an owner, which is not the change they need.
Reordered, per the precedent #392 set on the QuickBooks pushes. The set of
people admitted is identical either way, since an owner holds every
capability by construction.

**Verification.** Census shown **red on unmodified action code first — 21
failing cases naming all 18 actions** — before any guard was written. Green
after: 355 cases in that file, up from 293. Each action is called as every
job function lacking its capability and must refuse *before touching the
database* (the suite replaces `prisma` with a proxy that throws on first
property read), as every function holding it, and **as an OWNER, always**.
**12 mutations requested, 12 caught by the intended test**, each restored
and reconfirmed green: guards removed (including one with its owner check
deliberately left in place, to prove the owner check was not covering for
it), a wrong capability, a guard inverted so it locks out the owner, a page
gate softened, a decision-list entry dropped, a debt entry that quietly
acquired a guard, a module dropped from the execution map, the ordering fix
reverted, and a vacuity mutation making the new enumeration match nothing —
which must fail loudly rather than leave every downstream check trivially
true. One mutation initially reported as caught turned out to have failed
at *setup* on an ambiguous anchor; that is a missing verdict, not a pass,
and it was fixed and re-run rather than counted.

**What this deliberately does not close**, stated so the next pass starts
from a set rather than a search: the writes behind `/contacts/[id]` (the
CRM lane, plus the client-portal grant, which deserves its own argument
rather than a line in a batch), the Ask card actions — whose right guard is
the card's own command, not the page it was opened on — and one per-person
preference write on the dashboard. All recorded by name with a reason.
`draftChangeOrderFromDelay` stays ungated exactly as #392 decided;
`sendOutboundEmail` is untouched and is being handled separately.
