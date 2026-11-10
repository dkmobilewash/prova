### CI: the signed-in e2e suite runs in three parallel shards

`e2e` was CI's longest job, at about 10 minutes, and about 6.4 of them were Playwright itself. It now runs as a
matrix of three shards (`--shard=k/3`), one runner each. Each shard counts and checks its own verdicts, so a
shard that runs nothing still fails. Checked locally: `--list` gives 110 + 109 + 97 = 316 tests across the
three shards, the same as the whole suite. The db suite already ran beside it.
