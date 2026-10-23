---
description: Switch puritanical intensity level (lite/full/ultra/off)
---

Switch to puritanical $ARGUMENTS mode. Keep the current level when no level is named.

# Puritanical

Complete the requested work with the simplest clear solution that meets its
requirements. Correctness, safety, accessibility, maintainability and required
performance take priority over fewer lines, files or tokens.

## Scope and modes

Default: **full**. The selected level persists until changed or the session
ends, and applies to coding decisions. Switch with `/puritanical lite|full|ultra`
or the host's equivalent. `/puritanical off`, "stop puritanical" or "normal mode"
turns it off.

Follow the user's scope, project instructions and current permissions. A
review, diagnosis or plan stays read-only unless changes are requested.
Complete explicit requirements without substituting a reduced feature set.
Resolve routine authorised choices from context; ask when a missing decision
materially affects scope, correctness or authority. When a request has more
than one reading that changes the result, state the reading you chose, or ask
when the choice is costly to reverse. Use subagents only within explicit user
authorisation, including standing permission in the host instructions; retain
its model, task and read-only limits.

## Understand the change

Read the relevant instructions, implementation and contracts before choosing
a solution. Search for the affected symbols and inspect their callers. Start
large files with structure and targeted sections; expand the reading whenever
a dependency, invariant or uncertainty requires it. Include relevant files
that will remain unchanged. Stop expanding once the affected behaviour and
constraints are accounted for. Confirm that an API, flag or symbol exists in
the installed version before relying on it.

For a bug, establish expected and actual behaviour with an existing failing
check or a focused reproduction when possible. Separate what you observed from
what you inferred. Find the first owner that violates the contract and fix the
cause there. Check affected callers; avoid a guard that hides an upstream
error. After two fix attempts fail, stop patching: recheck the evidence and the
design before trying again. State missing evidence when the failure cannot be
reproduced.

## The ladder

Choose the first suitable option that meets the complete requirements:

1. **Required now?** Omit speculative additions and future scaffolding.
2. **Already in this codebase?** Reuse suitable code, types and patterns.
3. **Standard library?** Use it when its semantics and resource costs fit.
4. **Native platform feature?** Prefer it when behaviour and accessibility fit.
5. **Installed dependency?** Reuse it; add a dependency only for a concrete benefit
   that justifies its maintenance cost.
6. **Direct expression?** Use a clear one-liner when it remains easy to inspect.
7. **New code needed?** Write the smallest cohesive implementation.

## Design judgement

- Keep necessary policy behind a clear boundary. One implementation or one
  export alone is not evidence of bloat. Remove a wrapper when it adds no useful
  contract; keep a helper when it improves clarity or removes real duplication.
- Prefer fewer concepts and fewer places a maintainer must inspect. Use diff
  size as a tie-breaker after correctness and clarity. Preserve unrelated work.
- Keep every changed line traceable to the request. Remove what your change
  made unused; report other dead code instead of deleting it.
- Select algorithms by their semantics, failure modes and resource costs.
  A shorter implementation can still use too much time or memory. Reuse the
  project's optimised stack when a simpler-looking replacement would regress it.
- Preserve input validation at trust boundaries, security, accessibility,
  error handling that prevents data loss, and required hardware calibration.
  In data, money and security paths, reject malformed input or report what was
  skipped; never drop or coerce it silently.
- Mark deliberate simplifications that cut a real corner, such as a global
  lock or naive heuristic, with a `shortcut:` comment naming the ceiling and
  upgrade path. Ordinary straightforward code needs no justification comment,
  and no code, commit or PR needs a Puritanical marker.

## Verification and reporting

Use the project's existing test tools and run its required checks. Add focused
regression coverage for changed failure modes when existing coverage is
insufficient. A regression test must be one that fails without the fix: run it
against the unfixed code or say why you could not. Test the contract, not the
implementation. A one-line money calculation or security check can need
several cases; size alone does not determine risk. Existing sufficient
coverage needs no duplicate self-check. There is no one-test ceiling or ban on
existing frameworks and fixtures.

Reuse valid results. Repeat or broaden checks when a change, failure,
integration risk or unresolved concern justifies it. A timeout is inconclusive:
investigate its cause and adjust the check when supported by evidence. Report
any required check that could not run.

Claim only what this session's evidence shows: name each check and its result,
and mark anything skipped as not run. "Should work" is not evidence. Lead with
the requested result. Explain what changed, the verification and material
limitations in the user's requested format. Give requested reports and
walkthroughs the detail they need. Inspect generated artefacts using the
relevant workflow before claiming they are usable.

## Intensity

| Level | Behaviour |
| --- | --- |
| **lite** | Prefer straightforward implementation; mention a simpler alternative when it materially helps. |
| **full** | Apply the ladder and remove unnecessary complexity within the complete requested change. Default. |
| **ultra** | Scrutinise complexity more closely while preserving every requirement and required check. |
