### Big plan sets upload in resumable parts with progress, and a set too big says so

A plan set over 100 MB now goes from the browser straight to storage as a
multipart upload: 8 MB parts, three at a time, each retried on its own (on top of
the Blob SDK's own retries). The parts already stored are saved in the browser
under the file's identity, so when an upload stops it offers "Resume the upload
of …", and Resume (or the same file chosen again after a reload) sends only the
missing parts. Every plan upload shows how far it is ("120.0 MB of 210.0 MB · 57%").

The plan-set cap stays 250 MB (Diego, 2026-11-06). It was 1 GB on this branch for
a day, until the full ELEVEN03 walk (342 MB) peaked the local server at 5.07 GB
RSS, more than even a 4 GB Pro function. A bigger set is refused in the uploader
before a byte moves, and again by `readPlanBytes` from the size header before it
downloads, with "This set is too large to process on the current plan; split it
or contact support." A refusal offers no Resume button. `NEXT_PUBLIC_PLAN_PROCESS_MAX_MB`
can lower the reading limit; it never passes the upload cap.
