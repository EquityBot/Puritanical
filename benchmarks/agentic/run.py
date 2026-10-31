#!/usr/bin/env python3
"""Agentic, multi-file benchmark for puritanical.

Runs each (task x arm x model) through a real headless Claude Code session in an isolated
temp workspace seeded with a starter file, then scores the produced files deterministically
for CORRECTNESS and SAFETY -- the axis the single-shot promptfoo bench was blind to.

Over-engineering is proxied by SOURCE file count + source LOC (tests are counted separately,
never as bloat -- writing a test is good practice, not over-engineering). An LLM-judge
over-engineering score is a later pass.

  python run.py --selftest
      Verify every scorer (good passes, bad is caught). No API, no spend. Run first, always.

  python run.py --all --models haiku,sonnet,opus --runs 5
      Live run (spends API). Workspaces kept under runs/<stamp>/ for inspection.

  python run.py --rescore runs/<stamp>
      Recompute metrics + aggregate from kept workspaces. No API. Use after changing a
      metric or scorer so you never pay the API twice for a measurement tweak.

  python run.py --all --models opus --runs 5 --resume runs/<stamp>
      Finish a stopped run with the same arguments: only unfinished or failed cells run.

shortcut: the claude CLI is the harness (already installed, we run inside it). No SDK
dependency. The CLI's JSON output already carries cost/tokens/duration/permission_denials.
"""
import argparse, concurrent.futures, datetime, json, os, re, shutil, signal, statistics, subprocess, sys, tempfile, time, zlib
from collections import defaultdict
from pathlib import Path

import compare
from tasks import QUICK, TASKS

ROOT = Path(__file__).resolve().parents[2]
RUNS_DIR = Path(__file__).resolve().parent / "runs"

def _skill(rel): return (ROOT / rel).read_text(encoding="utf-8")
def _rules_file(env):
    """A rival's rules file, read from a pinned checkout rather than vendored here."""
    path = os.environ.get(env)
    if not path: sys.exit(f"set {env} to the rules file (see Head to head in the README)")
    return Path(path).read_text(encoding="utf-8")
ARMS = {
    "baseline":       lambda: None,
    "puritanical":       lambda: _skill("skills/puritanical/SKILL.md"),
    "caveman":        lambda: _skill("benchmarks/arms/caveman-SKILL.md"),
    "yagni":          lambda: "Follow YAGNI principles.",
    "yagni-oneliner": lambda: "Follow YAGNI principles, and prefer one-liner solutions.",
    "brief":          lambda: "Be brief.",   # the two words that matched caveman in an independent test
    "puritanical2":      lambda: None,          # plugin arm: PURITANICAL2_PLUGIN_DIR points at the candidate
    "ponytail":       lambda: None,          # plugin arm: PONYTAIL_PLUGIN_DIR points at a pinned rival checkout
    "superpowers":    lambda: None,          # plugin arm: SUPERPOWERS_PLUGIN_DIR, as above
    "karpathy":       lambda: _rules_file("KARPATHY_CLAUDE_MD"),   # a CLAUDE.md, which the isolated cells would not load
    "concise":        lambda: None,          # Claude Code's built-in Concise output style, no plugin
}
SETTINGS_ARMS = {"concise": '{"outputStyle": "Concise"}'}   # arms that differ only by a settings value
# Shorthands; any other value is passed to `claude --model` as is, so new models need no code change.
MODELS = {"haiku": "claude-haiku-4-5-20251001", "sonnet": "claude-sonnet-5-5", "opus": "claude-opus-5-5",
          "fable": "claude-fable-5-1"}

# Skills are plugins activated by a SessionStart hook. To test exactly one at a time we exclude the
# user's globally-enabled plugins (--setting-sources project,local) and load one plugin from its
# cache dir (--plugin-dir). The smoke test verifies activation by output style.
PLUGIN_ARMS = ("puritanical", "caveman", "puritanical2", "ponytail", "superpowers")          # arms activated via --plugin-dir (vs raw --append prompts)
PLUGIN_NAMES = {"puritanical2": "puritanical"}   # arms whose plugin is not named after them
PLUGIN_CACHE = Path.home() / ".claude" / "plugins" / "cache"

def _plugin_dir(name):
    """Resolve a plugin's cache dir portably -- hardcoding one machine's absolute path
    (e.g. C:\\Users\\<you>\\...) made the puritanical/caveman arms unreproducible off that box.
    Order: env override -> latest version dir under ~/.claude/plugins/cache -> clear error.
    Resolved per-arm at use-site so a missing caveman install can't block a puritanical-only run."""
    env = os.environ.get(f"{name.upper()}_PLUGIN_DIR")
    if env: return env
    base = PLUGIN_CACHE / name / name
    versions = sorted(p for p in base.glob("*") if p.is_dir()) if base.exists() else []
    if not versions:
        sys.exit(f"{name} plugin dir not found under {base}; install the plugin or set {name.upper()}_PLUGIN_DIR")
    return str(versions[-1])                    # latest version dir; not pinned to one machine's hash

PINNED = {"puritanical": "PURITANICAL_PLUGIN_DIR", "ponytail": "PONYTAIL_PLUGIN_DIR",
          "superpowers": "SUPERPOWERS_PLUGIN_DIR", "karpathy": "KARPATHY_CLAUDE_MD"}
TMPL_COMMIT = "cd83fc1"

def _checkout(label, path):
    """The remote and commit of a clean git checkout. Exits otherwise: a result has to be traceable."""
    checkout = Path(path) if Path(path).is_dir() else Path(path).parent
    def git(*args):
        r = subprocess.run(["git", "-C", str(checkout), *args], capture_output=True, text=True)
        if r.returncode: sys.exit(f"{label}: {checkout} is not a git checkout with an origin")
        return r.stdout.strip()
    source = {"path": str(path), "remote": git("remote", "get-url", "origin"), "commit": git("rev-parse", "HEAD")}
    if git("status", "--porcelain"): sys.exit(f"{label}: {checkout} has uncommitted changes")
    return source

def _fixture_path(name):
    """A fixture is an absolute path or a name under fixtures/."""
    fx = Path(name)
    return fx if fx.is_absolute() else Path(__file__).resolve().parent / "fixtures" / name

def _sources(arms, task_ids):
    """Record what each pinned arm and the template run from. Stops before any spend when one is
    unset, not a clean git checkout, or (the template) not at its pinned commit."""
    sources = {}
    for arm in arms:
        if arm not in PINNED: continue
        path = os.environ.get(PINNED[arm])
        if not path: sys.exit(f"set {PINNED[arm]} for the {arm} arm (see Head to head in the README)")
        sources[arm] = _checkout(PINNED[arm], path)
    for name in {TASKS[t]["fixture"] for t in task_ids if TASKS[t].get("fixture")}:
        path = _fixture_path(name)
        if not path.is_dir(): sys.exit(f"template not found at {path}; see Reproduce in the README")
        sources["template"] = _checkout("template", path)
        if not sources["template"]["commit"].startswith(TMPL_COMMIT):
            sys.exit(f"template: {path} is not at the pinned commit {TMPL_COMMIT}")
    return sources

CELL_TIMEOUT = 300  # seconds per cell; a hung agent is force-killed (process tree) so the pool can't freeze
SCORE_TIMEOUT = 120 # seconds to score a cell; produced code runs during scoring and can hang
RETRY_WAITS = (30, 120, 300)   # seconds before each retry of a session that failed with an error
MAX_FAILED_IN_A_ROW = 5        # cells still failing after their retries: stop rather than burn the queue
PREFLIGHT_MODEL = "claude-preflight-no-such-model"

# Added to every arm's system prompt, identically. We measure code PRODUCTION, not execution: agents
# write the implementation and stop. No live verification -- earlier attempts had agents open a browser,
# hit the template's login wall, and retry, inflating tokens/time with flailing instead of code. Writing
# tests is still explicitly allowed, so puritanical's "leave a runnable check" discipline is not suppressed.
NO_RUN = ("Write the implementation (include tests if you normally would for a change like this). "
          "Do not run a dev server, install dependencies, run a database, or open a browser to verify -- "
          "just write the code and stop. Only the code you write is measured, not its execution.")

def _is_test(p: Path, workdir: Path):
    rel = p.relative_to(workdir)
    name = p.name.lower()
    return (name.startswith("test_") or name.endswith("_test.py") or name == "conftest.py"
            or any(part.lower() in ("test", "tests") for part in rel.parts[:-1]))

CODE_EXT = {".py", ".js", ".ts", ".jsx", ".tsx", ".html", ".css", ".go", ".rs", ".java", ".rb", ".sh"}

def _count(p: Path, with_comments: bool):
    try: lines = p.read_text(encoding="utf-8", errors="ignore").splitlines()
    except Exception: return 0
    n = 0
    for ln in lines:
        s = ln.strip()
        if not s: continue
        if not with_comments and s.startswith(("#", "//", "*", "/*", "*/")): continue
        n += 1
    return n

_SELFCHECK_DEFS = ("def demo(", "def _demo(", "def selfcheck(", "def _selfcheck(",
                   "def _check(", "def _smoke(", "def smoke(")
def _selfcheck_split(p: Path):
    """Split a produced .py file at the first TOP-LEVEL self-check marker (a `__main__` guard or a
    demo()/selfcheck() function) through end of file. Returns (src_total, src_code, sc_total,
    sc_code), counted like _count. On a surgical task that delivers ONE function, an in-file self-
    check is the runnable check puritanical's rule asks for -- a positive signal, not source bloat --
    so it is split off here and counted as test LOC instead of penalising the arm that wrote it."""
    try: lines = p.read_text(encoding="utf-8", errors="ignore").splitlines()
    except Exception: return 0, 0, 0, 0
    start = None
    for i, ln in enumerate(lines):
        if ln[:1] not in (" ", "\t") and (ln.startswith("if __name__") or ln.startswith(_SELFCHECK_DEFS)):
            start = i; break
    def cnt(seq):
        t = c = 0
        for ln in seq:
            s = ln.strip()
            if not s: continue
            t += 1
            if not s.startswith(("#", "//", "*", "/*", "*/")): c += 1
        return t, c
    if start is None:
        t, c = cnt(lines); return t, c, 0, 0
    t, c = cnt(lines[:start]); st, sc = cnt(lines[start:])
    return t, c, st, sc

def gz(text):
    """Information content in bytes: raw-deflate size (Minimum Description Length proxy). Repeated
    names and boilerplate cost little, so packing code into one line gains much less here than in LOC."""
    data = text.encode("utf-8", "ignore")
    if not data: return 0
    c = zlib.compressobj(9, zlib.DEFLATED, -15)
    return len(c.compress(data) + c.flush())

def code_stats(workdir: Path, selfcheck_as_test: bool = False):
    """LOC over code-extension source files only (generated images/data can't pollute it).
    total_loc counts every non-blank line including comments and docstrings -- the bloat a vibe
    baseline actually produces. src_loc is code-only, for the breakdown. Tests tracked separately,
    never as bloat. selfcheck_as_test (surgical tasks): an in-file __main__/demo() self-check is
    reclassified from source to test, so following puritanical's 'leave a runnable check' rule is not
    counted as code bloat against it."""
    fixture = set()                                   # files that were seeded, not delivered
    fm = workdir / "_fixture_files.json"
    if fm.exists():
        try: fixture = set(json.loads(fm.read_text(encoding="utf-8")))
        except Exception: pass
    def _rel(p): return str(p.relative_to(workdir)).replace("\\", "/")
    files = [p for p in workdir.rglob("*") if p.is_file() and p.suffix in CODE_EXT
             and "__pycache__" not in p.parts and "node_modules" not in p.parts
             and not p.name.startswith((".", "_")) and _rel(p) not in fixture]
    src = [p for p in files if not _is_test(p, workdir)]
    tst = [p for p in files if _is_test(p, workdir)]
    test_loc = sum(_count(p, True) for p in tst)
    gz_code = gz("\n".join(p.read_text(encoding="utf-8", errors="ignore") for p in src))
    if selfcheck_as_test:
        total = code = sc_test = 0
        for p in src:
            t, c, st, _ = _selfcheck_split(p)
            total += t; code += c; sc_test += st
        return {"files": len(files), "src_files": len(src),
                "total_loc": total, "src_loc": code,
                "test_files": len(tst), "test_loc": test_loc + sc_test, "gz_code": gz_code}
    return {"files": len(files), "src_files": len(src),
            "total_loc": sum(_count(p, True) for p in src),   # incl comments + docstrings (the bloat)
            "src_loc": sum(_count(p, False) for p in src),    # code only
            "test_files": len(tst), "test_loc": test_loc, "gz_code": gz_code}

def _git(workdir, *args):
    return subprocess.run([shutil.which("git") or "git", *args], cwd=str(workdir),
                          capture_output=True, text=True)

def _git_snapshot(workdir):
    """Commit the seeded repo so we can diff exactly what the agent changes."""
    _git(workdir, "init", "-q")
    _git(workdir, "add", "-A")
    _git(workdir, "-c", "user.email=bench@local", "-c", "user.name=bench",
         "commit", "-q", "-m", "base", "--no-verify")

_SKIP_DIFF = ("-lock", ".lock", ".gen.ts", "lock.json", "routeTree.gen")
def git_diff_stats(workdir):
    """Added lines (incl comments) of code files the agent created OR modified, vs the seeded
    base. This is the delivered-code metric and matches the '+N' a PR/diff shows. Tests counted
    separately; lockfiles/generated files skipped."""
    _git(workdir, "add", "-A")
    out = _git(workdir, "diff", "--cached", "--numstat", "HEAD").stdout
    loc = files = test_loc = test_files = 0
    src_paths = []
    for line in out.splitlines():
        parts = line.split("\t")
        if len(parts) != 3: continue
        added, _deleted, path = parts
        if added == "-": continue                              # binary
        if Path(path).suffix not in CODE_EXT: continue
        if any(k in path for k in _SKIP_DIFF) or "node_modules" in path: continue
        n = int(added)
        if _is_test(Path(workdir) / path, Path(workdir)): test_loc += n; test_files += 1
        else: loc += n; files += 1; src_paths.append(path)
    added = _git(workdir, "diff", "--cached", "-U0", "HEAD", "--", *src_paths).stdout if src_paths else ""
    gz_code = gz("\n".join(l[1:] for l in added.splitlines() if l.startswith("+") and not l.startswith("+++")))
    return {"files": files, "src_files": files, "total_loc": loc, "src_loc": loc,
            "test_files": test_files, "test_loc": test_loc, "gz_code": gz_code}

def _write(path: Path, content):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")

def selftest():
    """Each task's good ref must score correct+safe; the bad ref must be caught on its
    declared axis. Verifies the instruments before any API spend."""
    failures = 0
    for tid, task in TASKS.items():
        if task.get("open"): continue  # open tasks measure LOC only, no good/bad refs
        axis = task.get("axis", "safe")
        for kind in ("good", "bad"):
            with tempfile.TemporaryDirectory() as d:
                ref = task[kind] if isinstance(task[kind], dict) else {task["file"]: task[kind]}
                for fn, content in {**task.get("seed", {}), **ref}.items():  # seed, then the ref on top
                    _write(Path(d) / fn, content)
                for fn in ("_claude.json", "_claude.stream.jsonl", "_claude.stderr.txt", "_score.json"):
                    _write(Path(d) / fn, "")                                 # what a live cell leaves behind
                r = task["score"](Path(d))
            ok = (r["correct"] == 1 and r["safe"] == 1) if kind == "good" else (r[axis] == 0)
            print(f"{'ok ' if ok else 'XX '} {tid:12} {kind:4} correct={r['correct']} "
                  f"safe={r['safe']} axis={axis}  {r['reason']}")
            failures += 0 if ok else 1
    row = aggregate([{"task": "t", "arm": "a", "model": "m", "error": "boom"}])[0]
    ok = row["safe_rate"] == 0 and row["correct_rate"] == 0
    print(f"{'ok ' if ok else 'XX '} aggregate    a crashed cell counts as failed")
    failures += 0 if ok else 1
    failures += _selftest_aggregate()
    failures += _selftest_session()
    failures += _selftest_activation()
    failures += _selftest_retries()
    failures += _selftest_isolated_scoring()
    failures += _selftest_plugin_dir()
    failures += _selftest_kill()
    failures += compare.selftest()
    print(f"\nselftest: {'all instruments valid' if not failures else str(failures) + ' BROKEN'}")
    return failures

def _report(name, ok):
    print(f"{'ok ' if ok else 'XX '} {name}")
    return 0 if ok else 1

def _selftest_aggregate():
    """A session error says nothing about the arm, so it leaves the rates. A timeout is the arm's
    own failure, and its spend is unknown, so cost per pass must not look cheaper for it."""
    ok_cell = {"task": "t", "arm": "a", "model": "m", "correct": 1, "safe": 1, "cost": 1.0}
    row = aggregate([ok_cell, {"task": "t", "arm": "a", "model": "m", "infra": True, "infra_reason": "limit"}])[0]
    fails = _report("aggregate    a session error leaves the rates and is counted apart",
                    row["n"] == 1 and row["correct_rate"] == 1 and row["infra"] == 1)
    only = aggregate([{"task": "t", "arm": "a", "model": "m", "infra": True}])[0]
    fails += _report("aggregate    an arm with only session errors has no rates", only["n"] == 0 and only["correct_rate"] == 0)
    row = aggregate([ok_cell, {"task": "t", "arm": "a", "model": "m", "correct": 0, "safe": 0, "timed_out": True}])[0]
    return fails + _report("aggregate    a timeout fails, and hides cost per pass",
                           row["n"] == 2 and abs(row["correct_rate"] - 0.5) < 1e-9 and row["timeouts"] == 1 and row["cost_per_pass"] is None)

def _selftest_session():
    fails = 0
    with tempfile.TemporaryDirectory() as d:
        ws, log = Path(d) / "ws", Path(d) / "log"
        ws.mkdir()
        log.write_text('{"type":"system"}\nnot json\n{"type":"result","is_error":true,"result":"limit reached"}\n', encoding="utf-8")
        _keep_result(log, ws)
        fails += _report("session      an error result is a session error, with its reason",
                         _session_status(ws) == ("infra", "limit reached"))
        log.write_text('{"type":"result","is_error":false,"result":"done"}\n', encoding="utf-8")
        _keep_result(log, ws)
        fails += _report("session      a clean result is fine", _session_status(ws) == ("ok", ""))
        log.write_text("", encoding="utf-8")
        _keep_result(log, ws)
        fails += _report("session      no result is a session error", _session_status(ws)[0] == "infra")
        (ws / "_claude.stderr.txt").write_text("[KILLED after 300s timeout]", encoding="utf-8")
        fails += _report("session      a killed session is a timeout", _session_status(ws)[0] == "timeout")
    return fails

def _selftest_activation():
    builtin = {"name": "cc-plugin-telemetry", "path": "builtin"}
    inline = {"name": "ponytail", "path": "/x/ponytail"}
    hook = {"subtype": "hook_response", "hook_event": "SessionStart", "exit_code": 0, "stdout": "the rules"}
    cases = [("baseline", [{"subtype": "init", "plugins": [builtin]}], None),
             ("baseline", [{"subtype": "init", "plugins": [builtin, inline]}, hook], "plugins"),
             ("ponytail", [hook, {"subtype": "init", "plugins": [builtin, inline]}], None),
             ("ponytail", [{"subtype": "init", "plugins": [builtin]}], "plugins"),
             ("ponytail", [hook, {"subtype": "init", "plugins": [{"name": "puritanical", "path": "/x/p"}]}], "plugins"),
             ("ponytail", [{**hook, "stdout": ""}, {"subtype": "init", "plugins": [inline]}], "hook"),
             ("ponytail", [{**hook, "exit_code": 1}, {"subtype": "init", "plugins": [inline]}], "hook"),
             ("concise", [{"subtype": "init", "plugins": [builtin], "output_style": "default"}], "style"),
             ("concise", [{"subtype": "init", "plugins": [builtin], "output_style": "Concise"}], None),
             ("baseline", [], "init")]
    with tempfile.TemporaryDirectory() as d:
        log = Path(d) / "log"
        def verdict(arm, events):
            log.write_text("\n".join(json.dumps(e) for e in events), encoding="utf-8")
            return _activation_problem(arm, log)
        ok = all((verdict(arm, events) is None) if want is None else (want in (verdict(arm, events) or ""))
                 for arm, events, want in cases)
    return _report("activation   each arm has its rules, and only its rules", ok)

def _selftest_retries():
    calls, waits = [], []
    def flaky():
        calls.append(1)
        return {"infra": len(calls) < 3}
    ok = not _with_retries(flaky, waits.append).get("infra") and waits == list(RETRY_WAITS[:2])
    calls.clear(); waits.clear()
    ok = ok and _with_retries(lambda: calls.append(1) or {"infra": True}, waits.append).get("infra") \
        and len(calls) == len(RETRY_WAITS) + 1
    return _report("retries      a session error retries, then is reported", ok)

def _selftest_isolated_scoring():
    """Scoring one cell must not see another cell's code, and produced code that hangs or exits
    must fail that cell without taking the run with it."""
    fails = 0
    with tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as d:
        finished = '{"is_error": false, "result": "done"}'
        delivered, missing = Path(d) / "reuse-slug__a__m__0", Path(d) / "reuse-slug__b__m__0"
        task = TASKS["reuse-slug"]
        good = task["good"] if isinstance(task["good"], dict) else {task["file"]: task["good"]}
        for fn, content in {**task.get("seed", {}), **good}.items():
            _write(delivered / fn, content)
        _write(delivered / "_claude.json", finished)
        _write(missing / "_claude.json", finished)
        first = score_isolated("reuse-slug", "a", "m", delivered)
        second = score_isolated("reuse-slug", "b", "m", missing)
        fails += _report("scoring      a cell cannot import another cell's code",
                         first["correct"] == 1 and second["correct"] == 0)
        _write(delivered / "_claude.stderr.txt", "[KILLED after 300s timeout]")
        killed = score_isolated("reuse-slug", "a", "m", delivered)
        fails += _report("scoring      a killed cell fails even with good code",
                         killed["correct"] == 0 and killed["safe"] == 0 and killed["timed_out"])
        for label, code in (("hangs", "import time\ntime.sleep(60)\n"), ("exits", "import os\nos._exit(3)\n")):
            ws = Path(d) / f"cache__{label}__m__0"
            _write(ws / TASKS["cache"]["file"], code)
            _write(ws / "_claude.json", finished)
            r = score_isolated("cache", label, "m", ws, timeout=5)
            fails += _report(f"scoring      produced code that {label} fails its cell", r["correct"] == 0 and r["safe"] == 0)
    return fails

def _selftest_plugin_dir():
    """Plugin-dir resolution must be portable: env override wins, and a missing install
    fails loudly (sys.exit) instead of silently passing a non-existent path to --plugin-dir."""
    fails = 0
    sentinel = "/tmp/puritanical-selftest-plugin-dir"
    previous = os.environ.get("PURITANICAL_PLUGIN_DIR")
    os.environ["PURITANICAL_PLUGIN_DIR"] = sentinel
    try:
        ok_env = _plugin_dir("puritanical") == sentinel
    finally:                                         # restore, never delete: this selftest runs before
        if previous is None:                         # every live run, so deleting it silently swapped the
            del os.environ["PURITANICAL_PLUGIN_DIR"]    # user's override for the newest cached plugin version
        else:
            os.environ["PURITANICAL_PLUGIN_DIR"] = previous
    ok_env = ok_env and os.environ.get("PURITANICAL_PLUGIN_DIR") == previous
    print(f"{'ok ' if ok_env else 'XX '} plugin_dir   env  override honored and restored")
    fails += 0 if ok_env else 1
    missing = "puritanical-does-not-exist-xyz"          # no env, no cache entry -> must sys.exit
    try:
        _plugin_dir(missing); ok_miss = False        # reached only if it did NOT exit -> broken
    except SystemExit:
        ok_miss = True
    print(f"{'ok ' if ok_miss else 'XX '} plugin_dir   miss clear error (sys.exit)")
    fails += 0 if ok_miss else 1
    def exits(fn):
        try:
            fn(); return False
        except SystemExit:
            return True
    previous = {e: os.environ.pop(e, None) for e in ("PONYTAIL_PLUGIN_DIR", "PURITANICAL_PLUGIN_DIR")}
    ok_rival = exits(lambda: _sources(["ponytail"], [])) and exits(lambda: _sources(["puritanical"], []))
    with tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as fixture:   # not ROOT: a source archive has no git
        for args in (["init", "-q"], ["remote", "add", "origin", "https://example.invalid/rival.git"],
                     ["-c", "user.name=t", "-c", "user.email=t@example.invalid", "commit", "-q", "--allow-empty", "-m", "t"]):
            subprocess.run(["git", "-C", fixture, *args], check=True, capture_output=True)
        os.environ["PONYTAIL_PLUGIN_DIR"] = fixture
        ok_rival = ok_rival and len(_sources(["ponytail"], [])["ponytail"]["commit"]) == 40 and _sources(["baseline"], []) == {}
        (Path(fixture) / "edit.txt").write_text("x", encoding="utf-8")
        ok_dirty = exits(lambda: _sources(["ponytail"], []))
    for env, value in previous.items():
        os.environ.pop(env, None)
        if value is not None: os.environ[env] = value
    fails += _report("sources      unset exits, checkout records its commit", ok_rival)
    fails += _report("sources      uncommitted changes exit", ok_dirty)
    tmpl = TASKS["tmpl-be-count"]["fixture"]
    with tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as fixture:
        for args in (["init", "-q"], ["remote", "add", "origin", "https://example.invalid/template.git"],
                     ["-c", "user.name=t", "-c", "user.email=t@example.invalid", "commit", "-q", "--allow-empty", "-m", "t"]):
            subprocess.run(["git", "-C", fixture, *args], check=True, capture_output=True)
        TASKS["tmpl-be-count"]["fixture"] = fixture           # a real checkout, at the wrong commit
        ok_wrong = exits(lambda: _sources([], ["tmpl-be-count"]))
    TASKS["tmpl-be-count"]["fixture"] = str(Path(tempfile.gettempdir()) / "puritanical-no-such-template")
    ok_missing = exits(lambda: _sources([], ["tmpl-be-count"]))
    TASKS["tmpl-be-count"]["fixture"] = tmpl
    fails += _report("sources      a missing or unpinned template exits", ok_wrong and ok_missing)
    return fails

def _tree_kill(proc):
    """Tree-kill one timed-out cell, never a blanket kill (that would also take down this
    Claude Code session). Windows: taskkill /T walks the child PIDs. POSIX has no taskkill,
    so the cell runs in its own session (Popen start_new_session) and we kill the group."""
    if os.name == "nt":
        subprocess.run(["taskkill", "/F", "/T", "/PID", str(proc.pid)],
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    else:
        try: os.killpg(os.getpgid(proc.pid), signal.SIGKILL)
        except ProcessLookupError: pass  # already exited

def _selftest_kill():
    """tree-kill must actually terminate a cell that outran its timeout, on this platform."""
    p = subprocess.Popen([sys.executable, "-c", "import time; time.sleep(30)"],
                         start_new_session=(os.name != "nt"))
    _tree_kill(p)
    try: ok = p.wait(timeout=10) is not None
    except subprocess.TimeoutExpired: ok = False; p.kill()
    print(f"{'ok ' if ok else 'XX '} tree_kill    terminates a timed-out cell")
    return 0 if ok else 1

def chat_code_loc(text):
    """LOC of fenced code blocks in a chat answer: (total incl comments, code-only)."""
    total = code = 0
    for b in re.findall(r"```[a-zA-Z0-9_+-]*\r?\n(.*?)```", text or "", re.S):
        for ln in b.splitlines():
            s = ln.strip()
            if not s: continue
            total += 1
            if not s.startswith(("#", "//", "*", "/*", "*/")): code += 1
    return total, code

def _session_meta(workdir: Path):
    """What the CLI reported about the session, and the reply. Empty when it reported nothing."""
    try:
        j = json.loads((workdir / "_claude.json").read_text(encoding="utf-8"))
        u = j.get("usage") or {}
        result_text = j.get("result", "")
        return {"cost": j.get("total_cost_usd"), "duration_ms": j.get("duration_ms"),
                "turns": j.get("num_turns"), "denials": len(j.get("permission_denials") or []),
                "out_tokens": u.get("output_tokens"), "in_tokens": u.get("input_tokens"),
                "cache_tokens": (u.get("cache_read_input_tokens") or 0) + (u.get("cache_creation_input_tokens") or 0),
                "reply_words": len(result_text.split()),
                # share of the reply that is not redundancy: compressed / raw. Filler and repeated
                # recaps compress well; dense information does not. Reported, not optimized blindly.
                "reply_density": round(gz(result_text) / max(1, len(result_text.encode())), 3)}, result_text
    except Exception:
        return {}, ""

def _keep_result(log: Path, workdir: Path):
    """The stream's final result event becomes _claude.json, which the judges read. No result
    leaves it empty, which they read as nothing delivered."""
    result = ""
    for line in log.read_text(encoding="utf-8", errors="ignore").splitlines():
        try: event = json.loads(line)
        except ValueError: continue
        if event.get("type") == "result": result = line
    (workdir / "_claude.json").write_text(result, encoding="utf-8")

def _session_status(workdir: Path):
    """ok, timeout (the arm ran out of time) or infra (the session failed, which says nothing about the arm)."""
    stderr = workdir / "_claude.stderr.txt"
    if stderr.exists() and "[KILLED after" in stderr.read_text(encoding="utf-8", errors="ignore"):
        return "timeout", ""
    try: j = json.loads((workdir / "_claude.json").read_text(encoding="utf-8"))
    except (OSError, ValueError): return "infra", "the session reported no result"
    if j.get("is_error") or "error" in j:
        return "infra", str(j.get("result") or j.get("error"))[:200]
    return "ok", ""

def _activation_problem(arm, log: Path):
    """What is wrong with the rules this session loaded, or None. A plugin arm must load only its own
    plugin, whose SessionStart hook injected something; any other arm must load none."""
    events = []
    for line in log.read_text(encoding="utf-8", errors="ignore").splitlines():
        try: events.append(json.loads(line))
        except ValueError: continue
    init = next((e for e in events if e.get("subtype") == "init"), None)
    if not init: return "the session never started (no init event)"
    plugins = [p.get("name") for p in init.get("plugins") or [] if p.get("path") != "builtin"]
    expected = [PLUGIN_NAMES.get(arm, arm)] if arm in PLUGIN_ARMS else []
    if plugins != expected: return f"unexpected plugins loaded: {plugins}, expected {expected}"
    if arm in PLUGIN_ARMS and not any(e.get("subtype") == "hook_response" and e.get("hook_event") == "SessionStart"
                                      and e.get("exit_code") == 0 and (e.get("stdout") or "").strip() for e in events):
        return f"the SessionStart hook of {plugins[0]} injected nothing"
    if arm in SETTINGS_ARMS and init.get("output_style") != json.loads(SETTINGS_ARMS[arm])["outputStyle"]:
        return f"output style is {init.get('output_style')}"
    return None

def score_workspace(task_id, arm, model, workdir: Path):
    meta, result_text = _session_meta(workdir)
    cell = {"task": task_id, "arm": arm, "model": model, "cell": workdir.name}
    status, reason = _session_status(workdir)
    log = workdir / "_claude.stream.jsonl"
    if status != "timeout" and log.exists():      # a kept run from before this log existed has nothing to check
        problem = _activation_problem(arm, log)
        if status == "ok" and problem: status, reason = "infra", problem
    if status == "infra": return {**cell, "infra": True, "infra_reason": reason, **meta}
    if status == "timeout": cell["timed_out"] = True
    surgical = not TASKS[task_id].get("open") and not TASKS[task_id].get("fixture")
    diffed = TASKS[task_id].get("fixture") or TASKS[task_id].get("diff")
    stats = git_diff_stats(workdir) if diffed else code_stats(workdir, selfcheck_as_test=surgical)
    # open/explain tasks answer in the chat, not a file. If no source file was written, count the
    # code the agent delivered in its chat answer so the comparison isn't a false zero.
    if TASKS[task_id].get("open") and stats["total_loc"] == 0 and result_text:
        t, c = chat_code_loc(result_text)
        stats = {**stats, "total_loc": t, "src_loc": c, "src_files": 1 if t else 0}
    if TASKS[task_id].get("fixture"):
        sc = {"correct": 1 if stats.get("total_loc", 0) > 0 else 0, "safe": 1, "reason": "git-diff"}
    else:
        sc = TASKS[task_id]["score"](workdir)
    if status == "timeout": sc = {**sc, "correct": 0, "safe": 0}   # partial files must not pass
    return {**cell, **sc, **stats, **meta}

def score_isolated(task_id, arm, model, workdir: Path, timeout=SCORE_TIMEOUT):
    """Score in a child process. Scoring runs the agent's code: in-process, _import_pkg's sys.path
    lets one cell import another's files, and code that hangs or exits stops the whole run."""
    workdir = Path(workdir).resolve()
    out = workdir / "_score.json"
    out.unlink(missing_ok=True)
    proc = subprocess.Popen([sys.executable, str(Path(__file__).resolve()), "--score-cell", task_id, arm, model],
                            cwd=str(workdir), stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                            start_new_session=(os.name != "nt"))
    try:
        proc.wait(timeout=timeout)
    except subprocess.TimeoutExpired:
        _tree_kill(proc)
        try: proc.wait(timeout=15)
        except Exception: pass
    try:
        return json.loads(out.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {"task": task_id, "arm": arm, "model": model, "cell": workdir.name, "correct": 0, "safe": 0,
                "reason": "scoring hung or exited", **_session_meta(workdir)[0]}

def _base_cmd(claude, prompt, model):
    return [claude, "-p", prompt, "--model", MODELS.get(model, model),
            "--permission-mode", "bypassPermissions", "--output-format", "stream-json", "--verbose",
            "--include-hook-events", "--no-session-persistence",
            "--setting-sources", "project,local", "--strict-mcp-config",
            "--disallowedTools", "Bash"]

def _arm_cmd(arm, prompt, model):
    # Skills are PLUGINS (SessionStart hook); --append of the SKILL text does NOT activate them.
    # Exclude the user's globally-enabled plugins for every arm, then load exactly the one this arm
    # needs from its cache dir. baseline loads none; yagni-oneliner is a raw prompt so it uses --append.
    # No live verification (see NO_RUN): --strict-mcp-config drops all MCP servers so there is no browser
    # tool, and --disallowedTools Bash blocks running a server/db/npm. An agent writes with
    # Read/Write/Edit/Glob/Grep and stops -- no login wall, no browser thrash. We measure code, not execution.
    claude = shutil.which("claude")
    if not claude: sys.exit("claude CLI not found on PATH")
    cmd = _base_cmd(claude, prompt, model)
    append = NO_RUN                                     # all arms get NO_RUN, identically
    if arm in PLUGIN_ARMS:
        cmd += ["--plugin-dir", _plugin_dir(arm)]       # real activation of exactly one plugin
    elif arm in SETTINGS_ARMS:
        cmd += ["--settings", SETTINGS_ARMS[arm]]
    else:
        extra = ARMS[arm]()                             # baseline -> None; yagni-oneliner -> the prompt
        if extra: append = extra + "\n\n" + NO_RUN
    return cmd + ["--append-system-prompt", append]

# Cells live under this repo, so without these every arm (baseline too) also loads the
# repo's AGENTS.md, which is the puritanical ruleset, plus the user's auto-memory.
CELL_ENV = {**os.environ, "CLAUDE_CODE_DISABLE_CLAUDE_MDS": "1", "CLAUDE_CODE_DISABLE_AUTO_MEMORY": "1"}

def preflight(arms):
    """Prove each arm activates, before any spend. An unknown model fails with a cost of 0, but only
    after the hooks have run and the session has reported what it loaded."""
    for arm in arms:
        with tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as d:
            log = Path(d) / "preflight.jsonl"
            with open(log, "wb") as so:
                subprocess.run(_arm_cmd(arm, "ok", PREFLIGHT_MODEL), cwd=d, stdout=so, stderr=subprocess.DEVNULL,
                               env=CELL_ENV, timeout=120)
            problem = _activation_problem(arm, log)
        if problem: sys.exit(f"preflight: the {arm} arm did not activate: {problem}")
        print(f"preflight: {arm} activates", flush=True)

def warm_cache(arm, model):
    """One throwaway call per arm before the pool. Without it the first parallel cells each pay the cold
    prompt-cache write of that arm's prefix (smoke run: ~$0.32 vs ~$0.10 per cell), which is ordering
    noise, not an arm effect. Cells running back to back keep the cache warm."""
    with tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as d:
        subprocess.run(_arm_cmd(arm, "Reply with: ok", model), cwd=d, stdout=subprocess.DEVNULL,
                       stderr=subprocess.DEVNULL, timeout=CELL_TIMEOUT, env=CELL_ENV)

def run_session(task_id, arm, model, workdir: Path):
    task = TASKS[task_id]
    if task.get("fixture"):                            # copy a real repo in; record what was seeded
        fx = _fixture_path(task["fixture"])
        shutil.copytree(fx, workdir, dirs_exist_ok=True,
                        ignore=shutil.ignore_patterns("node_modules", ".git", "build", "dist",
                                                       "dist-ssr", ".vite", "*.log", "__pycache__",
                                                       "storage", ".venv", "venv", ".pytest_cache",
                                                       "*.mp4", "*.mp3", "*.wav", "*.mov",
                                                       "*service-account*.json",
                                                       "nul", "con", "prn", "aux",
                                                       "DatePicker*.tsx", "DatePicker*.jsx"))
        manifest = sorted(str(p.relative_to(workdir)).replace("\\", "/")
                          for p in workdir.rglob("*") if p.is_file())
        (workdir / "_fixture_files.json").write_text(json.dumps(manifest), encoding="utf-8")
    for fn, content in task.get("seed", {}).items():
        _write(workdir / fn, content)
    if task.get("fixture") or task.get("diff"): _git_snapshot(workdir)  # baseline commit -> diff the agent's changes
    cmd = _arm_cmd(arm, task["prompt"], model)
    # Beside the workspace while the agent runs, so it cannot read its own log (with an arm's rules in it).
    log, err = workdir.parent / f"{workdir.name}.stream.jsonl", workdir.parent / f"{workdir.name}.stderr.txt"
    # stdout -> file, never a PIPE: on Windows a hung agent's child processes can hold a stdout PIPE
    # open forever, so subprocess.run(timeout=) never fires and the worker freezes. Writing to a file
    # lets proc.wait(timeout) return reliably; on timeout _tree_kill ends ONLY this cell's process
    # tree -- never a blanket kill, which would also take down this Claude Code session.
    with open(log, "wb") as so, open(err, "wb") as se:
        proc = subprocess.Popen(cmd, cwd=str(workdir), stdout=so, stderr=se, env=CELL_ENV,
                                start_new_session=(os.name != "nt"))
        try:
            proc.wait(timeout=CELL_TIMEOUT)
        except subprocess.TimeoutExpired:
            _tree_kill(proc)
            try: proc.wait(timeout=15)
            except Exception: pass
            se.write(f"\n[KILLED after {CELL_TIMEOUT}s timeout]".encode())
    _keep_result(log, workdir)
    shutil.move(str(log), str(workdir / "_claude.stream.jsonl"))
    shutil.move(str(err), str(workdir / "_claude.stderr.txt"))

def _with_retries(run, wait=time.sleep):
    """Run a cell, retrying with backoff while its session fails: a rate limit is not the arm's fault."""
    for pause in (*RETRY_WAITS, None):
        res = run()
        if not res.get("infra") or pause is None: return res
        wait(pause)

def aggregate(results):
    groups = defaultdict(list)
    for r in results: groups[(r["task"], r["arm"], r["model"])].append(r)
    rows = []
    for (t, a, m), all_cells in sorted(groups.items()):
        cells = [c for c in all_cells if not c.get("infra")]   # a failed session says nothing about the arm
        n = len(cells)
        if not n:
            rows.append({"task": t, "arm": a, "model": m, "n": 0, "infra": len(all_cells), "timeouts": 0, "safe_rate": 0,
                         "correct_rate": 0, "wrote_file_rate": 0, "total_loc_median": 0, "src_loc_median": 0, "total_loc_max": 0,
                         "src_files_median": 0, "wrote_tests_rate": 0, "cost_mean": None, "cost_per_pass": None,
                         "reply_words_median": None, "out_tokens_mean": None, "total_tokens_mean": None, "time_s_mean": None})
            continue
        costs = [c["cost"] for c in cells if c.get("cost") is not None]
        passes = sum(1 for c in cells if c.get("correct") and c.get("safe"))
        words = [c["reply_words"] for c in cells if c.get("reply_words") is not None]
        loc_cells = [c for c in cells if c.get("total_loc", 0) > 0]   # LOC only where code was delivered
        nl = len(loc_cells)
        rows.append({"task": t, "arm": a, "model": m, "n": n,
                     "infra": len(all_cells) - n, "timeouts": sum(1 for c in cells if c.get("timed_out")),
                     # a crashed cell has only "error": count it as failed instead of crashing the summary
                     "safe_rate": round(sum(c.get("safe") or 0 for c in cells) / n, 3),
                     "correct_rate": round(sum(c.get("correct") or 0 for c in cells) / n, 3),
                     "wrote_file_rate": round(nl / n, 3),
                     "total_loc_median": statistics.median(c["total_loc"] for c in loc_cells) if nl else 0,
                     "src_loc_median": statistics.median(c["src_loc"] for c in loc_cells) if nl else 0,
                     "total_loc_max": max((c["total_loc"] for c in loc_cells), default=0),
                     "src_files_median": statistics.median(c["src_files"] for c in loc_cells) if nl else 0,
                     "wrote_tests_rate": round(sum(1 for c in cells if c.get("test_files", 0) > 0) / n, 3),
                     "cost_mean": round(statistics.mean(costs), 4) if costs else None,
                     # what a finished task costs: all spend over the cells that passed both gates.
                     # A killed session reports no cost, so with one in the group the figure would flatter the arm.
                     "cost_per_pass": round(sum(costs) / passes, 4) if costs and passes and len(costs) == n else None,
                     "reply_words_median": statistics.median(words) if words else None,
                     "out_tokens_mean": (round(statistics.mean([c["out_tokens"] for c in cells if c.get("out_tokens") is not None]))
                                         if any(c.get("out_tokens") is not None for c in cells) else None),
                     "total_tokens_mean": (round(statistics.mean([(c.get("in_tokens") or 0) + (c.get("out_tokens") or 0) + (c.get("cache_tokens") or 0)
                                                                   for c in cells if c.get("out_tokens") is not None]))
                                           if any(c.get("out_tokens") is not None for c in cells) else None),
                     "time_s_mean": (round(statistics.mean([c["duration_ms"] / 1000 for c in cells if c.get("duration_ms") is not None]), 1)
                                     if any(c.get("duration_ms") is not None for c in cells) else None)})
    return rows

def print_table(rows):
    by = defaultdict(list)
    for r in rows: by[(r["task"], r["model"])].append(r)
    for (task, model), rs in sorted(by.items()):
        print(f"\n=== {task}  ({model}, n={rs[0]['n']}) ===")
        print(f"  {'arm':16} {'wrote%':>7} {'correct':>8} {'safe':>5} {'LOC':>7} {'tot_tok':>9} {'$/run':>8} {'$/pass':>8} {'words':>6} {'time_s':>7} {'killed':>6} {'failed':>6}")
        for r in sorted(rs, key=lambda x: x["arm"]):
            c = ("$" + format(r["cost_mean"], ".4f")) if r["cost_mean"] is not None else "-"
            tt = r.get("total_tokens_mean"); t = r.get("time_s_mean")
            cp = ("$" + format(r["cost_per_pass"], ".4f")) if r.get("cost_per_pass") is not None else "-"
            w = r.get("reply_words_median")
            print(f"  {r['arm']:16} {r.get('wrote_file_rate', 1.0):>7} {r['correct_rate']:>8} {r['safe_rate']:>5} "
                  f"{r['total_loc_median']:>7} {(tt if tt is not None else '-'):>9} {c:>8} {cp:>8} "
                  f"{(w if w is not None else '-'):>6} {(t if t is not None else '-'):>7} {r['timeouts']:>6} {r['infra']:>6}")

def rescore(run_dir):
    run_dir = Path(run_dir)
    if not run_dir.exists():                     # accept "<stamp>" or "runs/<stamp>" from any cwd
        run_dir = RUNS_DIR / run_dir.name
    results = []
    for ws in sorted(p for p in run_dir.iterdir() if p.is_dir()):
        parts = ws.name.split("__")
        if len(parts) != 4 or parts[0] not in TASKS: continue
        tid, arm, model, _r = parts
        results.append(score_isolated(tid, arm, model, ws))
    rows = aggregate(results)
    (run_dir / "results.json").write_text(json.dumps({"rescored": True, "results": results}, indent=2), encoding="utf-8")
    (run_dir / "summary.json").write_text(json.dumps(rows, indent=2), encoding="utf-8")
    print_table(rows)
    print(f"\nrescored {len(results)} cells from {run_dir}")

def _claude_version():
    try: return subprocess.run([shutil.which("claude"), "--version"], capture_output=True, text=True).stdout.strip()
    except Exception: return "unknown"

def main():
    global CELL_TIMEOUT
    ap = argparse.ArgumentParser()
    ap.add_argument("--selftest", action="store_true")
    ap.add_argument("--score-cell", nargs=3, metavar=("TASK", "ARM", "MODEL"), help=argparse.SUPPRESS)   # scores the cwd
    ap.add_argument("--rescore", help="recompute metrics from a kept run dir (no API)")
    ap.add_argument("--resume", help="kept run dir: run only its unfinished or failed cells, with the same sources")
    ap.add_argument("--timeout", type=int, default=CELL_TIMEOUT, help=f"seconds per cell (default {CELL_TIMEOUT})")
    ap.add_argument("--task", help="single task id")
    ap.add_argument("--all", action="store_true", help="all tasks")
    ap.add_argument("--arms", default=",".join(ARMS))
    ap.add_argument("--model", help="single model (shorthand for --models)")
    ap.add_argument("--models", default="haiku", help="comma list: haiku,sonnet,opus")
    ap.add_argument("--runs", type=int, default=1)
    ap.add_argument("--workers", type=int, default=4, help="cells to run concurrently (default 4; cells are fully isolated)")
    args = ap.parse_args()
    CELL_TIMEOUT = args.timeout

    if args.score_cell:
        tid, arm, model = args.score_cell
        ws = Path.cwd()
        return (ws / "_score.json").write_text(json.dumps(score_workspace(tid, arm, model, ws)), encoding="utf-8")
    if args.selftest:
        sys.exit(1 if selftest() else 0)
    if args.rescore:
        return rescore(args.rescore)
    if selftest():
        sys.exit("instruments broken; refusing to spend on the API")

    task_ids = (list(TASKS) if args.all else QUICK if args.task == "quick"
                else ([t.strip() for t in args.task.split(",")] if args.task else []))
    if not task_ids: sys.exit("give --task <id> (comma list ok), --all, or --rescore <dir>")
    arms = [a.strip() for a in args.arms.split(",")]
    models = [m.strip() for m in (args.model or args.models).split(",")]
    claude_version = _claude_version()
    # before any spend: a bad checkout or an arm that does not activate stops the run here
    cells = [(tid, arm, model, r)
             for tid in task_ids for model in models for arm in arms for r in range(args.runs)]
    sources = {**_sources(arms, task_ids), "claude": claude_version,
               "cells": [f"{t}__{a}__{m}__{r}" for t, a, m, r in cells]}
    preflight(arms)
    results = []
    if args.resume:
        out_dir = Path(args.resume) if Path(args.resume).exists() else RUNS_DIR / Path(args.resume).name
        stamp = out_dir.name
        if json.loads((out_dir / "sources.json").read_text(encoding="utf-8")) != sources:
            sys.exit(f"the sources or cells differ from when {stamp} started, so it cannot resume; compare with sources.json")
        kept = {p.name for p in out_dir.iterdir() if p.is_dir()}
        remaining = []
        for spec in cells:
            tid, arm, model, r = spec
            res = None
            if f"{tid}__{arm}__{model}__{r}" in kept:
                res = score_isolated(tid, arm, model, out_dir / f"{tid}__{arm}__{model}__{r}")
            if res and not res.get("infra"): results.append(res)
            else: remaining.append(spec)
        print(f"resuming {stamp}: {len(results)} cells kept", flush=True)
        cells = remaining
    else:
        stamp = datetime.datetime.now().strftime("%Y%m%d-%H%M%S")
        out_dir = RUNS_DIR / stamp
        out_dir.mkdir(parents=True, exist_ok=True)
        (out_dir / "sources.json").write_text(json.dumps(sources, indent=2), encoding="utf-8")
    total = len(cells)
    done = failed_in_a_row = 0
    stopped = False

    def write_results():
        (out_dir / "results.json").write_text(json.dumps(
            {"date": stamp, "models": {m: MODELS.get(m, m) for m in models}, "cell_timeout": CELL_TIMEOUT,
             "claude": claude_version, "results": results}, indent=2), encoding="utf-8")

    # Cells run outside any git repo, then move into out_dir. Inside a repo, Claude Code shows the
    # model that repo's branch and recent commit messages, so this repo's own history leaked into
    # every task without its own git snapshot.
    scratch = Path(tempfile.mkdtemp(prefix=f"puritanical-bench-{stamp}-"))

    def _one(spec):
        tid, arm, model, r = spec
        name = f"{tid}__{arm}__{model}__{r}"
        ws = scratch / name
        def attempt():
            shutil.rmtree(ws, ignore_errors=True)
            ws.mkdir(parents=True)
            try:
                run_session(tid, arm, model, ws)
            finally:                                            # kept whatever happens: the session is paid for
                shutil.rmtree(out_dir / name, ignore_errors=True)   # a failed cell from an earlier attempt
                shutil.move(str(ws), str(out_dir / name))
            return score_isolated(tid, arm, model, out_dir / name)
        return _with_retries(attempt)

    if cells:
        for m in models:
            for arm in arms: warm_cache(arm, m)
    print(f"running {total} cells, {args.workers} at a time", flush=True)
    # Cells are fully isolated (own copy + own claude context), so they parallelize safely.
    # To STOP a parallel run, kill the whole tree: taskkill /PID <pid> /T /F. Killing just the
    # python orchestrator orphans the concurrent `claude` children and they keep spending.
    with concurrent.futures.ThreadPoolExecutor(max_workers=args.workers) as ex:
        futs = {ex.submit(_one, s): s for s in cells}
        for fut in concurrent.futures.as_completed(futs):
            tid, arm, model, r = futs[fut]
            try:
                res = fut.result()
            except Exception as e:                      # the harness broke, not the arm
                res = {"task": tid, "arm": arm, "model": model, "infra": True, "error": str(e)[:200]}
            results.append(res)
            done += 1
            print(f"  [{done}/{total}] {tid} / {arm} / {model} #{r}  "
                  f"LOC={res.get('total_loc')} "
                  f"tok={(res.get('in_tokens') or 0) + (res.get('out_tokens') or 0) + (res.get('cache_tokens') or 0)} "
                  f"cost=${res.get('cost')} time={round((res.get('duration_ms') or 0) / 1000, 1)}s "
                  f"correct={res.get('correct')}"
                  + (f" SESSION FAILED: {res.get('infra_reason') or res.get('error')}" if res.get("infra") else ""), flush=True)
            write_results()
            failed_in_a_row = failed_in_a_row + 1 if res.get("infra") else 0
            if failed_in_a_row >= MAX_FAILED_IN_A_ROW:
                stopped = True
                ex.shutdown(wait=False, cancel_futures=True)
                break

    write_results()
    shutil.rmtree(scratch, ignore_errors=True)
    rows = aggregate(results)
    (out_dir / "summary.json").write_text(json.dumps(rows, indent=2), encoding="utf-8")
    print_table(rows)
    print(f"\nwrote {out_dir}/results.json + summary.json ({len(results)} cells)")
    failed = sum(1 for c in results if c.get("infra"))
    if stopped or failed:
        sys.exit(f"{'stopped early: ' if stopped else ''}{failed} cells failed with session errors; "
                 f"rerun the same command with --resume {out_dir} to finish them")

if __name__ == "__main__":
    main()
