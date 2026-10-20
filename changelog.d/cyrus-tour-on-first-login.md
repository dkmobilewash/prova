### A new account is offered the tour on its first login, not after it hides the checklist (Cyrus)
`cyrus/tour-on-first-login`

The one-time "New here? Take a three-minute tour" offer only appeared on a brand-new company's Home AFTER the Getting started card was hidden. On day one almost nobody hides the checklist, so the tour existed and nobody was shown it, and that day is exactly when someone wants showing around. It came up because the first contractor who asked to join after a demo would have logged in and never seen it.

The offer now shows beside the checklist on a new account. It is still one line, still dismissable, and still never started for them. The jobs empty state and the shortcut chips stay gated on the checklist, because those really are the same door as its "Add your first job" step; the tour is not.

The tour's first stop is already the Getting started card itself (`full-tour.ts`), so nothing about the tour changes. Checked by `e2e/specs/dashboard-empty.spec.ts`, which now requires the "Tour of C Stream" region on the EMPTY persona's checklist-only Home and fails without this change.
