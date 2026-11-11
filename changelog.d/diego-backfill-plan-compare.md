### A one-off workflow turns plan comparison back on for companies the trade preset switched off

Between #1087 (plan comparison on for a new company) and #1109 (picking a trade leaves it on), picking a trade
at signup set `planCompareOn` false. `Backfill plan comparison (one-off)` is dispatch-only and does `list`
first, then `apply`, on demo before production. It asserts the typed endpoint against the secret's host, and
uploads the selected rows as a backup artifact before one transaction updates them. It prints ids, timestamps
and counts only. Nothing records an owner turning the switch off, so `list` shows how long after the preset
each row last changed, for a person to read before `apply`.
