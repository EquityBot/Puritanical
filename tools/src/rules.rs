//! Every shipped copy of the rules, generated from `skills/*/SKILL.md`.
//!
//! Hosts that cannot read a skill get the same text as `AGENTS.md`, a rule
//! file, a command prompt, an `OpenClaw` skill or a fallback string. Edit the
//! skill, then run `sync`; CI runs `sync --check`.

use std::fs;
use std::path::Path;

pub const SKILLS: [&str; 5] = [
    "puritanical",
    "puritanical-review",
    "puritanical-audit",
    "puritanical-debt",
    "puritanical-help",
];

const RULE_COPIES: [&str; 7] = [
    ".cursor/rules/puritanical.mdc",
    ".windsurf/rules/puritanical.md",
    ".clinerules/puritanical.md",
    ".agents/rules/puritanical.md",
    ".qoder/rules/puritanical.md",
    ".github/copilot-instructions.md",
    ".kiro/steering/puritanical.md",
];

const SWITCH_TOML: &str =
    "Switch to puritanical {{args}} mode. Keep the current level when no level is named.\n\n";
const SWITCH_OPENCODE: &str =
    "\nSwitch to puritanical $ARGUMENTS mode. Keep the current level when no level is named.\n\n";

const HOMEPAGE: &str = "https://github.com/ryanduguid/Puritanical";

/// `OpenClaw` needs a one-line description under 160 characters, shorter than
/// the skill pickers' descriptions in `skills/`.
const OPENCLAW_DESCRIPTIONS: [(&str, &str); 5] = [
    (
        "puritanical",
        "Strict simplicity for coding tasks: correctness, safety and verification first, then the smallest change that meets every requirement.",
    ),
    (
        "puritanical-review",
        "Quality review of a diff: bugs, security, real load, missing tests, speed, and what to delete. Each finding says what goes wrong and how to fix it.",
    ),
    (
        "puritanical-audit",
        "Quality audit of the whole repo: bugs, security, real load, missing tests, speed, and what to delete. Most important first.",
    ),
    (
        "puritanical-debt",
        "Harvest every shortcut: comment into one debt ledger, so deferrals get tracked instead of forgotten. One-shot report.",
    ),
    (
        "puritanical-help",
        "Quick reference for puritanical's modes, skills, and commands. One-shot display.",
    ),
];

/// Load-bearing rules that any rewording of the core skill must keep. Changing
/// one is a deliberate policy change: update this list with it. Matched with
/// whitespace collapsed, so a rule may wrap across lines.
const INVARIANTS: [&str; 9] = [
    "in this codebase",
    "inspect their callers",
    "Complete explicit requirements",
    "with a `shortcut:` comment",
    "semantics, failure modes",
    "There is no one-test ceiling",
    // The never-cut sentence is pinned whole: its words also appear elsewhere
    // in the skill, so checking them one by one passed when one was dropped here.
    "Preserve input validation at trust boundaries, security, accessibility, \
     error handling that prevents data loss, and required hardware calibration.",
    "fails without the fix",
    "not run",
];

fn read(root: &Path, rel: &str) -> Result<String, String> {
    fs::read_to_string(root.join(rel))
        .map(|s| s.replace("\r\n", "\n"))
        .map_err(|e| format!("{rel}: {e}"))
}

/// Length of a leading `---\n ... \n---` block, plus its closing newline when
/// `newline` is required or present.
fn frontmatter_len(text: &str, newline_required: bool) -> Option<usize> {
    if !text.starts_with("---\n") {
        return None;
    }
    let close = if newline_required { "\n---\n" } else { "\n---" };
    let at = text.get(4..)?.find(close)? + 4 + close.len();
    let optional_newline = usize::from(!newline_required && text[at..].starts_with('\n'));
    Some(at + optional_newline)
}

fn frontmatter(text: &str) -> &str {
    &text[..frontmatter_len(text, true).unwrap_or(0)]
}

/// A skill body without frontmatter, trimmed, with one closing newline.
fn body(root: &Path, name: &str) -> Result<String, String> {
    let text = read(root, &format!("skills/{name}/SKILL.md"))?;
    let start = frontmatter_len(&text, true).unwrap_or(0);
    Ok(format!("{}\n", text[start..].trim()))
}

fn openclaw_source_body(root: &Path, name: &str) -> Result<String, String> {
    let rel = format!("skills/{name}/SKILL.md");
    let text = read(root, &rel)?;
    let start = frontmatter_len(&text, false).ok_or(format!("{rel} has no frontmatter"))?;
    Ok(text[start..].to_string())
}

fn openclaw_render(root: &Path, name: &str) -> Result<String, String> {
    let (_, desc) = OPENCLAW_DESCRIPTIONS
        .iter()
        .find(|(n, _)| *n == name)
        .ok_or(format!("no OpenClaw description for {name}"))?;
    if desc.chars().count() > 160 || desc.contains('\n') || desc.contains('"') {
        return Err(format!(
            "description for {name} must be one line, no quotes, under 160 chars"
        ));
    }
    let manual = if name == "puritanical" {
        ""
    } else {
        "disable-model-invocation: true\n"
    };
    Ok(format!(
        "---\nname: {name}\n{manual}description: \"{desc}\"\nhomepage: {HOMEPAGE}\nlicense: MIT\n---\n{}",
        openclaw_source_body(root, name)?
    ))
}

/// Replace the first line that starts with `prefix` (and ends with `suffix`).
fn replace_line(
    text: &str,
    prefix: &str,
    suffix: &str,
    line: &str,
    rel: &str,
) -> Result<String, String> {
    let mut start = 0;
    for current in text.split_inclusive('\n') {
        let content = current.strip_suffix('\n').unwrap_or(current);
        if content.starts_with(prefix) && content.ends_with(suffix) {
            return Ok(format!(
                "{}{line}{}",
                &text[..start],
                &text[start + content.len()..]
            ));
        }
        start += current.len();
    }
    Err(format!("{rel}: no line starts with {prefix:?}"))
}

/// A JSON string literal, which is also a valid TOML and Python string.
fn quoted(text: &str) -> String {
    serde_json::to_string(text).expect("a str always serialises")
}

/// Every generated file, as (path, expected content).
pub fn render(root: &Path) -> Result<Vec<(String, String)>, String> {
    let core = body(root, "puritanical")?;
    let mut out = vec![("AGENTS.md".to_string(), core.clone())];
    for rel in RULE_COPIES {
        let current = read(root, rel)?;
        let head = frontmatter(&current);
        let text = if head.is_empty() {
            core.clone()
        } else {
            format!("{head}\n{core}")
        };
        out.push((rel.to_string(), text));
    }
    for name in SKILLS {
        let text = body(root, name)?;
        let core_skill = name == "puritanical";
        let toml = format!("commands/{name}.toml");
        let prompt = format!("{}{text}", if core_skill { SWITCH_TOML } else { "" });
        let toml_text = replace_line(
            &read(root, &toml)?,
            "prompt = ",
            "",
            &format!("prompt = {}", quoted(&prompt)),
            &toml,
        )?;
        out.push((toml, toml_text));
        let md = format!(".opencode/command/{name}.md");
        let switch = if core_skill { SWITCH_OPENCODE } else { "\n" };
        let md_text = format!("{}{switch}{text}", frontmatter(&read(root, &md)?));
        out.push((md, md_text));
        out.push((
            format!(".openclaw/skills/{name}/SKILL.md"),
            openclaw_render(root, name)?,
        ));
    }
    let js = "hooks/puritanical-instructions.js";
    let js_line = format!("const FALLBACK_SKILL_BODY = {};", quoted(&core));
    out.push((
        js.into(),
        replace_line(
            &read(root, js)?,
            "const FALLBACK_SKILL_BODY = ",
            ";",
            &js_line,
            js,
        )?,
    ));
    let py = "__init__.py";
    let py_line = format!("_FALLBACK_SKILL_BODY = {}", quoted(&core));
    out.push((
        py.into(),
        replace_line(
            &read(root, py)?,
            "_FALLBACK_SKILL_BODY = ",
            "",
            &py_line,
            py,
        )?,
    ));
    Ok(out)
}

fn missing_invariants(root: &Path) -> Result<Vec<&'static str>, String> {
    let skill = read(root, "skills/puritanical/SKILL.md")?;
    let skill = skill.split_whitespace().collect::<Vec<_>>().join(" ");
    Ok(INVARIANTS
        .into_iter()
        .filter(|p| !skill.contains(p))
        .collect())
}

/// Refuse a generated path that passes through a symlink (or a Windows
/// junction), so a link planted in the checkout cannot redirect a write.
/// shortcut: checked before writing, not atomically; enough for a committed
/// link, not for a process racing the sync.
fn no_links(root: &Path, rel: &str) -> Result<(), String> {
    let mut path = root.to_path_buf();
    for part in Path::new(rel).components() {
        path.push(part);
        match fs::symlink_metadata(&path) {
            Ok(meta) if meta.file_type().is_symlink() => {
                return Err(format!(
                    "{rel}: refusing to follow the link at {}",
                    path.display()
                ));
            }
            Ok(_) => {}
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => break,
            Err(e) => return Err(format!("{rel}: {e}")),
        }
    }
    Ok(())
}

/// Write the copies, or with `check` report stale copies and missing invariants.
pub fn sync(root: &Path, check: bool) -> Result<String, String> {
    let missing = missing_invariants(root)?;
    if !missing.is_empty() {
        return Err(format!(
            "skills/puritanical/SKILL.md is missing rule invariants: {missing:?}"
        ));
    }
    let mut stale = Vec::new();
    for (rel, text) in render(root)? {
        no_links(root, &rel)?;
        let file = root.join(&rel);
        let current = fs::read_to_string(&file)
            .ok()
            .map(|s| s.replace("\r\n", "\n"));
        if current.as_deref() == Some(text.as_str()) {
            continue;
        }
        if !check {
            if let Some(dir) = file.parent() {
                fs::create_dir_all(dir).map_err(|e| format!("{rel}: {e}"))?;
            }
            fs::write(&file, &text).map_err(|e| format!("{rel}: {e}"))?;
        }
        stale.push(rel);
    }
    match (check, stale.is_empty()) {
        (true, false) => Err(format!(
            "Stale rule copies (run puritanical-tools sync):\n  {}",
            stale.join("\n  ")
        )),
        (false, false) => Ok(format!("Rewrote {} rule copies.", stale.len())),
        _ => Ok(format!(
            "All rule copies match skills/; {} rule invariants present.",
            INVARIANTS.len()
        )),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn repo() -> std::path::PathBuf {
        Path::new(env!("CARGO_MANIFEST_DIR")).join("..")
    }

    #[test]
    fn committed_copies_match_the_skills() {
        sync(&repo(), true).unwrap();
    }

    #[test]
    fn frontmatter_needs_a_closing_fence() {
        assert_eq!(frontmatter("---\na: 1\n---\nbody"), "---\na: 1\n---\n");
        assert_eq!(frontmatter("no frontmatter\n---\n"), "");
        assert_eq!(frontmatter("---\nunclosed"), "");
        // OpenClaw reads a fence at end of file without a newline too.
        assert_eq!(frontmatter_len("---\na: 1\n---", false), Some(12));
    }

    #[test]
    fn replace_line_keeps_the_other_lines() {
        let text = "description = \"d\"\nprompt = \"old\"\nprompt = \"second\"\n";
        let out = replace_line(text, "prompt = ", "", "prompt = \"new\"", "x").unwrap();
        assert_eq!(
            out,
            "description = \"d\"\nprompt = \"new\"\nprompt = \"second\"\n"
        );
        assert!(replace_line(text, "missing = ", "", "", "x").is_err());
        assert!(replace_line("const A = 1\n", "const A = ", ";", "", "x").is_err());
    }

    #[test]
    fn quoted_strings_escape_like_json_stringify() {
        assert_eq!(
            quoted("a \"b\"\n\t\\ — \u{1}"),
            "\"a \\\"b\\\"\\n\\t\\\\ — \\u0001\""
        );
    }

    #[test]
    fn openclaw_descriptions_fit_one_line() {
        for (name, desc) in OPENCLAW_DESCRIPTIONS {
            assert!(SKILLS.contains(&name));
            assert!(
                desc.chars().count() <= 160 && !desc.contains('\n'),
                "{name}"
            );
        }
    }

    /// A temporary copy of the skills and every generated file.
    fn copy_repo() -> tempfile::TempDir {
        let dir = tempfile::tempdir().unwrap();
        for (rel, _) in render(&repo()).unwrap() {
            let dest = dir.path().join(&rel);
            fs::create_dir_all(dest.parent().unwrap()).unwrap();
            fs::copy(repo().join(&rel), dest).unwrap();
        }
        for name in SKILLS {
            let rel = format!("skills/{name}/SKILL.md");
            fs::create_dir_all(dir.path().join(format!("skills/{name}"))).unwrap();
            fs::copy(repo().join(&rel), dir.path().join(&rel)).unwrap();
        }
        dir
    }

    #[test]
    fn a_stale_copy_fails_the_check_and_sync_repairs_it() {
        let dir = copy_repo();
        fs::write(dir.path().join("AGENTS.md"), "drifted\n").unwrap();
        let err = sync(dir.path(), true).unwrap_err();
        assert!(err.contains("AGENTS.md"), "{err}");
        assert_eq!(sync(dir.path(), false).unwrap(), "Rewrote 1 rule copies.");
        sync(dir.path(), true).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn sync_refuses_to_write_through_a_planted_link() {
        let dir = copy_repo();
        let outside = tempfile::tempdir().unwrap();
        let sentinel = outside.path().join("sentinel");
        fs::write(&sentinel, "keep\n").unwrap();
        fs::remove_file(dir.path().join("AGENTS.md")).unwrap();
        std::os::unix::fs::symlink(&sentinel, dir.path().join("AGENTS.md")).unwrap();
        for check in [true, false] {
            let err = sync(dir.path(), check).unwrap_err();
            assert!(err.contains("refusing to follow"), "{err}");
        }
        let ruleset = dir.path().join(".cursor/rules");
        fs::rename(&ruleset, outside.path().join("rules")).unwrap();
        std::os::unix::fs::symlink(outside.path().join("rules"), &ruleset).unwrap();
        fs::remove_file(dir.path().join("AGENTS.md")).unwrap();
        fs::copy(repo().join("AGENTS.md"), dir.path().join("AGENTS.md")).unwrap();
        let err = sync(dir.path(), false).unwrap_err();
        assert!(err.contains(".cursor/rules"), "{err}");
        assert_eq!(fs::read_to_string(&sentinel).unwrap(), "keep\n");
    }

    /// Each protection dropped from the never-cut sentence must fail the check,
    /// even where the same word survives elsewhere in the skill.
    #[test]
    fn dropping_a_protection_from_the_never_cut_sentence_fails_the_check() {
        let skill = read(&repo(), "skills/puritanical/SKILL.md").unwrap();
        for (from, to, survivor) in [
            (
                "boundaries, security, accessibility,",
                "boundaries, accessibility,",
                "security",
            ),
            (
                "boundaries, security, accessibility,",
                "boundaries, security,",
                "accessibility",
            ),
            (
                "data loss, and required hardware",
                "data loss, and",
                "hardware",
            ),
            (
                "validation at trust boundaries, security",
                "validation, security",
                "trust boundaries",
            ),
        ] {
            let mutated = skill.replacen(from, to, 1);
            assert_ne!(mutated, skill, "mutation {from:?} must apply");
            let dir = tempfile::tempdir().unwrap();
            fs::create_dir_all(dir.path().join("skills/puritanical")).unwrap();
            fs::write(dir.path().join("skills/puritanical/SKILL.md"), &mutated).unwrap();
            let missing = missing_invariants(dir.path()).unwrap();
            assert!(
                !missing.is_empty(),
                "dropping {survivor:?} passed the check"
            );
        }
    }

    #[test]
    fn a_dropped_invariant_fails_the_check() {
        let dir = tempfile::tempdir().unwrap();
        fs::create_dir_all(dir.path().join("skills/puritanical")).unwrap();
        fs::write(
            dir.path().join("skills/puritanical/SKILL.md"),
            "---\nname: x\n---\n# Puritanical\n",
        )
        .unwrap();
        let err = sync(dir.path(), true).unwrap_err();
        assert!(err.contains("validation at trust boundaries"), "{err}");
    }
}
