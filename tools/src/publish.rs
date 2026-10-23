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
    let dir = root.join(".openclaw/skills");
    let mut out: Vec<String> = std::fs::read_dir(&dir)
        .map_err(|e| format!(".openclaw/skills: {e}"))?
        .filter_map(Result::ok)
        .filter(|e| e.path().join("SKILL.md").is_file())
        .filter_map(|e| e.file_name().into_string().ok())
        .collect();
    out.sort();
    Ok(out)
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
    if slugs.is_empty() {
        return Err("No skills under .openclaw/skills; run puritanical-tools sync first.".into());
    }
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
        assert_eq!(slugs(&root).unwrap().len(), crate::rules::SKILLS.len());
        assert!(package_version(&root).is_ok());
    }
}
