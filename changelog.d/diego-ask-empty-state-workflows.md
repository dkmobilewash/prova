### The empty Ask panel says what you can say, by workflow

Before anybody types, Ask now lists six workflows (change orders, purchase orders,
pay apps & retainage, lien waivers, takeoff, estimate), each with two sentences that
reach a real command. The mic gets a line of its own wherever the mic button exists.

**A tap fills the box and does not send it**, unlike the flat chips under it. Measured
against the real model before deciding: sent bare from the dashboard, all twelve came
back as a prose "which job?" with no card. Nothing broke, but the first tap looked like a
dead end. So the person adds the job, by voice or typing, or just presses Send on a job's
own page, where the page context supplies the job. The PO chips name a vendor and the
waiver chips a pay app number, because without them the model asks for those in prose too.

Each example is typed as `CommandName`, so one naming a command that does not exist fails
typecheck (checked by mutation). Each one is also a routing-eval case (`example-*`, with
" on Riverside" added). "Start this month's pay application" read `job_overview` first in
one of three runs, so it became "Bill this month's pay application": 5 of 5 alone, then
all 12 examples passed in each of three runs (36 of 36).
