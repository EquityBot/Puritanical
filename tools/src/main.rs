//! Maintainer tooling for Puritanical. Hooks and host adapters stay in their
//! hosts' languages; this covers the repository chores that only maintainers
//! and CI run.
//!
//!   puritanical-tools sync [--check]        write (or verify) every rule copy
//!   puritanical-tools check-versions        every manifest shares one version
//!   puritanical-tools publish-openclaw ...  push .openclaw/skills to `ClawHub`

mod publish;
mod rules;
mod versions;

use std::path::PathBuf;
use std::process::ExitCode;

/// The repository root: the parent of this crate, or `PURITANICAL_ROOT`.
fn root() -> PathBuf {
    std::env::var_os("PURITANICAL_ROOT").map_or_else(
        || PathBuf::from(env!("CARGO_MANIFEST_DIR")).join(".."),
        PathBuf::from,
    )
}

fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let root = root();
    let result = match args.first().map(String::as_str) {
        Some("sync") => rules::sync(&root, args.iter().any(|a| a == "--check")),
        Some("check-versions") => versions::check(&root, &versions::TagEnv::from_env()),
        Some("publish-openclaw") => publish::run(&root, &args[1..]),
        _ => Err("usage: puritanical-tools <sync [--check] | check-versions | publish-openclaw [clawhub args]>".into()),
    };
    match result {
        Ok(message) => {
            println!("{message}");
            ExitCode::SUCCESS
        }
        Err(message) => {
            eprintln!("{message}");
            ExitCode::FAILURE
        }
    }
}
