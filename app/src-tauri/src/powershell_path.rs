//! The Windows PowerShell 5.1 binary for the shell's own spawns (the save /
//! open file dialogs, the taskbar icon repair).
//!
//! A bare `powershell` resolves through the user's PATH, and installers
//! routinely mangle it: on those machines the save dialog failed in 20 ms
//! with "program not found" before it ever opened (HOUSTON-APP-53A; the same
//! PATH class `shell_env::hardened_path` repairs for the Claude CLI,
//! HOUSTON-APP-4YP). Every Windows install ships PowerShell 5.1 under
//! `%SystemRoot%`, so spawn it by absolute path and keep the PATH lookup
//! only as the fallback.

use std::ffi::OsString;
use std::path::{Path, PathBuf};

const FALLBACK_SYSTEM_ROOT: &str = "C:\\Windows";
const PATH_LOOKUP: &str = "powershell.exe";

/// The PowerShell binary to spawn on this machine.
#[cfg(windows)]
pub fn windows_powershell() -> PathBuf {
    resolve(std::env::var_os("SystemRoot"), Path::is_file)
}

/// `<system_root>\System32\WindowsPowerShell\v1.0\powershell.exe` when that
/// file exists, else the PATH lookup. An unset or empty `SystemRoot` falls
/// back to `C:\Windows`. Pure over its inputs so every host can test it.
#[cfg_attr(not(windows), allow(dead_code))]
fn resolve(system_root: Option<OsString>, is_file: impl Fn(&Path) -> bool) -> PathBuf {
    let root = system_root
        .filter(|r| !r.is_empty())
        .unwrap_or_else(|| OsString::from(FALLBACK_SYSTEM_ROOT));
    let candidate = PathBuf::from(root)
        .join("System32")
        .join("WindowsPowerShell")
        .join("v1.0")
        .join(PATH_LOOKUP);
    if is_file(&candidate) {
        candidate
    } else {
        PathBuf::from(PATH_LOOKUP)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn expected_under(root: &str) -> PathBuf {
        PathBuf::from(root)
            .join("System32")
            .join("WindowsPowerShell")
            .join("v1.0")
            .join("powershell.exe")
    }

    #[test]
    fn spawns_the_system_root_binary_when_present() {
        let want = expected_under("D:\\Win");
        let got = resolve(Some(OsString::from("D:\\Win")), |p| p == want);
        assert_eq!(got, want);
    }

    #[test]
    fn falls_back_to_path_lookup_when_the_binary_is_missing() {
        let got = resolve(Some(OsString::from("D:\\Win")), |_| false);
        assert_eq!(got, PathBuf::from("powershell.exe"));
    }

    #[test]
    fn unset_or_empty_system_root_uses_the_default_windows_dir() {
        let want = expected_under("C:\\Windows");
        assert_eq!(resolve(None, |p| p == want), want);
        assert_eq!(resolve(Some(OsString::new()), |p| p == want), want);
    }
}
