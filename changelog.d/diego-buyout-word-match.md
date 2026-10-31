### Buyout rows say whether the spec's words appear in the quotes (Diego)
`diego/buyout-word-match`

The next step after showing spec findings on a Buyout row. Each finding now gets
a hint from a plain word search, with no model read: "possible match" or "no
match found", over the item, each vendor's name and each quote's description
and notes.

It is a hint and never a verdict, because a quote rarely prints a brand or
rating even when it carries them. So no-match names what it looked for and
where, and a possible match shows the text it hit, since that can be "excludes
Firecode". Ratings are read exactly, so STC 45 does not hit STC 50. A finding with
nothing searchable gets no result, rather than a "no match found" nothing earned.
