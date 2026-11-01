### A submittal package emails from its send form, by link when it is big (Diego)
`diego/email-submittal-package`

After building a package, the send form offers to email it to the job's contact,
with the same sender, Reply-To, sent record and delivered or bounced line as a
purchase order. The revision is recorded only if the send went, so a package the
GC never received is never marked sent.

Past 20MB it goes as a download link, because plenty of receiving mail servers
refuse more even though the provider takes it. A GC has no login, so the link is
the access: anyone holding it can open that one file until it expires in 30 days.

Sent copies stay in the database for now. `lib/sent-document-store.ts` holds the
one switch for moving to a private Blob store, and rows already written stay
readable after it flips. Migration `20261031160000_sent_document_links`.
