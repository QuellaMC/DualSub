# DualSub Engineering Conventions

## 0. Simplicity and the Greenfield Principle

**Simplicity is the ultimate sophistication.** Simple can be harder than
complex: you have to work hard to get your thinking clean to make it simple.
Complexity that remains is thinking that stopped early.

**Every line of code and documentation should read as if it had been written
correctly the first time.** The two principles share top rank. They govern
every other section here and apply to source, tests, docs, and this file.

1. **No patching.** Trace a break to its cause and fix it there. Do not stack
   special cases, copy logic and tweak it, or add a flag to route around the
   problem. Tearing something down and rewriting it is in scope.
2. **Code explains itself.** Names carry the _what_. A comment carries a _why_
   or a rule that cannot be inferred from the code, and it is clear, simple,
   and rare. Explanatory comments that narrate the code misguide more than
   they help: delete them, or rewrite the code that needed them. No
   commented-out code.
3. **No residue.** No backup copies, orphaned files, or dead code. When a
   mechanism goes, its tests, fixtures, and docs go with it.
4. **Deployment parity.** Deployed and local source stay byte-identical.

Before changing code, ask _"if I were writing this for the first time, how
would I write it?"_ — not _"how do I graft this onto what is here?"_ Two
corollaries: a business rule is defined in exactly one place, and all state
changes pass through the same entry point, so a competing second source never
appears.

Document only what is high-value, stable, and not discoverable by reading the
code. When tempted by "good enough for now", prefer the rewrite over leaving a
landmine.

## 1. One Seam Per Job

One job, one implementation. Two code paths doing the same job will drift,
and then a bug fixed in one stays alive in the other.

When you touch an area, look for seams that have split apart: two validators
for one shape, two ways to write a file, two places that decide the same
thing. Unifying them is in scope and does not need separate authorization.
Say what you merged in the PR description. Refactoring that would sprawl past
the current task belongs in its own PR, right after this one — not abandoned,
and not smuggled into a feature commit.

**A small patch is usually a report about the architecture.** When you find
yourself adding a special case, a flag, or a guard so that one caller behaves,
stop and look at the seam. The question is not "how do I handle this case" but
"why can this case exist at all." A shape that makes the bad state
unrepresentable retires the edge case and every future one like it; a guard
retires today's bug report.

Some patches are genuinely just patches — a wrong constant, a typo in a
message, an off-by-one. Fix those directly. The rule is about repeated
special-casing, which is the signal worth acting on.

Grow structure from working behavior: start with the smallest path that
actually runs, add when real usage or tests create pressure, and skip
speculative frameworks, empty modules, placeholder APIs, and schema fields
added for a someday caller.

## 2. Commits and Pull Requests

Commit messages and PR descriptions contain no co-author trailers and no
mention of AI agents or tools. Write plain conventional messages that describe
the change.

## 3. Project map

DualSub 3 lives under `src/` + `wxt.config.ts` (TypeScript strict, WXT,
React 19, Vitest, zod). The v2 JavaScript tree was removed at the 3.0
cutover: its last state is branch `v2-maintenance` (2.5.0), and the
abandoned de-bloat refactor survives on `backup/pr62-debloat-wip` (known
buggy — do not base work on it).

Reference material for behavior decisions:

- `docs/reference/pr62-audit-report.html` — 35 audited defect classes the
  codebase must not reintroduce.
- `docs/reference/smoke-protocol.md` — the manual pre-release checklist.
- `docs/reference/store-review-notes.md` — permissions and data flows as
  declared to the store; the golden manifest in `src/build/` enforces them.

Semantics ported verbatim from the audited v2 and kept that way unless a
test proves a change: sender classification, subtitle request policy + CDN
allowlist + fetch hardening, selection-sync cursor acceptance + two-phase
removal, config strict-read bundles + sensitive-key gating, fail-closed AI
enablement re-checks, the idempotent every-boot storage migration design.
