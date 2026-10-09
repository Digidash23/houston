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
//! (`update_verify`) is what admits them.

use super::update_partial_dir::{
    file_stem, prune_others, read_sidecar, remove_if_present, InFlightClaim, ATOMIC_TMP_SUFFIX,
    PART_SUFFIX, SIDECAR_SUFFIX,
};
use serde::{Deserialize, Serialize};
use std::io;
use std::path::{Path, PathBuf};
use tokio::fs::{File, OpenOptions};
use tokio::io::AsyncWriteExt;

/// Which object the bytes on disk belong to. `validator` is the strong
/// `ETag`, else `Last-Modified`, as the server sent it; `None` when it sent
/// neither (the resume then has only the signature check behind it).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Sidecar {
    pub url: String,
    pub validator: Option<String>,
    pub total: Option<u64>,
}

#[derive(Debug)]
pub enum OpenError {
    /// Another download in this process holds the same partial right now.
    InProgress,
    Io(io::Error),
}

impl From<io::Error> for OpenError {
    fn from(err: io::Error) -> Self {
        Self::Io(err)
    }
}

pub struct PartialDownload {
    path: PathBuf,
    sidecar_path: PathBuf,
    sidecar_tmp_path: PathBuf,
    file: Option<File>,
    len: u64,
    sidecar: Option<Sidecar>,
    _claim: InFlightClaim,
}

impl PartialDownload {
    /// Reopen the partial of `version` for `url` under `dir`, or start a
    /// fresh one when nothing on disk belongs to that exact object.
    pub fn open(dir: &Path, version: &str, url: &str) -> Result<Self, OpenError> {
        std::fs::create_dir_all(dir)?;
        let stem = file_stem(version);
        let path = dir.join(format!("{stem}{PART_SUFFIX}"));
        let claim = InFlightClaim::take(&path).ok_or(OpenError::InProgress)?;
        prune_others(dir, &stem);
        let mut partial = Self {
            path,
            sidecar_path: dir.join(format!("{stem}{SIDECAR_SUFFIX}")),
            sidecar_tmp_path: dir.join(format!("{stem}{SIDECAR_SUFFIX}{ATOMIC_TMP_SUFFIX}")),
            file: None,
            len: 0,
            sidecar: None,
            _claim: claim,
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
    /// nothing at all, so the next request asks for a full body). With a
    /// known total the file is first extended to it and cut back: on a
    /// filesystem that allocates on extend (NTFS) a full disk fails HERE,
    /// before a single byte is fetched into it.
    pub async fn restart(&mut self, sidecar: Option<Sidecar>) -> io::Result<()> {
        self.file = None;
        self.len = 0;
        self.sidecar = sidecar;
        let file = File::create(&self.path).await?;
        if let Some(total) = self.total() {
            file.set_len(total).await?;
            file.set_len(0).await?;
        }
        self.file = Some(file);
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
