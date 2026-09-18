### The daily report: automatic weather, crew from time entries, structured delays, and it locks when the day is signed (Diego)
`diego/daily-report-structure`

Gap 2 of the audit: the daily report was four nullable strings.

- **Weather is filled in, never typed.** A job now has a **site address**
  (job page → details). Saving it looks up the coordinates: a street address
  through the US Census geocoder, a "City, ST" through Open-Meteo's place
  search. Each report then gets that day's high and low, precipitation, wind
  and conditions from Open-Meteo. While the day is still going it's a
  forecast, and once the day is over at the site it's replaced by what
  actually happened (Fieldwire's pattern). No API keys. If the service is
  slow or down, filing still works. A job with no site address, or one that
  wasn't found, says so where it can be fixed. The old weather box is now
  "Site conditions" for anything the numbers don't say.
- **The crew isn't retyped.** Each report shows headcount and hours by craft
  from that day's time entries (distinct people, not entries). The old crew
  text box is now "Other trades / visitors on site".
- **Delays are structured** (`DelayEvent`). Each one records:
  - cause (weather, GC schedule, another trade, material, inspection,
    design/RFI, site access, equipment, other);
  - who caused it, by category and by name;
  - start and end time;
  - workers affected, and crew-hours lost (worked out from workers × time
    when left blank);
  - what happened;
  - whether the GC was told: how, who and when.
  They're logged on the phone or the web. On the web, **Draft change
  order** turns a delay into a DRAFT change order prefilled from its
  record. The old free-text delays box is gone from the forms, and older
  reports keep and show what was typed there.
- **Signing the day locks the report and its delays too.** It's the same
  "Sign the day" signature as the hours, with one act for the foreman. New
  triggers, `prova_daily_report_day_lock` and `prova_delay_event_day_lock`,
  refuse any change to a signed day's report or delays. Two things still
  go through on a signed day:
  - the weather arriving, which is an outside fact rather than an edit;
  - a delay being linked to a drafted change order, which is what the
    office does afterwards.
  The sign-off also freezes the crew by craft and the report with its
  delays as they were signed. The phone's sign sheet says whether the
  day's report is filed and how many delays it has.
- **Phone reports screen:** one card per day (report plus delays), with
  **New report** and **Log a delay**, both using the date picker.

Migration `20260919010000_daily_report_structure`, additive:
- five nullable site columns on Job;
- `DailyFieldReport.weatherAuto`;
- `TimesheetSignoff.manpower` and `reportSnapshot`;
- the `DelayEvent` table with three enums;
- two triggers.
No existing row changes, and a report is only locked once its day is signed.
The cleanup scripts delete sign-offs before delays and reports. The data
export gains a `delays` dataset and the report's automatic weather.
