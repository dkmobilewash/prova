### G703 downloads survive a job name with an em dash (Diego)
`diego/download-buttons`

Pressing **G703 as CSV** or **G703 as Excel** on a job named with an em dash, a
curly apostrophe or an accent failed with a server error: the job name went into
the download's `Content-Disposition` header, a header must be Latin-1, and the
route threw "Cannot convert argument to a ByteString". `lib/content-disposition.ts`
now gives the header an ASCII name plus the real one in `filename*`. The sent-copy
download uses it too. Found by pressing the buttons in the shoot rehearsal, whose
job name has an em dash.

The two G703 downloads and "Download what was sent" are now buttons that fetch the
file and save it, and show the status on the page when it fails. Chrome round 4 saw
the plain links return 503 on a dev server while a fetch of the same URL returned
200. That 503 is NOT reproduced: in a signed-in Chromium on a production build the
plain links download too.
