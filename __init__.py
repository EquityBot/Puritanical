"""Hermes plugin for Puritanical."""

from __future__ import annotations

import json
import os
import re
from pathlib import Path
from typing import Any, Callable

DEFAULT_MODE = "full"
RUNTIME_MODES = {"off", "lite", "full", "ultra"}
SKILL_COMMANDS = {
    "puritanical-review": "Review the current diff or provided target: bugs, security, load, missing tests, speed, and what to cut.",
    "puritanical-audit": "Audit the whole repo: bugs, security, load, missing tests, speed, and what to cut.",
    "puritanical-debt": "List every deliberate `shortcut:` comment and its upgrade path.",
    "puritanical-help": "Show the Puritanical command reference.",
}

ROOT = Path(__file__).resolve().parent
SKILLS_DIR = ROOT / "skills"
PURITANICAL_SKILL = SKILLS_DIR / "puritanical" / "SKILL.md"

_current_mode = None


def _normalize_runtime_mode(mode: str | None) -> str | None:
    if not isinstance(mode, str):
        return None
    mode = mode.strip().lower()
    return mode if mode in RUNTIME_MODES else None


def _config_dir() -> Path:
    if os.environ.get("XDG_CONFIG_HOME"):
        return Path(os.environ["XDG_CONFIG_HOME"]) / "puritanical"
    if os.name == "nt":
        return Path(os.environ.get("APPDATA", Path.home() / "AppData" / "Roaming")) / "puritanical"
    return Path.home() / ".config" / "puritanical"


def _default_mode() -> str:
    env_mode = _normalize_runtime_mode(os.environ.get("PURITANICAL_DEFAULT_MODE"))
    if env_mode:
        return env_mode
    try:
        data = json.loads((_config_dir() / "config.json").read_text(encoding="utf-8-sig"))
        file_mode = _normalize_runtime_mode(data.get("defaultMode"))
        if file_mode:
            return file_mode
    except Exception:
        pass
    return DEFAULT_MODE


def _strip_frontmatter(text: str) -> str:
    return re.sub(r"^---[\s\S]*?---\s*", "", text or "", count=1)


def _filter_skill_body_for_mode(body: str, mode: str) -> str:
    effective = _normalize_runtime_mode(mode) or DEFAULT_MODE
    lines = []
    # str.splitlines() drops a trailing line terminator instead of yielding a
    # trailing empty element, so a body ending in "\n" loses that newline on
    # rejoin. re.split keeps it, matching the JS filter's split(/\r?\n/).
    for line in re.split(r"\r?\n", _strip_frontmatter(body)):
        table_label = re.match(r"^\|\s*\*\*(.+?)\*\*\s*\|", line)
        if table_label:
            label_mode = _normalize_runtime_mode(table_label.group(1))
            if label_mode and label_mode != effective:
                continue

        # Require a quoted value: every worked example is `- lite: "..."`. Without
        # this, an ordinary rule bullet that happens to start with a mode word
        # (e.g. "- Full: ...") is silently dropped in every other mode — it looks
        # like a worked example but is really prose meant to survive verbatim.
        # Mirrors the fix in hooks/puritanical-instructions.js (#571).
        example_label = re.match(r'^-\s*([^:\s][^:]*):\s*"', line)
        if example_label:
            label_mode = _normalize_runtime_mode(example_label.group(1))
            if label_mode and label_mode != effective:
                continue

        lines.append(line)
    return "\n".join(lines)


_FALLBACK_SKILL_BODY = "# Puritanical\n\nComplete the requested work with the simplest clear solution that meets its\nrequirements. Correctness, safety, accessibility, maintainability and required\nperformance take priority over fewer lines, files or tokens.\n\n## Scope and modes\n\nDefault: **full**. The selected level persists until changed or the session\nends, and applies to coding decisions. Switch with `/puritanical lite|full|ultra`\nor the host's equivalent. `/puritanical off`, \"stop puritanical\" or \"normal mode\"\nturns it off.\n\nFollow the user's scope, project instructions and current permissions. A\nreview, diagnosis or plan stays read-only unless changes are requested.\nComplete explicit requirements without substituting a reduced feature set.\nResolve routine authorised choices from context; ask when a missing decision\nmaterially affects scope, correctness or authority. When a request has more\nthan one reading that changes the result, state the reading you chose, or ask\nwhen the choice is costly to reverse. Use subagents only within explicit user\nauthorisation, including standing permission in the host instructions; retain\nits model, task and read-only limits. Subagents do not inherit these rules:\nwhen you delegate coding, design or review work, tell the subagent to apply\nPuritanical at the current level, for example by loading its skill.\n\n## Understand the change\n\nRead the relevant instructions, implementation and contracts before choosing\na solution. Search for the affected symbols and inspect their callers. Start\nlarge files with structure and targeted sections; expand the reading whenever\na dependency, invariant or uncertainty requires it. Include relevant files\nthat will remain unchanged. Stop expanding once the affected behaviour and\nconstraints are accounted for. Confirm that an API, flag or symbol exists in\nthe installed version before relying on it.\n\nFor a bug, establish expected and actual behaviour with an existing failing\ncheck or a focused reproduction when possible. Separate what you observed from\nwhat you inferred. Find the first owner that violates the contract and fix the\ncause there. Check affected callers; avoid a guard that hides an upstream\nerror. After two fix attempts fail, stop patching: recheck the evidence and the\ndesign before trying again. State missing evidence when the failure cannot be\nreproduced.\n\n## The ladder\n\nChoose the first suitable option that meets the complete requirements:\n\n1. **Required now?** Omit speculative additions and future scaffolding.\n2. **Already in this codebase?** Reuse suitable code, types and patterns.\n3. **Standard library?** Use it when its semantics and resource costs fit.\n4. **Native platform feature?** Prefer it when behaviour and accessibility fit.\n5. **Installed dependency?** Reuse it; add a dependency only for a concrete benefit\n   that justifies its maintenance cost.\n6. **Direct expression?** Use a clear one-liner when it remains easy to inspect.\n7. **New code needed?** Write the smallest cohesive implementation.\n\n## Design judgement\n\n- Keep necessary policy behind a clear boundary. One implementation or one\n  export alone is not evidence of bloat. Remove a wrapper when it adds no useful\n  contract; keep a helper when it improves clarity or removes real duplication.\n- Prefer fewer concepts and fewer places a maintainer must inspect. Use diff\n  size as a tie-breaker after correctness and clarity. Preserve unrelated work.\n- Keep every changed line traceable to the request. Remove what your change\n  made unused; report other dead code instead of deleting it.\n- Select algorithms by their semantics, failure modes and resource costs.\n  A shorter implementation can still use too much time or memory. Reuse the\n  project's optimised stack when a simpler-looking replacement would regress it.\n- Preserve input validation at trust boundaries, security, accessibility,\n  error handling that prevents data loss, and required hardware calibration.\n  In data, money and security paths, reject malformed input or report what was\n  skipped; never drop or coerce it silently.\n- Mark deliberate simplifications that cut a real corner, such as a global\n  lock or naive heuristic, with a `shortcut:` comment naming the ceiling and\n  upgrade path. Ordinary straightforward code needs no justification comment,\n  and no code, commit or PR needs a Puritanical marker.\n\n## Verification and reporting\n\nUse the project's existing test tools and run its required checks. Add focused\nregression coverage for changed failure modes when existing coverage is\ninsufficient. A regression test must be one that fails without the fix: run it\nagainst the unfixed code or say why you could not. Never weaken, skip or\ndelete a test or check to make it pass; change what it asserts only when it\ntests the wrong contract, and say why. Test the contract, not the implementation. A\none-line money calculation or security check can need several cases; size\nalone does not determine risk. Existing sufficient coverage needs no duplicate\nself-check. There is no one-test ceiling or ban on existing frameworks and\nfixtures.\n\nReuse valid results. Repeat or broaden checks when a change, failure,\nintegration risk or unresolved concern justifies it. A timeout is inconclusive:\ninvestigate its cause and adjust the check when supported by evidence. Report\nany required check that could not run.\n\nClaim only what this session's evidence shows: name each check and its result,\nand mark anything skipped as not run. \"Should work\" is not evidence. Lead with\nthe requested result. Explain what changed, the verification and material\nlimitations in the user's requested format. Give requested reports and\nwalkthroughs the detail they need. Inspect generated artefacts using the\nrelevant workflow before claiming they are usable.\n\n## Intensity\n\n| Level | Behaviour |\n| --- | --- |\n| **lite** | Prefer straightforward implementation; mention a simpler alternative when it materially helps. |\n| **full** | Apply the ladder and remove unnecessary complexity within the complete requested change. Default. |\n| **ultra** | Scrutinise complexity more closely while preserving every requirement and required check. |\n"

def _fallback_instructions(mode: str) -> str:
    return f"PURITANICAL MODE ACTIVE — level: {mode}\n\n" + _filter_skill_body_for_mode(_FALLBACK_SKILL_BODY, mode)


def build_injected_context(mode: str | None = None) -> str:
    """Return the mode-filtered Puritanical context injected before LLM turns."""
    effective = _normalize_runtime_mode(mode) or _default_mode()
    if effective == "off":
        return ""
    try:
        body = PURITANICAL_SKILL.read_text(encoding="utf-8")
        return f"PURITANICAL MODE ACTIVE — level: {effective}\n\n{_filter_skill_body_for_mode(body, effective)}"
    except OSError:
        return _fallback_instructions(effective)


def _pre_llm_call(
    session_id: str = "", conversation_history: Any = None, **_: Any
) -> dict[str, str] | None:
    mode = _current_mode or _default_mode()
    # Off is injected too: the ruleset from an earlier turn is replayed every turn,
    # and the /puritanical off reply goes to the user, never to the model.
    context = build_injected_context(mode) or "PURITANICAL MODE OFF"

    # Hermes persists hook context in api_content for cache-stable replay.
    # Re-inject only when the active mode changed or compaction removed it.
    for message in reversed(conversation_history or []):
        if not isinstance(message, dict):
            continue
        api_content = message.get("api_content")
        if not isinstance(api_content, str):
            continue
        matches = re.findall(r"PURITANICAL MODE (?:ACTIVE — level: ([a-z]+)|OFF)", api_content)
        if matches:
            return None if (matches[-1] or "off") == mode else {"context": context}

    # Nothing persisted, so off has nothing to switch off.
    return None if mode == "off" else {"context": context}


def _skill_prompt(command: str, args: str = "") -> str:
    tail = args.strip()
    target = f"\n\nUser arguments: {tail}" if tail else ""
    return (
        f"Load and follow the Hermes plugin skill `puritanical:{command}`. "
        f"{SKILL_COMMANDS[command]}{target}"
    )


def _slash_access_denied(event: Any, gateway: Any, command: str) -> bool:
    if gateway is None or event is None:
        return False
    checker = getattr(gateway, "_check_slash_access", None)
    source = getattr(event, "source", None)
    if checker is None or source is None:
        return False
    try:
        return checker(source, command) is not None
    except Exception:
        return True


def rewrite_gateway_command(event: Any = None, gateway: Any = None, **_: Any) -> dict[str, str] | None:
    """Rewrite authorized gateway /puritanical-* commands into normal agent prompts."""
    text = str(getattr(event, "text", "") or "").strip()
    if not text.startswith("/"):
        return None
    head, _, rest = text[1:].partition(" ")
    command = head.replace("_", "-").lower()
    if command not in SKILL_COMMANDS:
        return None
    if _slash_access_denied(event, gateway, command):
        return None
    return {"action": "rewrite", "text": _skill_prompt(command, rest)}


def _handle_mode_command(raw_args: str) -> str:
    global _current_mode
    arg = (raw_args or "").strip().lower()
    if not arg:
        # Bare /puritanical switches puritanical on, or reports the level when it already is (#639).
        mode = _current_mode or _default_mode()
        if mode != "off":
            return f"Puritanical mode: {mode}. Use `/puritanical lite|full|ultra|off`."
        _current_mode = "full" if _default_mode() == "off" else _default_mode()
        return f"Puritanical mode set to {_current_mode}."
    mode = _normalize_runtime_mode(arg)
    if not mode:
        return "Usage: /puritanical [lite|full|ultra|off]"
    _current_mode = mode
    return f"Puritanical mode set to {mode}."


def _make_skill_command_handler(ctx: Any, command: str) -> Callable[[str], str]:
    def handler(raw_args: str) -> str:
        prompt = _skill_prompt(command, raw_args or "")
        injected = False
        try:
            injected = bool(ctx.inject_message(prompt))
        except Exception:
            injected = False
        if injected:
            return f"Queued `{command}` for the agent."
        return prompt

    return handler


def register(ctx: Any) -> None:
    """Register Puritanical hooks, skills, and slash commands with Hermes."""
    for child in sorted(SKILLS_DIR.iterdir() if SKILLS_DIR.exists() else []):
        skill_md = child / "SKILL.md"
        if child.is_dir() and skill_md.exists():
            ctx.register_skill(child.name, skill_md)

    ctx.register_hook("pre_llm_call", _pre_llm_call)
    ctx.register_hook("pre_gateway_dispatch", rewrite_gateway_command)

    ctx.register_command(
        "puritanical",
        _handle_mode_command,
        description="Set the Puritanical level: lite, full, ultra or off.",
        args_hint="[lite|full|ultra|off]",
    )
    for command, description in SKILL_COMMANDS.items():
        ctx.register_command(
            command,
            _make_skill_command_handler(ctx, command),
            description=description,
            args_hint="[target or notes]",
        )
