#!/usr/bin/env python3
"""Paired arm comparison over tasks, with a sign test. No API calls.

  python compare.py runs/<full> [runs/<quick> ...] --a puritanical --b baseline,ponytail,karpathy

Every run dir's results.json (and answer.json, completeness.json and judge.json, where those passes
ran) is merged. Each task is one pair: the per-task median (or rate) of arm A against arm B. Ties
are dropped and the sign test asks whether B wins on more tasks than chance allows. Pair a
candidate's quick run with the full run's reference arms, so iterating on the ruleset only pays for
the candidate's cells.

The primary metrics are the ones the README's analysis plan fixes in advance, each on its own tasks.
Their p values are Bonferroni-adjusted across every primary test in the call. All other p values
are raw and exploratory.

shortcut: sign test over tasks, not a mixed model. Coarse, but honest with n=2-3 per cell.
"""
import argparse, json, math, statistics, sys, tempfile
from collections import defaultdict
from pathlib import Path

from tasks import TASKS

RUNS_DIR = Path(__file__).resolve().parent / "runs"
GATE_AT = 2      # completeness from which a cell's LOC counts: at least "mostly complete"

def _pass(c):
    if c.get("infra"): return None                     # a failed session says nothing about the arm
    if "correct" in c: return int(bool(c["correct"] and c["safe"]))
    return 0 if "error" in c else None                 # a crash fails; judge-only rows have no verdict

def _loc_gated(c):
    """LOC of a cell that did the job, so less code that also does less cannot win."""
    return c.get("total_loc") if (c.get("completeness") or 0) >= GATE_AT else None

# metric -> (how to read one cell, aggregate over a task's cells, True if higher is better)
METRICS = {
    "pass":      (_pass, statistics.mean, True),
    "loc_gated": (_loc_gated, statistics.median, False),
    "loc":       (lambda c: c.get("total_loc"), statistics.median, False),
    "gz_code":   (lambda c: c.get("gz_code"), statistics.median, False),
    "completeness": (lambda c: c.get("completeness"), statistics.mean, True),
    "over_eng":  (lambda c: c.get("over_engineering"), statistics.mean, False),
    "density":   (lambda c: c.get("reply_density"), statistics.median, None),
    "cost":      (lambda c: c.get("cost"), statistics.median, False),
    "out_tok":   (lambda c: c.get("out_tokens"), statistics.median, False),
    "time_s":    (lambda c: (c.get("duration_ms") or 0) / 1000 or None, statistics.median, False),
    "turns":     (lambda c: c.get("turns"), statistics.median, False),
    "words":     (lambda c: c.get("reply_words"), statistics.median, None),   # reported, not judged
    "accuracy":  (lambda c: c.get("accuracy"), statistics.mean, True),
    "coverage":  (lambda c: c.get("coverage"), statistics.mean, True),
    "clarity":   (lambda c: c.get("clarity"), statistics.mean, True),
}
# metric -> the tasks it decides on: hidden checks gate the surgical tasks, and only size and the
# completeness judge can tell anything on the open ones, where "correct" is close to always 1.
PRIMARY = {"pass": lambda t: not TASKS[t].get("open"),
           "loc_gated": lambda t: bool(TASKS[t].get("open"))}

def load(dirs):
    """Cells from results.json, with each judge's score joined to its cell, and how many scores
    matched no cell. Those stay as rows carrying only the scores; per-task aggregation skips missing values."""
    rows, unmatched = [], 0
    for d in dirs:
        d = Path(d) if Path(d).exists() else RUNS_DIR / Path(d).name
        cells = [c for c in json.loads((d / "results.json").read_text(encoding="utf-8"))["results"]
                 if "task" in c and "arm" in c]
        for c in cells: c["source"] = str(d.resolve())   # each run numbers its cells from zero
        by_cell = {c["cell"]: c for c in cells if "cell" in c}
        rows += cells
        for name in ("completeness.json", "judge.json", "answer.json"):
            if not (d / name).exists(): continue
            for score in json.loads((d / name).read_text(encoding="utf-8"))["scores"]:
                if score.get("cell") in by_cell: by_cell[score["cell"]].update({k: v for k, v in score.items() if k not in by_cell[score["cell"]]})
                else:
                    rows.append(score)
                    unmatched += 1
    return rows, unmatched

def problems(by, arms, unmatched, runs):
    """Why these results cannot support a published claim: missing cells or scores would otherwise
    quietly change the primary metrics."""
    found = [f"{unmatched} judge scores match no cell"] if unmatched else []
    for arm in arms:
        for t in TASKS:
            cells = by[(t, arm)]
            if len({(c.get("source"), c.get("cell")) for c in cells}) != runs or len(cells) != runs:   # a duplicate must not hide a missing cell
                found.append(f"{arm} / {t}: {len(cells)} cells, expected {runs} different ones")
            if any(c.get("infra") for c in cells): found.append(f"{arm} / {t}: session errors left unresolved")
            if TASKS[t].get("open") and any(c.get("completeness") is None and not c.get("infra") and not c.get("timed_out") for c in cells):
                found.append(f"{arm} / {t}: a cell has no completeness score")
    return found

def sign_p(wins, losses):
    n = wins + losses
    if n == 0: return 1.0
    k = min(wins, losses)
    return min(1.0, 2 * sum(math.comb(n, i) for i in range(k + 1)) / 2 ** n)

def agg(by, task, arm, metric):
    get, fn, _ = METRICS[metric]
    v = [x for x in (get(c) for c in by[(task, arm)]) if x is not None]
    return fn(v) if v else None

def _gated(by, task, arm):
    """The share of an arm's cells that did the job, then fewer lines in those cells. Compared in
    that order, so one tiny delivery out of five cannot beat five larger ones."""
    cells = [c for c in by[(task, arm)] if not c.get("infra")]
    done = [v for v in map(_loc_gated, cells) if v is not None]
    return (len(done) / len(cells), -statistics.median(done)) if done else (0, 0)

def tally(by, tasks, a, b, metric):
    """B's wins, losses and ties on one metric, with the median B/A ratio."""
    higher = METRICS[metric][2]
    w = l = ties = 0; ratios = []
    for t in tasks:
        if metric == "loc_gated":
            x, y = _gated(by, t, a), _gated(by, t, b)
            if x[1] and y[1]: ratios.append(y[1] / x[1])
            w += y > x; l += y < x; ties += y == x
            continue
        x, y = agg(by, t, a, metric), agg(by, t, b, metric)
        if x is None or y is None: continue
        if x: ratios.append(y / x)
        if higher is None or x == y: ties += 1; continue
        better = y > x if higher else y < x
        w += better; l += not better
    return {"wins": w, "losses": l, "ties": ties, "ratio": statistics.median(ratios) if ratios else None}

def compare(by, a, b, tasks_filter, family):
    tasks = sorted({t for t, x in by if x == b} & {t for t, x in by if x == a})
    if tasks_filter: tasks = [t for t in tasks if t in tasks_filter]
    print(f"\n{a} (A) vs {b} (B) on {len(tasks)} tasks")
    columns = ("pass", "loc", "completeness", "cost", "coverage", "clarity", "words")
    print(f"  {'task':22} " + " ".join(f"{m:>15}" for m in columns))
    for t in tasks:
        row = []
        for m in columns:
            x, y = agg(by, t, a, m), agg(by, t, b, m)
            f = lambda v: "-" if v is None else (f"{v:.3g}")
            row.append(f"{f(x):>7}>{f(y):<7}")
        print(f"  {t:22} " + " ".join(row))
    print(f"\n  {'metric':12} {'B wins':>7} {'B loses':>8} {'ties':>5} {'p':>7}   {'median B/A':>10}")
    for m, (_, _, higher) in METRICS.items():
        primary = PRIMARY.get(m)
        r = tally(by, [t for t in tasks if t in TASKS and primary(t)] if primary else tasks, a, b, m)
        p = "-" if higher is None else f"{min(1.0, sign_p(r['wins'], r['losses']) * (family if primary else 1)):.3f}"
        ratio = f"{r['ratio']:.2f}" if r["ratio"] is not None else "-"
        print(f"  {m:12} {r['wins']:>7} {r['losses']:>8} {r['ties']:>5} {p:>7}{' *' if primary else '  '} {ratio:>10}")
    print(f"  * primary: p adjusted across {family} tests. Other p values are raw and exploratory.")

def selftest():
    """No API. The primary metrics must count a crash as a failure, drop a failed session, and give
    a task to the arm whose code did the job more often before counting lines."""
    by = defaultdict(list)
    def cell(t, arm, **kw): by[(t, arm)].append({"task": t, "arm": arm, **kw})
    cell("a", "x", correct=1, safe=1); cell("a", "y", error="boom")
    cell("b", "x", correct=1, safe=1); cell("b", "y", correct=1, safe=1); cell("b", "y", infra=True)
    cell("c", "x", total_loc=50, completeness=3); cell("c", "y", total_loc=5, completeness=0)
    cell("d", "x", total_loc=50, completeness=3); cell("d", "y", total_loc=40, completeness=2)
    for _ in range(5): cell("e", "x", total_loc=40, completeness=3)
    cell("e", "y", total_loc=2, completeness=3)
    for _ in range(4): cell("e", "y", total_loc=1, completeness=0)
    passes, gated = tally(by, ["a", "b"], "x", "y", "pass"), tally(by, ["c", "d"], "x", "y", "loc_gated")
    tiny = tally(by, ["e"], "x", "y", "loc_gated")
    complete = defaultdict(list)
    t0, open_task = next(iter(TASKS)), next(t for t in TASKS if TASKS[t].get("open"))
    for t in TASKS: complete[(t, "x")] = [{"completeness": 3}]
    gaps = defaultdict(list, complete)
    gaps[(t0, "x")] = []
    gaps[(open_task, "x")] = [{}]
    found = problems(gaps, ["x"], 1, 1)
    pairs = defaultdict(list, {(t, "x"): [{"cell": f"{t}{r}", "completeness": 3} for r in (0, 1)] for t in TASKS})
    with tempfile.TemporaryDirectory() as tmp:
        runs = [Path(tmp) / n for n in ("one", "two")]
        for d in runs:
            d.mkdir()
            (d / "results.json").write_text(json.dumps({"results": [
                {"task": t, "arm": "x", "cell": t, "completeness": 3} for t in TASKS]}), encoding="utf-8")
        def merged(*dirs):
            rows, unmatched = load(dirs)
            grouped = defaultdict(list)
            for c in rows: grouped[(c["task"], c["arm"])].append(c)
            return problems(grouped, ["x"], unmatched, 2)
        separate, same_twice = merged(*runs), merged(runs[0], runs[0])
    checks = [("a crash fails and a failed session is dropped", (passes["wins"], passes["losses"], passes["ties"]) == (0, 1, 1)),
              ("LOC counts only where the job was done", (gated["wins"], gated["losses"]) == (1, 1)),
              ("one tiny delivery out of five loses to five larger ones", (tiny["wins"], tiny["losses"]) == (0, 1)),
              ("complete results have no problems", problems(complete, ["x"], 0, 1) == []),
              ("a missing cell, a missing score and an unmatched score are problems", len(found) == 3),
              ("a duplicate cell is a problem", problems(pairs, ["x"], 0, 2) == [] and
               len(problems(defaultdict(list, {**pairs, (t0, "x"): [{"cell": "c", "completeness": 3}] * 2}), ["x"], 0, 2)) == 1),
              ("separate runs may reuse cell names, but a run counts once", separate == [] and len(same_twice) == len(TASKS)),
              ("sign test", sign_p(9, 0) < 0.01 and math.isclose(sign_p(5, 5), 1.0)),
              ("primary metrics split the tasks", all(any(PRIMARY[m](t) for t in TASKS) for m in PRIMARY)
               and not any(PRIMARY["pass"](t) and PRIMARY["loc_gated"](t) for t in TASKS))]
    for name, ok in checks: print(f"{'ok ' if ok else 'XX '} compare      {name}")
    return sum(not ok for _, ok in checks)

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("runs", nargs="+")
    ap.add_argument("--a", default="puritanical")
    ap.add_argument("--b", default="puritanical2", help="comma list: A is compared with each")
    ap.add_argument("--tasks", help="comma list; default: every task both arms ran")
    ap.add_argument("--strict", type=int, metavar="RUNS",
                    help="exit unless every arm has all tasks at RUNS cells each, with every score joined")
    args = ap.parse_args()
    by = defaultdict(list)
    rows, unmatched = load(args.runs)
    for c in rows: by[(c["task"], c["arm"])].append(c)
    arms = args.b.split(",")
    if args.strict:
        found = problems(by, [args.a, *arms], unmatched, args.strict)
        if found: sys.exit("not ready to publish:\n  " + "\n  ".join(found))
    for b in arms:
        compare(by, args.a, b, args.tasks and args.tasks.split(","), len(arms) * len(PRIMARY))

if __name__ == "__main__":
    main()
