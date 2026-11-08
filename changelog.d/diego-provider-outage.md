### When the model's provider refuses plan reads: not charged, one banner, retried automatically

2026-11-07: the eval account ran out of Anthropic credit. Every title-block read
failed with `400 "Your credit balance is too low"`, each sheet said "couldn't be
identified just now, and the attempt still used one of your monthly sheets. Retry
it", and the new-customer walk pressed Keep reading 107 times in 338 s — charging
a sheet each time, for a fault that was ours.

A provider outage — out of credit, rate-limited (429), failing or overloaded
(5xx, 529), or unreachable (`isProviderOutage`) — is now handled apart from an
ordinary failed read, in the title-block, wall-legend and schedule stages and the
legend re-read:

- the monthly sheet it claimed is given back (`releasePlanSheet`; the request was
  refused before any model ran, so nothing was billed and no customer could cause it);
- the attempt does not count and the page never runs out of attempts: it retries
  after 15 s, 30 s, 1 min, 2 min, then every 5 min;
- the panel shows one banner — "Plan reading is temporarily unavailable; we'll
  retry automatically, and you won't be charged." — hides Keep reading, and keeps
  looking by itself until the provider answers.

An ordinary failure (a malformed reply, a refused prompt) is charged and retried
by hand exactly as before.
