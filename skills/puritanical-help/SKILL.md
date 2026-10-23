---
name: puritanical-help
disable-model-invocation: true
description: >
  Quick reference for puritanical levels, skills and commands. One-shot display.
  Use for /puritanical-help, "puritanical help", "how do I use puritanical".
---

# Puritanical Help

Display this reference card when invoked. One-shot, do NOT change mode,
write flag files, or persist anything.

## Levels

| Level | Trigger | What change |
|-------|---------|-------------|
| **Lite** | `/puritanical lite` | Build what was asked, name the smaller option in one line. |
| **Full** | `/puritanical` | Complete requirements, inspect connected code, use proportionate checks and report material limits. Default. |
| **Ultra** | `/puritanical ultra` | Also questions the request and pushes back before building. |

Level sticks until changed or session end.

## Skills

| Skill | Trigger | What it does |
|-------|---------|--------------|
| **puritanical** | `/puritanical` | Complete the requested task with the simplest suitable solution and proportionate checks. |
| **puritanical-review** | `/puritanical-review` | Quality review of a diff: bugs, security, load, missing tests, speed, what to cut. Each finding says what goes wrong and how to fix it. |
| **puritanical-audit** | `/puritanical-audit` | The same quality review for the whole repo, ranked. |
| **puritanical-debt** | `/puritanical-debt` | Harvest `shortcut:` comments into a tracked ledger. |
| **puritanical-help** | `/puritanical-help` | This card. |

In Codex CLI and the IDE extension, invoke skills with `$puritanical:puritanical`,
`$puritanical:puritanical-review`, or `$puritanical:puritanical-help`. Claude Code and OpenCode use the
slash-command forms above (OpenCode ships all six as slash commands).

## Deactivate

Say "stop puritanical" or "normal mode". Resume anytime with `/puritanical`.
`/puritanical off` also works.

## Configure Default Mode

Default mode = `full`, auto-active every session. Change it:

**Environment variable** (highest priority):
```bash
export PURITANICAL_DEFAULT_MODE=ultra
```

**Config file** (`~/.config/puritanical/config.json`, Windows: `%APPDATA%\puritanical\config.json`):
```json
{ "defaultMode": "lite" }
```

Set `"off"` to disable auto-activation on session start, activate manually
with `/puritanical` when wanted.

Resolution: env var > config file > `full`.

## Update

Enable auto-update once: open `/plugin`, go to Marketplaces, pick puritanical, Enable auto-update. Claude Code then pulls new versions at startup (run `/reload-plugins` when it prompts). Manual refresh: `/plugin marketplace update puritanical` then `/reload-plugins`.

If `/plugin` is not recognized, your Claude Code is out of date. Update it (`npm install -g @anthropic-ai/claude-code@latest`, or `brew upgrade claude-code`) and restart. Other hosts use their own update flow.

## More

Full docs + examples: https://github.com/ryanduguid/Puritanical
