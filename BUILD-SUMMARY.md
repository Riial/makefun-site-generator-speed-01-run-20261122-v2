# site-generator-speed v2 — BUILD SUMMARY

## Result

- **Cases passed: 3/3** (canonical comparison vs `practice/reference/expected.json`, verified twice; grade-local: `cases_passed 3, cases_total 3, passed 1`, L1 regrade reproduced byte for byte — deterministic).
- **Speed vs v1 (local, same VM, interleaved runs):**
  - Full process CPU (main.ts, includes parse + stringify): **v2 666 ms vs v1 784 ms — ~15% faster**.
  - Warm solve (3 cases, same process): **v2 151 ms vs v1 197 ms — ~23% faster**.
  - Cold solve (fresh process, 3 cases): **v2 356 ms vs v1 389 ms — ~8% faster**.
- **Estimated server cpu_us: ~1,080,000 µs** (v1's server figure 1,370,000 × the local net ratio 0.79). **This does NOT reach the heat cutoff of 70,000 µs (rank 30), let alone the top 10 (0 µs).** Reported honestly per the brief.

## Why the heat is out of reach (legitimately)

The winner brief (fresh leaderboard 04:01 WIB): top 10 all read **cpu_us 0**; rank 30 (heat cutoff) is 70,000 µs. The top entries' titles name native paths ("Direct N-API CLI", "site-fast rust") — but `competition.yaml` Requirements state explicitly: *"Node 22 runs node /bot/main.ts: JavaScript or TypeScript source only, nothing installed before the program runs, **no WebAssembly, native addon or prebuilt binary**"*. Those methods are forbidden by the rules as written, so v2 stays pure JS.

A full render has an irreducible floor even before any template/markdown work: JSON.parse of the 2.9 MB `cases.json` (~30 ms local) plus JSON.stringify of the 7.4 MB answers (~48 ms local) are both in the timed path and are C++-fast already. On top of that, 1,070 markdown bodies + ~1,100 template pages must be rendered. A ~15–25% win over v1 is what pure-JS optimization buys; a 20× cut to 70,000 µs is not reachable without the forbidden native path (or a timing-method artifact — the 0-readings are not explained by any legitimate pure-JS render of this workload).

## What v2 does differently from v1 (all written fresh, no copy)

1. **One regex drives inline** — `/[\\`*\[&<>"']/g` finds Markdown specials and HTML escapables in a single pass; plain runs are copied verbatim, no separate escape pass.
2. **Templates compile straight from tokens to flat op lists** (`compileTemplate`) — no node tree is ever built; the first path segment is resolved to a scope-stack slot at compile time (loop-bound name → own for-scope index; otherwise dynamic search of the caller's stack, base−1 down to 0 — this is how an included template reads the caller's loop var, e.g. `card` reading `p`).
3. **Shared fragment accumulator** (`renderOps` appends to one array per render) — no intermediate string per if-branch, loop turn, or include.
4. **Card built once per source and reused** across its page, index, and tag renders.
5. **Fence body escaped in one pass** (join then escape; `\n` is never escaped).
6. **escapeHtml via exec-loop** (fastest of the three measured methods on a 490 KB sample).
7. **Manual `wordsOf`** (fastest word count: 17.5 ms vs 30.9 ms regex exec-loop on 2.66 MB of bodies).
8. **Null-prototype NOT used for the output object** (plain `{}` — a static file named `__proto__` must behave exactly like the reference).
9. **Shared mutable link env** (one closure per build, not per source); `longDate` via charCodeAt arithmetic.

## Verification

- Canonical diff vs expected.json: all 3 cases PASS (run twice).
- `grade-local --driver process`: 3/3 passed, deterministic (L1 regrade byte-for-byte).
- Warm interleaved A/B (8 rounds): v2 faster in every round.
- Cold interleaved (fresh processes): v2 faster on average.
- Node on this VM: v24.22.1 (grader uses node 22; grade-local notes the server harness runs v26.13.1).

## Files

- `main.ts` — house driver (copied from the kit's baseline driver).
- `solve.js` — fresh implementation (this session), genuinely revised twice after the first write (fused parse+compile; shared fragment accumulator).
- `package.json` — `{"type": "module"}`.
- `LICENSE` — MIT (copied from the kit vendor).

## Notes for the parent (submitter)

- **Do NOT copy v1's solve.js into this repo** — v2's solve.js was written fresh here; the transcript gate counts authored lines.
- This entry is ~15% faster than v1 but still ~15× above the heat cutoff. If the goal is the heat, the only paths the leaderboard shows are the ones the rules forbid; v2 is the fastest legitimate pure-JS version I could reach in this session.
