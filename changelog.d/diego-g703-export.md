### The G703 downloads as CSV and Excel, and Period to defaults to month end (Diego)
`diego/g703-export`

The first step of Diego's portal decision. A pay application page now downloads
its continuation sheet as CSV or Excel, columns A to I under a job, application
and period header, from the same document as the page and the PDF. It is a generic
layout, and a portal's own layout follows when a real template arrives.

Figures stay plain numbers, because a downward correction is negative and the
shared CSV rule would turn it into text. Words still go through that rule, so a
description reading `=1+1` cannot run in a spreadsheet.

A new pay application's Period to now defaults to the last day of the current
month, editable. Most applications run to a month end.

An estimate line's Remove was already only on the open row. Chrome's report of it
doing nothing on a folded row was a control no person can reach, so this adds a
test that keeps it there and changes no behaviour.
