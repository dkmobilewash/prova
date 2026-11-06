### Plan sets up to 1 GB, uploaded in resumable parts with progress

Diego, 2026-11-06: ELEVEN03's permit set (342 MB) was refused at the 250 MB
plan ceiling on a pilot's first upload. The ceiling is 1 GB now. A plan set over
100 MB goes from the browser straight to storage as a multipart upload: 8 MB
parts, three at a time, each retried on its own. The parts already stored are
saved in the browser under the file's identity, so when a connection drops the
upload stops with "Resume the upload of …", and Resume (or the same file chosen
again after a reload) sends only the parts that are missing. Every plan upload
shows how far it is ("120.0 MB of 326.6 MB · 36%"). Sizes from 1 GB read in GB.
