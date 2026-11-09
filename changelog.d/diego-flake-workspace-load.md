### Workspace spec on a loaded gate machine: step 8's limit and step 2b's canvas wait

#1085 gave step 2b a 120 s limit. Two follow-ups surfaced on the same machine at a 15-minute
load average of 12.7 on 10 cores, with other sessions building:
- **Step 8** loads the estimate and then the workspace, both cold, and hit the default 30 s
  test limit. It now gets 120 s as well.
- **Step 2b's canvas poll** waits for the PDF to render in the browser. That work is CPU-bound,
  and it took more than 60 s. The poll now waits up to 100 s, inside the 120 s limit.

Test-only.
