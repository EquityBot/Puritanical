//! Publish the generated `OpenClaw` skills (`.openclaw/skills/`) to `ClawHub`.
//!
//! `ClawHub` does not sync from GitHub: each skill is pushed with the clawhub
//! CLI and carries its own version, taken here from package.json so it tracks
//! the repository. Run `clawhub login` once first. Extra arguments, such as
//! `--dry-run`, pass through to `clawhub skill publish`.

use std::path::Path;
use std::process::Command;

fn package_version(root: &Path) -> Result<String, String> {
    let raw = std::fs::read_to_string(root.join("package.json"))
        .map_err(|e| format!("package.json: {e}"))?;
    let json: serde_json::Value = serde_json::from_str(raw.trim_start_matches('\u{feff}'))
        .map_err(|e| format!("package.json: {e}"))?;
    json.get("version")
        .and_then(|v| v.as_str())
        .map(str::to_string)
        .ok_or_else(|| "package.json has no version".into())
}

/// Every generated skill directory with a SKILL.md, sorted.
fn slugs(root: &Path) -> Result<Vec<String>, String> {
    let mut out = Vec::new();
    for entry in std::fs::read_dir(root.join(".openclaw/skills"))
        .map_err(|e| format!(".openclaw/skills: {e}"))?
    {
        let entry = entry.map_err(|e| format!(".openclaw/skills: {e}"))?;
        if entry.path().join("SKILL.md").is_file() {
            out.push(
                entry
                    .file_name()
                    .into_string()
                    .map_err(|n| format!(".openclaw/skills: non-UTF-8 name {n:?}"))?,
            );
        }
    }
    out.sort();
    Ok(out)
}

/// Publish only the complete set, so a partial tree cannot pass as a release.
fn expected_slugs(found: &[String]) -> Result<(), String> {
    let mut expected: Vec<String> = crate::rules::SKILLS.map(String::from).to_vec();
    expected.sort();
    if found == expected {
        Ok(())
    } else {
        Err(format!(
            ".openclaw/skills has {found:?}, expected {expected:?}; run puritanical-tools sync first."
        ))
    }
}

/// "puritanical-review" becomes "Puritanical Review".
fn display_name(slug: &str) -> String {
    slug.split('-')
        .map(|w| {
            let mut chars = w.chars();
            chars
                .next()
                .map_or_else(String::new, |c| c.to_uppercase().chain(chars).collect())
        })
        .collect::<Vec<_>>()
        .join(" ")
}

fn publish_args(slug: &str, version: &str, passthrough: &[String]) -> Vec<String> {
    let mut args: Vec<String> = [
        "skill",
        "publish",
        &format!(".openclaw/skills/{slug}"),
        "--slug",
        slug,
        "--name",
        &display_name(slug),
        "--version",
        version,
        "--tags",
        "latest",
    ]
    .iter()
    .map(ToString::to_string)
    .collect();
    args.extend_from_slice(passthrough);
    args
}

pub fn run(root: &Path, passthrough: &[String]) -> Result<String, String> {
    let version = package_version(root)?;
    let slugs = slugs(root)?;
    expected_slugs(&slugs)?;
    // npm installs a .cmd shim on Windows; std escapes batch arguments safely.
    let program = if cfg!(windows) {
        "clawhub.cmd"
    } else {
        "clawhub"
    };
    println!(
        "Publishing {} skills to ClawHub at version {version}:",
        slugs.len()
    );
    for slug in &slugs {
        let args = publish_args(slug, &version, passthrough);
        println!("\n$ clawhub {}", args.join(" "));
        let status = Command::new(program)
            .args(&args)
            .current_dir(root)
            .status()
            .map_err(|e| {
                format!("could not run clawhub ({e}); install it and run `clawhub login`")
            })?;
        if !status.success() {
            return Err(format!(
                "Publish failed for \"{slug}\" ({status}). Check `clawhub login`, then re-run. \
                 Skills already published in this run are unaffected."
            ));
        }
    }
    Ok(format!(
        "\nDone. Published {} skills at {version}.",
        slugs.len()
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn display_names_are_title_case() {
        assert_eq!(display_name("puritanical-review"), "Puritanical Review");
        assert_eq!(display_name("puritanical"), "Puritanical");
    }

    #[test]
    fn arguments_keep_the_display_name_whole_and_pass_extras_through() {
        let args = publish_args("puritanical-debt", "1.0.0", &["--dry-run".into()]);
        assert_eq!(args[6], "Puritanical Debt");
        assert_eq!(args.last().unwrap(), "--dry-run");
        assert!(args.windows(2).any(|w| w == ["--version", "1.0.0"]));
    }

    #[test]
    fn the_repository_has_publishable_skills() {
        let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("..");
        expected_slugs(&slugs(&root).unwrap()).unwrap();
        assert!(package_version(&root).is_ok());
    }

    #[test]
    fn a_partial_skill_tree_is_refused_before_publishing() {
        let dir = tempfile::tempdir().unwrap();
        let skill = dir.path().join(".openclaw/skills/puritanical");
        std::fs::create_dir_all(&skill).unwrap();
        std::fs::write(skill.join("SKILL.md"), "x").unwrap();
        std::fs::write(dir.path().join("package.json"), r#"{"version":"1.0.0"}"#).unwrap();
        let err = run(dir.path(), &[]).unwrap_err();
        assert!(err.contains("expected"), "{err}");
    }
}
