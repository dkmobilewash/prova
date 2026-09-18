### The safety forms could not tell you why they refused (Cyrus)
`cyrus/safety-action-results`

Record an injury with the employee's name blank and the Save button did
nothing you could act on. `createSafetyIncident` threw
`"Employee name is required"`, and production REDACTS the message of
anything thrown out of a Server Action — so the `catch` in
`SafetyIncidentForm` rendered React's "the specific message is omitted in
production builds" paragraph instead of the sentence naming the field. On
the form whose output is the OSHA 300 log.

Four of the five exported actions in `lib/actions/safety.ts` were like
that — `createSafetyIncident`, `updateSafetyIncident`, `createToolboxTalk`
and `deleteToolboxTalk`. All four are converted; the fifth,
`deleteSafetyIncident`, already returned `ActionResult` and argued the case
for it in its own docstring (#148) while its four siblings ignored it. Four
found, four converted.

**Why nothing caught it.** `safety.test.ts` asserted on ROWS — the right
assertion for the duplicate-case guard it was written for, and blind to
this one, because `throw` and `return fail(...)` leave identical rows.
`action-capability-guards.test.ts` deliberately accepts either shape: it
asks whether the endpoint is open, which is a different question.
`ownerRefusalCensus.test.ts` only fires on an action that PROMISES
`ActionResult` and then throws; an action promising nothing was invisible
to it. Three censuses and not one of them was asking whether the reason
arrives.

**What changed.** The parsers throw `InputError`, which `runAction`
converts at each action's boundary — both from `lib/actions/shared.ts`,
never a local copy. Each action asserts `can(context, "MANAGE_FIELD")` and
RETURNS `FIELD_ONLY` rather than throwing it through
`requireCapabilityForAction`; `deleteToolboxTalk`'s owner check is
`ownerRefusal`, not `assertOwner`. All four call sites read `result.ok`,
and `SafetyIncidentRow` no longer re-throws a returned failure just to get
it back into a `catch`.

**The guard that would have caught this**, and it is the part worth
keeping: the suite now derives every exported action from the source of
`safety.ts` and requires each to declare `Promise<ActionResult>`, plus the
same scan over the four components that call them. Both assert the SIZE of
the set they derived — against an independent count and against a literal
— so a pattern that matches nothing fails loudly instead of blessing
everything, which is the `scratch-cleanup-order` failure the repo already
paid for. Comments are stripped before matching: #185 is the version where
a comment DISARMED a census, and this is the same hazard from the other
side — the new comments explain the defect by naming `err.message`, and an
unstripped scan failed on the very files it was written to bless.

**Mutations, each broken deliberately and watched go red:**

| broken | result |
| --- | --- |
| `createSafetyIncident`'s name check back to `throw new Error` | RED — 2 tests, incl. the no-bare-`throw` scan |
| `deleteToolboxTalk` back to `assertOwner` | RED — 2, incl. the existing `ownerRefusalCensus` |
| capability guard removed from `createToolboxTalk` | RED — 3, incl. both capability-census checks |
| the source scan's own regex made to match nothing | RED — the size check; the ActionResult check passed vacuously, which is exactly why the size check is there |
| `Promise<ActionResult>` annotation dropped from `createToolboxTalk` | RED — named the action |
| `createSafetyIncident` made to refuse non-owners too | RED — 2, incl. the FIELD-member control |
| `ToolboxTalkForm` back to try/catch over `err.message` | RED — the component scan |
| the component scan made to match no files | RED — its size check |

**Not done, deliberately:** the `/safety` nav entry is still
`disabled: true` in `navItems.tsx`, with its own comment explaining why.
Whether to turn it on is the founder's call, not this change's. The page
and its actions work; it is reachable by URL.
