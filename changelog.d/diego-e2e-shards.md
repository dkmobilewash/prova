- **CI: the signed-in e2e suite runs in three parallel shards** (`--shard=k/3`, one runner each). It was the
  longest job at ~10 minutes, about 6.4 of them in Playwright itself. Each shard counts and checks its own
  verdicts, so a shard that runs nothing still fails. The db suite already ran beside it. Checked locally:
  `--list` gives 110 + 109 + 97 = 316 tests across the three shards, the same as the whole suite.
