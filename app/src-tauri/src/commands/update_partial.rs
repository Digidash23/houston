//! The partial release file a download resumes from ACROSS calls.
//!
//! `update_fetch` already resumed a dropped stream within one call, but the
//! bytes lived in memory: when the attempt budget ran out, the next poll
//! started the 330 MB asset from zero, and a link that drops every 50 to
//! 200 MB never finished one. The partial now streams to
//! `<app cache>/updates/<version>.part` beside a sidecar naming the object it
//! belongs to (URL, the server's validator, the total). The next call reopens
//! it, asks for the rest with `Range` + `If-Range`, and restarts only when the
//! sidecar does not match or the server answers a full body. Nothing here
//! trusts the bytes: the signature check over the finished file
//! (`update_verify`) is what admits them, and it consumes the file either way.

use serde::{Deserialize, Serialize};
use std::io;
use std::path::{Path, PathBuf};
use tokio::fs::{File, OpenOptions};
use tokio::io::AsyncWriteExt;

/// The suffix every atomic write in the repo gives its temp file
/// (`ATOMIC_TMP_SUFFIX` in `@houston/protocol`): a half-written sidecar is
/// never read as one.
const ATOMIC_TMP_SUFFIX: &str = ".houston.tmp";
const PART_SUFFIX: &str = ".part";
const SIDECAR_SUFFIX: &str = ".part.json";

/// Which object the bytes on disk belong to. `validator` is the strong
/// `ETag`, else `Last-Modified`, as the server sent it; `None` when it sent
/// neither (the resume then has only the signature check behind it).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Sidecar {
    pub url: String,
    pub validator: Option<String>,
    pub total: Option<u64>,
}

pub struct PartialDownload {
    path: PathBuf,
    sidecar_path: PathBuf,
    sidecar_tmp_path: PathBuf,
    file: Option<File>,
    len: u64,
    sidecar: Option<Sidecar>,
}

fn file_stem(version: &str) -> String {
    version
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | '_') {
                c
            } else {
                '_'
            }
        })
        .collect()
}

fn remove_if_present(path: &Path) -> io::Result<()> {
    match std::fs::remove_file(path) {
        Err(e) if e.kind() != io::ErrorKind::NotFound => Err(e),
        _ => Ok(()),
    }
}

/// Drop the partials of every OTHER version: a newer release supersedes
/// whatever was half-downloaded of the one before it. A leftover sidecar temp
/// file never strips down to a bare version, so it goes too, whatever its
/// version.
fn prune_others(dir: &Path, keep: &str) -> io::Result<()> {
    for entry in std::fs::read_dir(dir)? {
        let path = entry?.path();
        let Some(name) = path.file_name().and_then(|n| n.to_str()) else {
            continue;
        };
        let stem = name
            .strip_suffix(SIDECAR_SUFFIX)
            .or_else(|| name.strip_suffix(PART_SUFFIX))
            .or_else(|| name.strip_suffix(ATOMIC_TMP_SUFFIX));
        if matches!(stem, Some(stem) if stem != keep) {
            remove_if_present(&path)?;
        }
    }
    Ok(())
}

fn read_sidecar(path: &Path) -> Option<Sidecar> {
    let raw = std::fs::read(path).ok()?;
    serde_json::from_slice(&raw).ok()
}

impl PartialDownload {
    /// Reopen the partial of `version` for `url` under `dir`, or start a
    /// fresh one when nothing on disk belongs to that exact object.
    pub fn open(dir: &Path, version: &str, url: &str) -> io::Result<Self> {
        std::fs::create_dir_all(dir)?;
        let stem = file_stem(version);
        prune_others(dir, &stem)?;
        let mut partial = Self {
            path: dir.join(format!("{stem}{PART_SUFFIX}")),
            sidecar_path: dir.join(format!("{stem}{SIDECAR_SUFFIX}")),
            sidecar_tmp_path: dir.join(format!("{stem}{SIDECAR_SUFFIX}{ATOMIC_TMP_SUFFIX}")),
            file: None,
            len: 0,
            sidecar: None,
        };
        let sidecar = read_sidecar(&partial.sidecar_path).filter(|s| s.url == url);
        let len = std::fs::metadata(&partial.path).map(|m| m.len()).ok();
        match (sidecar, len) {
            (Some(sidecar), Some(len)) if len > 0 => {
                partial.sidecar = Some(sidecar);
                partial.len = len;
            }
            _ => partial.remove_files()?,
        }
        Ok(partial)
    }

    pub fn path(&self) -> &Path {
        &self.path
    }

    pub fn len(&self) -> u64 {
        self.len
    }

    pub fn validator(&self) -> Option<&str> {
        self.sidecar.as_ref()?.validator.as_deref()
    }

    pub fn total(&self) -> Option<u64> {
        self.sidecar.as_ref()?.total
    }

    /// Throw the bytes away and begin again, as `sidecar` describes (or as
    /// nothing at all, so the next request asks for a full body).
    pub async fn restart(&mut self, sidecar: Option<Sidecar>) -> io::Result<()> {
        self.file = None;
        self.len = 0;
        self.sidecar = sidecar;
        self.file = Some(File::create(&self.path).await?);
        match &self.sidecar {
            Some(sidecar) => self.write_sidecar(sidecar),
            None => remove_if_present(&self.sidecar_path),
        }
    }

    pub async fn append(&mut self, chunk: &[u8]) -> io::Result<()> {
        if self.file.is_none() {
            let file = OpenOptions::new().append(true).open(&self.path).await?;
            self.file = Some(file);
        }
        if let Some(file) = self.file.as_mut() {
            file.write_all(chunk).await?;
        }
        self.len += chunk.len() as u64;
        Ok(())
    }

    /// Push everything appended so far to disk, so a process that dies now
    /// still resumes from the bytes it had.
    pub async fn settle(&mut self) -> io::Result<()> {
        if let Some(file) = self.file.as_mut() {
            file.flush().await?;
            file.sync_data().await?;
        }
        Ok(())
    }

    /// Remove the partial and its sidecar: the bytes were admitted, or must
    /// never be resumed onto.
    pub fn discard(&mut self) -> io::Result<()> {
        self.file = None;
        self.remove_files()
    }

    fn remove_files(&mut self) -> io::Result<()> {
        self.len = 0;
        self.sidecar = None;
        remove_if_present(&self.path)?;
        remove_if_present(&self.sidecar_path)
    }

    fn write_sidecar(&self, sidecar: &Sidecar) -> io::Result<()> {
        std::fs::write(&self.sidecar_tmp_path, serde_json::to_vec(sidecar)?)?;
        std::fs::rename(&self.sidecar_tmp_path, &self.sidecar_path)
    }
}

#[cfg(test)]
#[path = "update_partial_tests.rs"]
pub(crate) mod tests;
