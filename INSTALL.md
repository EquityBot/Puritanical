# Install

Pick your agent below. Not listed? Most agents read [`AGENTS.md`](AGENTS.md): copy it into your project, or ask your agent to install [`skills/puritanical/SKILL.md`](skills/puritanical/SKILL.md) as a skill. Which files map to which agent: [Agent portability](docs/agent-portability.md).

The Claude Code and Codex plugins (and the Cursor hooks) run two tiny Node.js lifecycle hooks, so `node` needs to be on your PATH (note for Nix/nvm users: it must be on the non-interactive shell's PATH). If it isn't, the skills still work, but every hook call shows a harmless `node: command not found` error; installing Node (or putting it on that PATH) makes it go away.

## Claude Code

```
/plugin marketplace add ryanduguid/Puritanical
```
```
/plugin install puritanical@puritanical
```
(You have to send two separate prompts for the install to work) 

Same steps in the Claude Code Desktop app's Code tab: type the two `/plugin` commands above into the prompt box, or click the **+** button next to it, choose **Plugins** → **Add plugin** to browse your configured marketplaces, and manage marketplaces from **Customize** in the sidebar.

CodeBuddy installs the same plugin with the same two `/plugin` commands and switches levels with `/puritanical ultra` and so on; it has no subagent injection.

## Codex

```bash
codex plugin marketplace add ryanduguid/Puritanical
codex plugin add puritanical@puritanical
```

Run `codex` and open `/hooks`, review and trust its two lifecycle hooks, and start a new thread.

This same install also covers the Codex desktop app: restart the app after installing and it picks up the plugin.

## GitHub Copilot CLI

```bash
copilot plugin marketplace add ryanduguid/Puritanical
copilot plugin install puritanical@puritanical
```

In an interactive Copilot CLI session, use the slash equivalents:

```
/plugin marketplace add ryanduguid/Puritanical
/plugin install puritanical@puritanical
```

Copilot CLI namespaces plugin commands by plugin name. For example:

```text
/puritanical:puritanical ultra
/puritanical:puritanical-review
```

## Pi agent harness

```
pi install git:github.com/ryanduguid/Puritanical
```

## Kimi Code

In Kimi Code, run `/plugins install https://github.com/ryanduguid/Puritanical`, then `/reload` or start a new session. The plugin puts [`AGENTS.md`](AGENTS.md) into the system prompt every turn and adds the six skills, which Kimi also offers as `/puritanical`, `/puritanical-review`, `/puritanical-audit`, `/puritanical-debt`, `/puritanical-gain` and `/puritanical-help`. Level switching (`/puritanical lite`) loads the skill for that turn; there is no persistent mode flag in Kimi.

## Oh My Pi (omp)

```bash
omp plugin marketplace add ryanduguid/Puritanical
omp plugin install puritanical@puritanical
```

omp runs puritanical's Pi extension unchanged, so the ruleset is injected every turn as in Pi (verified with omp 18.6.1). Start a new session after installing.

## OpenCode

```bash
opencode plugin add @ryanduguid/puritanical
```

Or add it to a project's `opencode.json`:

```json
{ "plugins": ["@ryanduguid/puritanical"] }
```

Run from a checkout instead (the plugin reuses `hooks/` and `skills/`):

```json
{ "plugins": ["./.opencode/plugins"] }
```

Injects the ruleset every turn at the active level; adds the `/puritanical` commands (see [Commands](README.md#commands)). OpenCode also auto-loads this repo's `AGENTS.md`, so the rules hold even without the plugin. The plugin adds the `lite/full/ultra/off` levels.

The `./` path resolves against your project's `opencode.json`; to share one checkout across projects, point it at the absolute path of the checkout's `.opencode/plugins` directory. A `plugins` entry must name a **directory**, not a file: OpenCode 2 rejects a path to `puritanical.mjs` with `configured plugin path must be a directory`. Opening this repo in OpenCode 2 needs no entry at all: it loads `.opencode/plugins/index.js` on its own.

Kilo Code is built on OpenCode and runs the same plugin through its `plugin` key: add `{ "plugin": ["@ryanduguid/puritanical"] }` to `kilo.jsonc` (or `~/.config/kilo/kilo.jsonc` for every project).

OpenCode 1 has no `plugin add` and uses the older `plugin` key: `{ "plugin": ["@ryanduguid/puritanical"] }`, or from a checkout the file path: `{ "plugin": ["./.opencode/plugins/puritanical.mjs"] }`.

## Gemini CLI

```bash
gemini extensions install https://github.com/ryanduguid/Puritanical
```

Loads the ruleset as always-on context every session and registers the `/puritanical` commands; the `skills/` ship too, activated when a task needs them.
The Gemini adapter intentionally does not ship a root `hooks/hooks.json`: Gemini auto-loads that path, while Puritanical's lifecycle hooks use Claude/Codex event names.

Qwen Code installs the same extension: `qwen extensions install ryanduguid/Puritanical:puritanical`. It loads `AGENTS.md` as always-on context and registers the `/puritanical` commands and the skills; levels don't persist across sessions, since the lifecycle hooks are not used.

## Qoder

Qoder auto-loads `AGENTS.md` from the repo root as always-on context, so running puritanical from a checkout works with zero setup. For per-project rules, copy [`.qoder/rules/puritanical.md`](.qoder/rules/puritanical.md) into your project's `.qoder/rules/`. The six puritanical skills (`/puritanical`, `/puritanical-review`, `/puritanical-audit`, `/puritanical-debt`, `/puritanical-gain`, `/puritanical-help`) are available via Qoder's Skill system; the plugin manifest at [`.qoder-plugin/plugin.json`](.qoder-plugin/plugin.json) points at the `skills/` directory.

For full plugin-tier support (automatic mode activation + ruleset injection on every prompt), install puritanical as a Qoder plugin (`qodercli plugins install <path-to-puritanical>`): the manifest loads [`hooks/qoder-hooks.json`](hooks/qoder-hooks.json) and Qoder fills in `${QODER_PLUGIN_ROOT}`. Without the plugin, copy those hooks into your `.qoder/settings.json` and replace `${QODER_PLUGIN_ROOT}` with the path to your puritanical checkout. Qoder's `UserPromptSubmit` hook activates the default mode on first prompt and injects the ruleset every turn; `PreToolUse` with `task|Task` matcher injects the ruleset into subagents. Level switches (`/puritanical lite|full|ultra|off`) work automatically.

## Antigravity CLI

```bash
agy plugin install https://github.com/ryanduguid/Puritanical
```

Installs the six skills, and Antigravity turns the `/puritanical` commands into skills as well, so you [call them as slash commands](https://www.antigravity.google/docs/skills#slash-command-conversion) such as `/puritanical-review`. No lifecycle hooks, so levels don't persist. For the always-on ruleset, copy [`AGENTS.md`](AGENTS.md) into your project; Antigravity [reads it as workspace rules](https://www.antigravity.google/docs/rules). Install verified with Antigravity CLI 1.3.3.

## Hermes Agent

```bash
hermes plugins install ryanduguid/Puritanical --enable
```

If that stops with `plugin.json declares an unsupported or missing Agent Plugins schema`, it is Hermes' install check (fix pending in [NousResearch/hermes-agent#125937](https://github.com/NousResearch/hermes-agent/pull/125937)). Until it lands, clone the plugin in by hand; Hermes loads it from `plugin.yaml` as usual (verified with Hermes Agent v0.21.7):

```bash
git clone https://github.com/ryanduguid/Puritanical.git ~/.hermes/plugins/puritanical
hermes plugins enable puritanical
```

Restart Hermes after installing. The plugin injects the active Puritanical mode before each LLM turn, registers the bundled skills as `puritanical:<skill>`, and adds `/puritanical`, `/puritanical-review`, `/puritanical-audit`, `/puritanical-debt`, `/puritanical-gain`, and `/puritanical-help`. In shared gateways, restrict `/puritanical` to trusted users with Hermes slash-command access controls; runtime mode is process-local.

## CodeWhale

Reads `AGENTS.md` from the project root, zero setup. Copy [`AGENTS.md`](AGENTS.md) to your project, or run `codewhale` from a checkout of this repo. That's it.

## Devin CLI

```bash
devin plugins install ryanduguid/Puritanical
```

Installs puritanical as a Devin plugin; skills are available as `/puritanical:puritanical`, `/puritanical:puritanical-review`, and so on.

## OpenClaw

```bash
clawhub install puritanical
```

Installs puritanical as an OpenClaw skill from ClawHub; the review, audit, debt, gain, and help skills install the same way (`clawhub install puritanical-review`, and so on). OpenClaw applies it on coding tasks and also exposes it as a `/puritanical` command. Without ClawHub, copy [`.openclaw/skills/puritanical`](.openclaw/skills/) into `~/.openclaw/skills/`.

## Grok Build

```bash
grok plugin install ryanduguid/Puritanical --trust
```

Enable the plugin (off by default): `/plugins` → Plugins → Space on `puritanical`, or in `~/.grok/config.toml`:

```toml
[plugins]
enabled = ["puritanical"]
```

Start a new session (or reload plugins). Skills show as `/puritanical`, `/puritanical-review`, `/puritanical-audit`, `/puritanical-debt`, `/puritanical-gain`, `/puritanical-help`. Verify with `grok inspect`. Grok can auto-invoke puritanical for coding tasks from its skill description; use `/puritanical` (or `/puritanical lite`, `/puritanical full`, `/puritanical ultra`) when activation needs to be explicit. Grok lifecycle hooks are not used because their SessionStart output cannot inject instructions.

`AGENTS.md` still works instruction-only from a checkout without the plugin.

## Goose

```bash
goose plugin install https://github.com/ryanduguid/Puritanical.git
```

That imports the six skills as `puritanical:puritanical`, `puritanical:puritanical-review` and so on. For the always-on rules, copy [`AGENTS.md`](AGENTS.md) to `~/.agents/AGENTS.md` (or into your project; `~/.config/goose/.goosehints` works too). Goose has no lifecycle hooks, so the levels don't persist.

## Cursor

```bash
git clone https://github.com/ryanduguid/Puritanical
node puritanical/scripts/cursor-hooks.js install
```

Merges two native hooks into `~/.cursor/hooks.json` (add `--project` to write `<project>/.cursor/hooks.json` instead) and keeps any hooks you already have there. The entries run `node` from that checkout, so leave it where it is or re-run the install after moving it. Cursor reloads the file on save; open a new chat and the ruleset for your default level arrives through `sessionStart`. Send `/puritanical lite`, `/puritanical full`, `/puritanical ultra` or `/puritanical off` as a plain message to switch the level for the rest of the conversation; `/puritanical` reports it. Cursor's `subagentStart` cannot inject context, so subagents run without the ruleset, and cloud agents never fire `sessionStart`. The always-on rule (`.cursor/rules/puritanical.mdc`) and the hooks are alternatives: while the rule is in a workspace the hooks inject nothing and the mode commands answer with a notice, so delete the rule to let the hooks manage the level. Contract, verification record and limitations: [docs/cursor-hooks.md](docs/cursor-hooks.md). Uninstall: `node puritanical/scripts/cursor-hooks.js uninstall`.

## Settings

Set the level for every new session with the `PURITANICAL_DEFAULT_MODE` env var (`lite`/`full`/`ultra`/`off`), or a `defaultMode` field in `~/.config/puritanical/config.json` (`%APPDATA%\puritanical\config.json` on Windows). The default is `full`.

While active, the ruleset is also injected into every subagent spawned via the Agent tool. To scope that to specific agent types (say, keep it off read-only search agents), set the `PURITANICAL_SUBAGENT_MATCHER` env var to a regex tested against the subagent's `agent_type`. It is unanchored and case-insensitive: `explore|general` matches either, `^general$` is exact, and plugin agent types look like `plugin:name`. Unset means inject into every subagent (the default); an invalid regex, or a subagent whose type the platform doesn't report, also falls back to injecting.

## Skills CLI

The [skills CLI](https://skills.sh) copies the six puritanical skills into the skills folder of many agents:

```bash
npx skills add ryanduguid/Puritanical
```

Pick the agent with `--agent` (for IBM Bob: `--agent bob`), take all six without asking with `--skill '*'`, and add `--global` to install for your user instead of the project. This installs the skills only; for the always-on ruleset, also add [`AGENTS.md`](AGENTS.md) or use one of the plugins above.

## Other agents (rules file only)

Cursor (rule-only alternative to the [hooks install](#cursor)), Windsurf, Cline, GitHub Copilot Chat (the VS Code, JetBrains, and Visual Studio editor extension, not the standalone [Copilot CLI](#github-copilot-cli)), Aider, Kiro, Zed, CodeWhale, Qoder: copy the matching rules file from this repo ([`.cursor/rules/`](.cursor/rules/), [`.windsurf/rules/`](.windsurf/rules/), [`.clinerules/`](.clinerules/), [`.github/copilot-instructions.md`](.github/copilot-instructions.md), [`AGENTS.md`](AGENTS.md), [`.kiro/steering/`](.kiro/steering/), [`.qoder/rules/`](.qoder/rules/)).

Kiro: copy `.kiro/steering/puritanical.md` to `~/.kiro/steering/` (global) or `.kiro/steering/` in your project.

GitHub Copilot CLI fallback (instruction-only mode): it reads `AGENTS.md` and `.github/copilot-instructions.md` in a project, or copy the rules into `~/.copilot/copilot-instructions.md` to run puritanical in every project. This path keeps always-on guidance, but does not add plugin mode switches or hooks.

VS Code with the Codex extension reads `AGENTS.md`, which this repo ships, so it works from the repo root with no setup (`~/.codex/AGENTS.md` makes Codex global).

JetBrains Junie can read `AGENTS.md` once you point it there in Settings → Tools → Junie → Project Settings → Guidelines Path (it is not automatic yet). This repo ships `AGENTS.md`; `.junie/guidelines.md` is Junie's legacy path.

Amp (Sourcegraph) reads `AGENTS.md` from the working directory and parent directories up to `$HOME`, which this repo ships, so it works with no setup (`~/.config/amp/AGENTS.md` works globally).

Jules (Google) reads `AGENTS.md` from the repository root, which this repo ships, so it picks up the ruleset with no setup.

## Uninstall

| Host | Command |
|------|---------|
| Claude Code | `/plugin remove puritanical` |
| Codex | `codex plugin remove puritanical` |
| Devin CLI | `devin plugins remove puritanical` |
| Grok Build | `grok plugin uninstall puritanical` |
| Pi agent | `pi uninstall puritanical` |
| Kimi Code | `/plugins` in Kimi Code, then remove puritanical |
| Skills CLI | `npx skills remove puritanical puritanical-audit puritanical-debt puritanical-gain puritanical-help puritanical-review` (same `--agent` / `--global` flags as the install) |
| Oh My Pi (omp) | `omp plugin uninstall puritanical@puritanical`, then `omp plugin marketplace remove puritanical` |
| OpenCode | `opencode plugin remove @ryanduguid/puritanical` |
| Cursor hooks | `node scripts/cursor-hooks.js uninstall` (add `--project` for a project-level install); removes only puritanical's entries from `hooks.json` |
| Cursor rule / Windsurf / Cline / Qoder / etc. | Delete the copied rule file |

These remove the plugin's own files. They leave behind a small amount of state puritanical writes outside the plugin folder: the mode flag (`~/.claude/.puritanical-active`, or `~/.cursor/.puritanical-active` for Cursor), `~/.config/puritanical/config.json`, the statusline script copy (`~/.claude/puritanical-statusline.sh` or `.ps1`), puritanical's entries in `~/.cursor/hooks.json`, and (if you accepted the setup nudge) a `statusLine` entry in `~/.claude/settings.json`. Until they are removed, the statusline badge keeps showing the last mode. Run `node scripts/uninstall.js` to clean those up too. **Run it before the host remove command above**: the script is itself a plugin file, so removing the plugin first deletes it (or run it from a separate clone of this repo). It only removes the statusLine entry if it points at puritanical's own script, so a statusline you set up yourself is left untouched.
