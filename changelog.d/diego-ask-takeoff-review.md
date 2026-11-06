### Ask reads the guided takeoff and sets a wall type's height

Three things an estimator says over the review queue now reach Ask:

- **"How many linear feet of S6A on Baker?"** goes to `takeoff_quantities`. It returns the proposal's own scope rows (`wallScope`), so its figure matches the GC's page and the bid. A type that isn't on the takeoff gets the reply "no walls typed S6A", along with the types that are; it never comes back as a zero. This is not `wall_schedule`, which reads the older hand-entered wall runs.
- **"What's left to review on Baker?"** goes to `takeoff_review`, the queue the stepper's Next counts, summed by kind and sheet. It reads out the queue's own suggestions and where each came from.
- **"Set S6B walls to 15 feet"** is `set_wall_height`, a DIRECT card over `setWallGroupHeight`, the action the queue's T key calls. The card lists every item of that type, one per level, with its height before and after. The tap sets each one, and the estimate lines follow. Heights can be spoken as "15 feet", "15 ft", "15' 6\"" or "15 feet and 6 inches". A job past estimating is refused.

`takeoffItems.*` was a single wildcard exclusion. Now that a command registers `setWallGroupHeight`, each of its other actions is excluded by name, keeping the old reason.

"Accept all suggestions on A101" waits for the middle session's accept-all action to reach main.

Proof: 11 routing-eval cases (three phrasings each, plus two refusals) and 3 hundred-question entries, all passing against the real model. Unit tests cover the card, and a db test covers both reads plus the card's tap writing through to the next read; the two type-filter mutations each go red. A local spec covers the card end to end and the two reads with the real model.
