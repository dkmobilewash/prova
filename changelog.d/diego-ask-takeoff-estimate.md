### Ask runs takeoff on a job's drawings and tells you when it is done; it opens the estimate update with the takeoff ticked (Diego)
`diego/ask-takeoff-estimate`

"Run takeoff on Washington Village" gives a card that states what will happen before
anything happens: the job's newest drawing set, how many floor plans with a scale the
wall finder will read, and the plan-sheet allowance. The allowance line comes from
`STAGE_SPENDS.WALLS`, which says the finder is code and spends nothing; the card says
so and shows how many sheets are left this month. Only the tap starts the run, and it
calls the same `startPlanIngest(plan, "WALLS")` as the Find walls button, with the
owner's switch, the scaled-floor-plan rule and the already-running check unchanged.
The run is rows the cron drains. When it finishes, the person who asked gets a
TAKEOFF_RUN_DONE alert on their bell linking to the takeoff tab. The alert is derived
from the run's own `finishedAt` and the card's recorded target, so there is no new
column and no stored flag, and it drops off after 14 days or when dismissed. Their
colleagues do not get it. Retrying a failed sheet stays a page button. That was the
part of `planIngest.*`'s old reason that still holds, so those three actions are now
excluded one by one.

"Update the Washington Village estimate from the takeoff" counts the measurements not
yet on the estimate and opens the takeoff tab on one sheet with those rows ticked.
Adding them, with a wall type and a price, is the list's own button, one sheet at a
time, so the page's rule against adding the same floor twice still decides.

`takeoff.dbtest.ts` runs the whole loop against Postgres: confirm the card, see the
run recorded as its target, no alert while it runs, one alert for the asker once it
finishes, none for a colleague. Changing the target type in the alert query, or
dropping the asker filter, fails it. The local `--ask-click` spec now opens the
takeoff hand-off too, and checks that the same rows start unticked without the card.
