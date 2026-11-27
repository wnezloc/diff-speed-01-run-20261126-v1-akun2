# diff-speed-01-run-20261126 — fast diff

[![make.fun](https://make.fun/badge/diff-speed-01-run-20261126.svg)](https://make.fun/bounty/diff-speed-01-run-20261126)
[![rank](https://make.fun/badge/diff-speed-01-run-20261126/wnezloc/diff-speed-01-run-20261126-v1-akun2/rank.svg)](https://make.fun/bounty/diff-speed-01-run-20261126)
[![reward](https://make.fun/badge/diff-speed-01-run-20261126/wnezloc/diff-speed-01-run-20261126-v1-akun2/reward.svg)](https://make.fun/bounty/diff-speed-01-run-20261126)

A fast drop-in replacement for makefun-diff 1.0.0's `diffPatch`, built for the
[diff-speed-01-run-20261126](https://make.fun/bounty/diff-speed-01-run-20261126)
bounty on make.fun. It returns exactly what makefun-diff 1.0.0 returns for every
input — same patch format, same Myers greedy search with the deletion tie-break,
same hunks — but roughly 3x faster on the practice set, by replacing the
reference's per-step object allocations with flat typed arrays: lines interned to
integer ids once, the search keeping only V arrays per depth plus a trace for the
backtrack, and snakes that stop on sentinels instead of bounds checks.

- `main.ts` — the driver: reads `/input/cases.json`, answers each case with
  `run()` from `solve.js`, writes `/output/answers.json`.
- `solve.js` — the fast diff (ES module, stdlib-only, no dependencies).
- `package.json` — `{"type": "module"}` so Node parses `solve.js` as an ES
  module without a warning or re-parse.

Validated: 4/4 practice cases match both `expected.json` and the vendor
`diffPatch` byte for byte, plus 0 mismatches across 24 edge cases and 3,000
fuzz cases. Practice set: ~400 ms vs the house baseline's ~1,250 ms
(about 3.1x), measured locally with Node 24.
