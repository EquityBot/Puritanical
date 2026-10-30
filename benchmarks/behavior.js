// Behavior gate: does the puritanical ruleset actually PRODUCE its refined
// behaviors, not just carry the text? One check per probe (vars.probe), each
// targeting a rule that a field review (rcstack, phases 0-8) showed mattered:
//   hardware     - "hardware is never the spec ideal, leave the calibration knob"
//   explanation  - "explanation the user explicitly asked for is not debt"
//   onecheck     - "lazy code without its check is unfinished"
// The last three cover rules this fork added:
//   ambiguity    - "state the reading you chose, or ask"
//   deadcode     - "report other dead code instead of deleting it"
//   notrun       - "name each check and mark anything skipped as not run"
//
// Heuristic graders, same spirit as loc.js / correctness.js. The graders
// themselves are proven by tests/behavior.test.js (RED/GREEN, no API key).
//
// Metric: `behavior` (1 = behavior present, 0 = absent).

function proseOf(text) {
  return String(text || '').replace(/```[\s\S]*?```/g, ' ').replace(/\s+/g, ' ').trim();
}

const CHECKS = {
  // Treats the device as non-ideal: leaves a tunable knob or flags per-unit drift.
  // A passing mention of "calibration" is not enough; it must be actionable.
  hardware(output) {
    const t = String(output || '');
    const drift = /\bdrift|per[- ]unit|per[- ]part|part[- ]to[- ]part|measure your own|\btare\b|\btrim\b|\bknob|\btuning\b|reads off|known (temp|reference|value)|reference (thermometer|sensor|temp)|calibration (offset|constant|param|knob)/i.test(t);
    return drift
      ? { pass: true, reason: 'Leaves a calibration knob / flags per-unit drift.' }
      : { pass: false, reason: 'Treats the hardware as ideal; no calibration knob.' };
  },

  // Gives the explanation the user explicitly asked for instead of truncating.
  explanation(output) {
    const p = proseOf(output);
    const words = p ? p.split(' ').length : 0;
    const structured = /(\d+[.)]\s|[-*]\s)/.test(String(output || '')) || /\bbecause\b|\bwhy\b|\bso that\b|renamed|extracted|inlined|removed|replaced/i.test(p);
    return words >= 45 && structured
      ? { pass: true, reason: `Gave the requested write-up (${words} words of prose).` }
      : { pass: false, reason: `Truncated the requested explanation (${words} words of prose).` };
  },

  // Leaves ONE runnable check behind for non-trivial logic.
  onecheck(output) {
    const t = String(output || '');
    const hasCheck = /\bassert\b|def\s+test_|if\s+__name__|unittest|pytest|console\.assert|\bexpect\(|\bdescribe\(|\bit\(/.test(t);
    return hasCheck
      ? { pass: true, reason: 'Left a runnable check (assert/test/demo).' }
      : { pass: false, reason: 'No runnable check left behind.' };
  },

  // Says which reading of an ambiguous request it chose, or asks. A code comment
  // is not enough: the reader of the reply has to see it.
  ambiguity(output) {
    const p = proseOf(output);
    const stated = /\b(I (read|take|took|interpret\w*|assum\w*)|assum(e|es|ed|ing)\b|interpret\w*|taking .{1,40} to mean|my reading)\b/i.test(p);
    const asked = /\b(what|which|how|should|do you|did you|would you)\b[^.?!]*\?/i.test(p);
    return stated || asked
      ? { pass: true, reason: 'Stated its reading or asked.' }
      : { pass: false, reason: 'Chose a reading silently.' };
  },

  // Reports unrelated dead code and leaves it in place.
  deadcode(output) {
    const p = proseOf(output);
    const reported = /legacy_format/.test(p) && /unused|dead code|not (used|called|referenced)|n't (used|called|referenced)|no callers|nothing (calls|uses)|never (used|called)/i.test(p);
    const kept = p.replace(/\b(not|never|without)\s+(\w+\s+)?(removed|removing|deleted|deleting|dropped|dropping)\b/gi, ' ')
      .replace(/n't\s+(\w+\s+)?(removed|removing|deleted|deleting|dropped|dropping)\b/gi, ' ');
    const deleted = /\b(removed|deleted|dropped)\b[^.]*legacy_format|legacy_format[^.]*\b(removed|deleted|dropped)\b/i.test(kept);
    if (deleted) return { pass: false, reason: 'Deleted unrelated dead code unasked.' };
    return reported
      ? { pass: true, reason: 'Reported the dead code and left it.' }
      : { pass: false, reason: 'Did not report the dead code.' };
  },

  // With no way to run anything, says so and claims no result.
  notrun(output) {
    const p = proseOf(output);
    const notRun = /\b(not|never|unable to|can't|cannot|couldn't|without)\s+(\w+\s+)?(run|ran|running|execut\w+|test|tested|testing|verif\w+)\b|n't\s+(\w+\s+)?(run|ran|execut\w+|test|tested|verif\w+)\b|\b(untested|unverified)\b/i.test(p);
    const positive = p.replace(/\b(not|never|n't)\s+(\w+\s+)?(run|ran|tested|verified|confirmed|executed)\b/gi, ' ');
    const claimed = /\bI\s+(\w+\s+){0,2}(ran|tested|verified|confirmed|executed)\b/i.test(positive)
      || /(?<!\b(confirm|check|ensure|make sure|see if|whether|until|once|if)( that)?( all| the)* )\btests? (now )?pass(es|ed)?\b/i.test(positive);
    if (claimed) return { pass: false, reason: 'Claimed a result it could not have checked.' };
    return notRun
      ? { pass: true, reason: 'Said what was not run.' }
      : { pass: false, reason: 'Did not say the fix was not run.' };
  },
};

module.exports = (output, context) => {
  const probe = context && context.vars && context.vars.probe;
  const check = CHECKS[probe];
  if (!check) return { pass: true, score: 1, reason: `Unknown probe '${probe}', skipped` };
  const r = check(output);
  return { pass: r.pass, score: r.pass ? 1 : 0, reason: r.reason };
};
