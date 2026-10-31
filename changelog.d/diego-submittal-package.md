### A submittal can be assembled into one PDF, and the register says what went in (Diego)
`diego/submittal-package`

The register always knew that a submittal went out and never what was in it,
and the package itself was an hour in Acrobat. The send form now has **Build
and download package**: pick the PDFs in order, and the browser makes a cover
sheet from the register row (submittal and revision number, title, from, to,
project, spec section, drawing reference, date sent, a contents table with
each file's start page, a blank box for the reviewer's stamp), joins them and
downloads one file. Per submittal, Diego's option A.

**Nothing is stored or uploaded.** It reuses the bid package's merge, so its
size ceiling, its skip reasons and its refusal to produce a blank file come
along. Only the list survives: `SubmittalRevision.packageContents` (additive,
nullable, file names and page counts), shown on the revision line as "Sent: 2
files, 6 pages: …". The cover carries no certification wording, and the GC's
own form is a later per-contact template.

Choosing different files clears the last build's list, and the list is added
at submit rather than held in a hidden input, because `useFormDraft` restores
form fields and a restored list would describe a package nobody built.

The check: `submittal-package.test.ts` reads the cover and each file's pages
back out of the PDF bytes, in order, including a thirty-file contents table
that runs to a second cover page and shifts every start page. Mutation-tested
on the page offset and on the server's refusal of a malformed list.
