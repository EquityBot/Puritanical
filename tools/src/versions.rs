//! Version-consistency guard. Puritanical declares its version in every host
//! manifest, and a release bumps all of them by hand. Manifests that agree
//! with each other can still all be stale, so on a release-tag CI run the
//! shared version must also equal the tag.

use std::path::Path;

/// Every file that declares the project version. Add new host manifests here.
const JSON_FILES: [&str; 7] = [
    ".claude-plugin/plugin.json",
    ".codex-plugin/plugin.json",
    ".devin-plugin/plugin.json",
    ".github/plugin/plugin.json",
    ".qoder-plugin/plugin.json",
    "gemini-extension.json",
    "package.json",
];
/// Hermes reads a flat YAML manifest with a top-level `version:` line.
const YAML_FILES: [&str; 1] = ["plugin.yaml"];

/// What CI sets on a tag push: `GITHUB_REF_TYPE=tag`, `GITHUB_REF_NAME=vX.Y.Z`.
pub struct TagEnv {
    pub ref_type: Option<String>,
    pub ref_name: Option<String>,
}

impl TagEnv {
    pub fn from_env() -> Self {
        Self {
            ref_type: std::env::var("GITHUB_REF_TYPE").ok(),
            ref_name: std::env::var("GITHUB_REF_NAME").ok(),
        }
    }
}

fn pinned(version: &str) -> bool {
    let parts: Vec<&str> = version.split('.').collect();
    parts.len() == 3
        && parts
            .iter()
            .all(|p| !p.is_empty() && p.bytes().all(|b| b.is_ascii_digit()))
}

fn read_version(root: &Path, rel: &str) -> Result<Option<String>, String> {
    let raw = std::fs::read_to_string(root.join(rel)).map_err(|e| format!("{rel}: {e}"))?;
    // Some Windows editors prepend a UTF-8 BOM, which breaks JSON parsing.
    let raw = raw.trim_start_matches('\u{feff}');
    if YAML_FILES.contains(&rel) {
        return Ok(raw
            .lines()
            .find_map(|line| line.strip_prefix("version:"))
            .map(|v| v.trim().trim_matches(['"', '\'']).to_string()));
    }
    let json: serde_json::Value = serde_json::from_str(raw).map_err(|e| format!("{rel}: {e}"))?;
    Ok(json
        .get("version")
        .and_then(|v| v.as_str())
        .map(str::to_string))
}

pub fn check(root: &Path, tag: &TagEnv) -> Result<String, String> {
    let mut errors = Vec::new();
    let mut versions = Vec::new();
    for rel in JSON_FILES.iter().chain(YAML_FILES.iter()) {
        match read_version(root, rel)? {
            Some(v) if pinned(&v) => versions.push((*rel, v)),
            other => errors.push(format!(
                "{rel}: version must be a pinned X.Y.Z semver, got {other:?}"
            )),
        }
    }
    let mut distinct: Vec<&str> = versions.iter().map(|(_, v)| v.as_str()).collect();
    distinct.sort_unstable();
    distinct.dedup();
    if distinct.len() > 1 {
        let table: Vec<String> = versions
            .iter()
            .map(|(rel, v)| format!("  {v}\t{rel}"))
            .collect();
        errors.push(format!(
            "Version mismatch, every manifest must share one version:\n{}",
            table.join("\n")
        ));
    }
    if let ([shared], Some("tag")) = (distinct.as_slice(), tag.ref_type.as_deref()) {
        let name = tag.ref_name.as_deref().unwrap_or("");
        let tagged = name.strip_prefix('v').unwrap_or(name);
        if pinned(tagged) && tagged != *shared {
            errors.push(format!("release tag {name} does not match version {shared}; bump the version files before tagging"));
        }
    }
    if errors.is_empty() {
        Ok(format!(
            "All {} version files pinned at {}.",
            versions.len(),
            distinct[0]
        ))
    } else {
        Err(errors.join("\n"))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    const NO_TAG: TagEnv = TagEnv {
        ref_type: None,
        ref_name: None,
    };

    fn tree(versions: &[&str; 8]) -> tempfile::TempDir {
        let dir = tempfile::tempdir().unwrap();
        for (rel, v) in JSON_FILES.iter().chain(YAML_FILES.iter()).zip(versions) {
            let path = dir.path().join(rel);
            fs::create_dir_all(path.parent().unwrap()).unwrap();
            let text = if YAML_FILES.contains(rel) {
                format!("name: puritanical\nversion: {v}\n")
            } else {
                format!("\u{feff}{{\"name\": \"puritanical\", \"version\": \"{v}\"}}")
            };
            fs::write(path, text).unwrap();
        }
        dir
    }

    #[test]
    fn the_repository_versions_agree() {
        check(&Path::new(env!("CARGO_MANIFEST_DIR")).join(".."), &NO_TAG).unwrap();
    }

    #[test]
    fn one_stale_manifest_is_reported() {
        let dir = tree(&[
            "1.0.0", "1.0.0", "1.0.0", "1.0.0", "1.0.0", "1.0.0", "1.0.0", "0.9.0",
        ]);
        let err = check(dir.path(), &NO_TAG).unwrap_err();
        assert!(err.contains("0.9.0\tplugin.yaml"), "{err}");
    }

    #[test]
    fn ranges_and_prereleases_are_not_pinned() {
        for bad in ["^1.0.0", "1.0", "1.0.0-rc.1", "1..0"] {
            assert!(!pinned(bad), "{bad}");
        }
        let dir = tree(&["^1.0.0"; 8]);
        assert!(check(dir.path(), &NO_TAG).is_err());
    }

    #[test]
    fn a_release_tag_must_match_the_shared_version() {
        let dir = tree(&["1.0.0"; 8]);
        let tag = |name: &str| TagEnv {
            ref_type: Some("tag".into()),
            ref_name: Some(name.into()),
        };
        assert!(check(dir.path(), &tag("v1.0.0")).is_ok());
        assert!(
            check(dir.path(), &tag("v1.0.1"))
                .unwrap_err()
                .contains("does not match")
        );
        // A non-version tag is not a release tag.
        assert!(check(dir.path(), &tag("docs-refresh")).is_ok());
    }
}
