### Buttons and fields big enough for a thumb, and a focus ring you can see (Cyrus)
`cyrus/ui-targets`

Contractors called the app too hard to use, mostly on a phone on site. Row
actions were 30px tall, most fields were 14px text in 30px boxes, and iOS
Safari zooms the page whenever a field under 16px gets focus, then leaves
it zoomed. A focused field showed only a 1px border colour change.

On a touch screen (`pointer: coarse`, so a mouse at any width keeps today's
density):

- Every text field, select and textarea is 16px and at least 44px tall. This
  is one rule in `globals.css`, so it reaches the ~50 files that style their
  own inputs.
- Every button inside `RowActions` (Edit, Delete, and the armed
  Cancel/Confirm pair) is at least 44x44px. So are `SubmitButton` and
  `@prova/ui`'s `Button`.

At every width, anything interactive gets a 2px brand-yellow ring with a 2px
gap on `:focus-visible`. It overrides `focus:outline-none`, and the sidebar,
Ask and search keep their own rings.

The time-entry form and row moved off the old `slate-*`/`blue-*` colours to
theme tokens, with 44px/16px fields at every width, matching daily reports.

Check: measured in headless Chromium on a scratch page that rendered the real
components. At 375px with touch, row actions went from 30 to 44px and fields
from 30px/14px to 44px/16px. At 1280px with a mouse, all of those stayed the
same. The armed delete still measures 0% confirm overlap at both widths,
with Cancel covering 100% of the vacated box on the phone.
