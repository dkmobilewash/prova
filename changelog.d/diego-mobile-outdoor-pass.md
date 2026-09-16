### The field app stops looking like a shrunken desktop app (Diego)
`diego/mobile-outdoor-pass`

The phone app shipped with the web's dark slate palette and three ad-hoc
components, styled inline screen by screen — readable in a clean indoor demo
and wrong for the real user: a gloved, one-handed foreman on a ladder in
direct sun who wants out in fifteen seconds. Dark grounds mirror in
sunlight, 14pt type is unreadable at arm's length, and 44pt taps were
treated as a suggestion.

The pass gives the app a light, high-contrast palette (near-white canvas,
near-black ink, body text ≥10:1, brand yellow kept as a FILL with a dark
label), a 17pt semibold type scale and a 44pt hit floor, a real component
set (`List`, `Row`, `EmptyState`, `Field`, `Sheet`, `Chip`) that replaces
the inline styles, and a job hub so all six field features sit one thumb's
reach from the tap that opens a job. Checked by typecheck/lint and a
simulator click-through of the jobs list and hub.
