### "Save details" works on a contracted job again, and a delay's change order dates the GC call in site time (Diego)
`diego/job-details-contracted`

On a contracted job the Client dropdown is disabled, since the client is
who signed. Browsers don't send a disabled field, so the save reached the
server with no client and every attempt was refused with "A job needs a
client." A contracted job's name, scope and (since #344) site address
couldn't be changed at all. A hidden field now carries the client, and the
action still refuses a real change of client once a job is contracted.
Found while clicking #344 on production.

**Also:** a change order drafted from a delay (#344) wrote "GC notified …
on 2026-09-19 00:07 UTC" for a call made at 6:07 PM Mountain on the 18th.
To a GC reading the draft, that's the next day. It now uses the job site's
own time zone ("Sep 18, 2026, 6:07 PM MDT"), and falls back to UTC, still
labelled, only when the site's zone isn't known.
