### What actually changed, in plain English (Diego)
`diego/logo-unoptimized`

**The top bar's logo skips the image optimiser.** On five CI runs a signed-in page
rendered but its load event never fired, and every signed-in test then timed out.
On the run with traces read for this, the logo's optimised request was the first
one left unfinished in 69 traces. This serves the file as it is. The cause of the
stall is not established.
