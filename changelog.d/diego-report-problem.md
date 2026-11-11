### "Report a problem" in the takeoff workspace and on the estimate (Diego)
`diego/report-problem`

One press takes a picture of the plan view (the drawing with its takeoff overlay, as a JPEG), then a
short box asks what went wrong. Send mails support the page, the job, the sheet, the picture, the
page's last console errors and clicks, and who sent it; the person sees "Sent. We'll look at it."
#prova-build gets one line when `SUPPORT_SLACK_WEBHOOK_URL` is set.

**The help request's channel, not a new one** (`sendHelpRequestEmail`, now able to carry an
attachment): the message row is written before the provider is called, so every report is on
/messages as sent or with the reason it was not, and it can only reach the configured support address.

**Never another company's data.** The job comes from the page path and is looked up among the
reporter's own jobs; the sheet's label only on that job's plans. A posted id belonging to another
company finds nothing. The browser's lines are redacted before mailing (query strings, JWTs, bearer
tokens, keys) and capped; the picture must be a real JPEG under 600 KB.

Checks: `lib/problem-report.test.ts` (redaction, caps, the JPEG check, the whole mail body);
`lib/actions/problemReport.dbtest.ts` (another company's job in the path yields no job, sheet or
name, red with the company scope removed; the Slack line; refused with no support address).
