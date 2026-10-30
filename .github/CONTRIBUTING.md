# Contributing

Open an issue before a pull request for a new skill or a ruleset change. Bug fixes in hooks, installers, adapters and docs can go straight to a pull request.

## Edit the source, then regenerate the copies

`skills/*/SKILL.md` is the only source of the rules. `AGENTS.md`, the host rule files (`.cursor/`, `.windsurf/`, `.clinerules/`, `.agents/`, `.qoder/`, `.kiro/`, `.github/copilot-instructions.md`), the command prompts in `commands/` and `.opencode/command/`, `.openclaw/skills/` and the fallback strings in `hooks/puritanical-instructions.js` and `__init__.py` are generated from it. After editing a skill, run:

```bash
cargo run --manifest-path tools/Cargo.toml -- sync
```

CI fails when a copy is stale or when the core skill loses one of the rule invariants listed in `tools/src/rules.rs`.

## Checks before a pull request

```bash
npm test
cargo run --manifest-path tools/Cargo.toml -- sync --check
cargo run --manifest-path tools/Cargo.toml -- check-versions
cd tools && cargo fmt --check && cargo clippy --all-targets -- -D warnings && cargo test
```

`npm test` needs Python with `pandas` for the CSV correctness checks; `python3` is tried before `python`. Without it the pandas case skips locally; CI installs pandas and always runs it. Keep each pull request to one change and link the issue it fixes.

## Ruleset changes need evidence

The ruleset reaches every session, so a change to what the agent is told needs a benchmark with 3 arms on the same task and model: no skill, current `main` and your branch. Show a task the change should improve, at least one existing task it could break and at least 6 runs per arm, naming the model.

[`benchmarks/agentic/run.py`](../benchmarks/agentic/run.py) runs the arms ([setup](../benchmarks/agentic/README.md#reproduce)). The `puritanical` arm loads the plugin from `PURITANICAL_PLUGIN_DIR`:

```bash
cd benchmarks/agentic
python run.py --selftest
PURITANICAL_PLUGIN_DIR=/abs/path/to/puritanical-main python run.py --task <task> --arms baseline,puritanical --models opus --runs 6
PURITANICAL_PLUGIN_DIR=/abs/path/to/your-branch python run.py --task <task> --arms puritanical --models opus --runs 6
```

A new task needs a `good` and a `bad` reference in `tasks.py`, so `--selftest` proves the scorer tells them apart.

## Releases

Bump every version file together; `check-versions` lists them and, on a tag build, checks the tag matches. `puritanical-tools publish-openclaw` pushes `.openclaw/skills/` to ClawHub after `clawhub login`; nothing is published there yet. A `v*` tag and GitHub release do not publish to npm; run the `publish` workflow by hand from the tag once npm trusted publishing is set up.
