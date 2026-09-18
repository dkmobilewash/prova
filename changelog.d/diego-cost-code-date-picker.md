### A cost code is required on a job that has them, and the date is picked, not typed (Diego)
`diego/cost-code-date-picker`

The last two open items from the Gap 1 audit.

- **Cost code required.** On the phone's Log time, Clock in and Switch
  sheets, a job with cost codes no longer offers "No specific line". Save,
  Start and Switch stay grey until one is picked, and a job with exactly one
  line picks it automatically. The web's new-entry form requires one the
  same way. A job with no cost codes can still take hours, and the sheet
  says why there's nothing to pick.
  - Corrections on the web keep "No specific line", so an older entry
    logged before this rule can still have its hours fixed.
  - The server does not refuse an entry without a cost code, the same as
    with crafts. A clock session started before this change would otherwise
    be refused at clock-out, and those hours would be lost.
- **Date picker.** Log time, Sign the day and T&M tickets now show
  **Today**, **Yesterday** and **Other day…**, which opens a month calendar
  with today's date as the limit. No more typing YYYY-MM-DD. It's plain
  React Native, so the installed phone build runs it without a rebuild.

No server change and no migration.
