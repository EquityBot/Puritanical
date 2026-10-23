#!/usr/bin/env node
// Write every shipped copy of the rules from skills/*/SKILL.md, the single source.
// Hosts that cannot read a skill get the same text as AGENTS.md, a rule file,
// a command prompt or a fallback string, so an edit used to mean a dozen hand
// copies. Edit the skill, then run:
//
//   node scripts/sync-rules.js           # rewrite the copies
//   node scripts/sync-rules.js --check   # exit 1 if any copy is stale (CI)

const fs = require('fs');
const path = require('path');
const openclaw = require('./build-openclaw-skills');

const ROOT = path.join(__dirname, '..');
const SKILLS = ['puritanical', 'puritanical-review', 'puritanical-audit', 'puritanical-debt', 'puritanical-help'];
const RULE_COPIES = [
  '.cursor/rules/puritanical.mdc',
  '.windsurf/rules/puritanical.md',
  '.clinerules/puritanical.md',
  '.agents/rules/puritanical.md',
  '.qoder/rules/puritanical.md',
  '.github/copilot-instructions.md',
  '.kiro/steering/puritanical.md',
];
const SWITCH = {
  toml: 'Switch to puritanical {{args}} mode. Keep the current level when no level is named.\n\n',
  opencode: '\nSwitch to puritanical $ARGUMENTS mode. Keep the current level when no level is named.\n\n',
};
const FRONTMATTER = /^---\n[\s\S]*?\n---\n/;

const read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n');
const body = name => read(`skills/${name}/SKILL.md`).replace(FRONTMATTER, '').trim() + '\n';
const frontmatter = text => (text.match(FRONTMATTER) || [''])[0];

function replaceLine(text, pattern, line, rel) {
  if (!pattern.test(text)) throw new Error(`${rel}: no line matches ${pattern}`);
  return text.replace(pattern, () => line);
}

// Every generated file, as { path: expected content }.
function render() {
  const core = body('puritanical');
  const out = { 'AGENTS.md': core };
  for (const rel of RULE_COPIES) {
    const head = frontmatter(read(rel));
    out[rel] = head ? head + '\n' + core : core;
  }
  for (const name of SKILLS) {
    const text = body(name);
    const prefix = name === 'puritanical';
    const toml = `commands/${name}.toml`;
    out[toml] = replaceLine(read(toml), /^prompt = .*$/m,
      'prompt = ' + JSON.stringify((prefix ? SWITCH.toml : '') + text), toml);
    const md = `.opencode/command/${name}.md`;
    out[md] = frontmatter(read(md)) + (prefix ? SWITCH.opencode : '\n') + text;
    out[path.relative(ROOT, openclaw.outPath(name)).replace(/\\/g, '/')] = openclaw.render(name);
  }
  const js = 'hooks/puritanical-instructions.js';
  out[js] = replaceLine(read(js), /^const FALLBACK_SKILL_BODY = .*;$/m,
    `const FALLBACK_SKILL_BODY = ${JSON.stringify(core)};`, js);
  const py = '__init__.py';
  out[py] = replaceLine(read(py), /^_FALLBACK_SKILL_BODY = .*$/m,
    `_FALLBACK_SKILL_BODY = ${JSON.stringify(core)}`, py);
  return out;
}

module.exports = { render, RULE_COPIES };

if (require.main === module) {
  const check = process.argv.includes('--check');
  const stale = [];
  for (const [rel, text] of Object.entries(render())) {
    const file = path.join(ROOT, rel);
    const current = fs.existsSync(file) ? fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n') : null;
    if (current === text) continue;
    stale.push(rel);
    if (!check) {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, text);
    }
  }
  if (check && stale.length) {
    console.error(`Stale rule copies (run node scripts/sync-rules.js):\n  ${stale.join('\n  ')}`);
    process.exit(1);
  }
  console.log(stale.length ? `Rewrote ${stale.length} rule copies.` : 'All rule copies match skills/.');
}
