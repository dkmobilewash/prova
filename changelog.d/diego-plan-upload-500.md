### What actually changed, in plain English (Diego)
`diego/plan-upload-500`

**A plan set can be up to 500 MiB, and big files upload in parts.** The first real
set over the old 250 MiB limit was a 327 MiB permit set. Files over 100 MiB now use
Blob multipart, so a dropped part retries by itself on a jobsite connection.
