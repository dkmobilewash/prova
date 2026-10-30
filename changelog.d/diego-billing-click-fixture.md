### One local test job that exercises all the billing work (Diego)
`diego/billing-click-fixture`

Nothing from the billing work had been clicked in a browser, because no
database held a job with all of it at once. `scripts/billing-click-fixture.ts`
builds one in a local database: a $100,000 schedule of values, an approved
$5,000 change order, two pay applications with retainage, one vendor with a
lower-tier waiver and one without, a signed T&M ticket, a sent and an unsent
submittal, and quotes for buyout.

It refuses anything but a local database before Prisma loads, with no
override, and refuses a database missing the migrations the click test reads.
A re-run replaces only its own `ZZ Click` rows. `billingClickFixture.dbtest.ts`
pins the certificate figures the click-list expects and that removal leaves
the company's other work alone.
