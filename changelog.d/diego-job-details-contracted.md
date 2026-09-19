### "Save details" works on a contracted job again (Diego)
`diego/job-details-contracted`

On a contracted job the Client dropdown is disabled, since the client is
who signed. Browsers don't send a disabled field, so the save reached the
server with no client and every attempt was refused with "A job needs a
client." A contracted job's name, scope and (since #344) site address
couldn't be changed at all. A hidden field now carries the client, and the
action still refuses a real change of client once a job is contracted.
Found while clicking #344 on production.
