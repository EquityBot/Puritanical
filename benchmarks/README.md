# Benchmark

Puritanical has not been benchmarked yet. The harness is inherited from [Ponytail](https://github.com/DietrichGebert/ponytail); its published results measure the upstream rulesets, so they are in [upstream `benchmarks/results/`](https://github.com/DietrichGebert/ponytail/tree/main/benchmarks/results) and are not repeated here.

The single-shot benchmark below has 3 arms (no skill, [caveman](https://github.com/JuliusBrussee/caveman), puritanical), 3 models and 5 everyday tasks. Code LOC is counted from fenced code blocks; tokens, cost and latency come from the API. The headline harness is the [agentic benchmark](agentic/).

## Reproduce

### Claude (Haiku / Sonnet / Opus)

Requires an Anthropic API key and **Node.js ≥ 22.22.0** (promptfoo's engine constraint,
check with `node --version` and upgrade if needed):

```bash
cp .env.example ../.env      # add your ANTHROPIC_API_KEY
npx promptfoo@latest eval -c promptfooconfig.yaml --env-file ../.env --repeat 10
npx promptfoo@latest view
```

`--env-file ../.env` is required because promptfoo reads `.env` from the current
directory (`benchmarks/`), not the repo root where the file lives.

Tasks: email validator, JS debounce, CSV sum, React countdown, FastAPI rate-limit (see `promptfooconfig.yaml`). Single-shot completions, default temperature.

## Metrics

| File | Metric | Behavior |
|------|--------|----------|
| `loc.js` | `loc` | Measurement - always passes, records line count |
| `correctness.js` | `correct` | Gate - fails if generated code doesn't work |

`correctness.js` extracts fenced code blocks and runs per-task checks (spawns Python/Node for email, debounce, CSV; structural regex for React and FastAPI). A broken one-liner that scores great on LOC will fail on correctness.

> **Note:** The React countdown and FastAPI rate-limit checks are keyword/structural only (no runtime execution), so they verify plausible structure rather than full correctness. The email, debounce, and CSV checks execute the code.

### Prerequisites

Running the benchmark requires **Python 3**, **pandas**, and **Node.js ≥ 22.22.0** (promptfoo's engine constraint; see [Reproduce](#reproduce)).

## Notes

- Caveman is a prose-compression skill (it leaves code "normal"), so it lands between baseline and puritanical on code size and wins mainly on prose tokens.
- Cost reflects single-shot calls (one prompt, one completion), not real multi-turn agent sessions. In a session the ruleset re-injects and the ladder deliberates every turn across many turns, so per-session cost can come out higher or lower than these numbers. Prompt caching offsets some of the re-injection, but a measured agentic A/B ([#121](https://github.com/DietrichGebert/ponytail/issues/121)) found puritanical can also raise tool calls and cost on completion-forced tasks. Treat these as generation numbers, not a session-cost promise.
- These are everyday tasks; production-grade specs can behave differently.
