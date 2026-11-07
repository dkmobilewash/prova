### Plan sets up to 350 MB

Diego, 2026-11-07: the plan-set cap goes from 250 MB to 350 MB, for upload and
for reading, now that a 342 MB set (ELEVEN03) peaks at 1.72 GB with the heap
capped as a 2 GB function caps it (#1059; it was 5.07 GB before). A set over
350 MB is still refused before a byte is sent, with "This set is too large to
process on the current plan; split it or contact support." and no Resume.
`NEXT_PUBLIC_PLAN_PROCESS_MAX_MB` can lower the reading limit and still never
passes the upload cap.
