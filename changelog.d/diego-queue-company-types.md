### A set whose legend names no types still gets its walls typed in the review queue

The fourth session's walk on Baker at 66eeca59: the legend read named no types. So every untyped group in the review queue offered nothing ("choose one in the sheet's group list"), the queue never emptied, no estimate lines were written, and the price stayed $0.00. The workspace behind the queue sat on an unscaled key plan.

- **The company's own types when the legend names none** (`loadReviewQueue` → `codes`):
  - the queue's row offers the library, starter types and any the company made, in library order, numbered 1–9 the same way;
  - Enter and the digits work as for legend codes, and Set type adds nothing new, since the types are already in the library.
- **The workspace opens on the first queue item's sheet.** The queue's jump on mount could come before the viewer listened for it, and then the drawing stayed on the review start page.
- `e2e/specs/queue-company-types.spec.ts`:
  - with no legend read, the queue opens on the group's sheet (page 2, not 1);
  - 1 picks the starter W1, and Enter puts the group's runs on W1.
- `wall-heights.spec.ts`: its rooms company has types of its own now offered, so the untyped group's height is asked with its type.
- `review-queue.spec.ts` and the new spec wait for the starter W1 by its row rather than the "Added" toast, because two specs on one company can add the starters at once.
