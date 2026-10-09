//! The persisted partial: what survives a reopen, what starts it over, and
//! what a newer version sweeps away.

use super::{PartialDownload, Sidecar};
use std::path::PathBuf;
use std::sync::atomic::{AtomicU32, Ordering};

/// A fresh, empty directory per test (a dependency-free tempdir).
pub(crate) fn scratch_dir(tag: &str) -> PathBuf {
    static NEXT: AtomicU32 = AtomicU32::new(0);
    let dir = std::env::temp_dir().join(format!(
        "houston-update-{tag}-{}-{}",
        std::process::id(),
        NEXT.fetch_add(1, Ordering::Relaxed)
    ));
    std::fs::create_dir_all(&dir).expect("scratch dir");
    dir
}

const URL: &str = "https://releases.example/houston/1.0.0/Houston.app.tar.gz";

fn sidecar(url: &str) -> Sidecar {
    Sidecar {
        url: url.to_string(),
        validator: Some("\"abc123\"".to_string()),
        total: Some(10),
    }
}

async fn seeded(dir: &std::path::Path, version: &str, url: &str, bytes: &[u8]) {
    let mut partial = PartialDownload::open(dir, version, url).unwrap();
    partial.restart(Some(sidecar(url))).await.unwrap();
    partial.append(bytes).await.unwrap();
    partial.settle().await.unwrap();
}

#[test]
fn a_fresh_open_has_nothing() {
    let dir = scratch_dir("fresh");
    let partial = PartialDownload::open(&dir, "1.0.0", URL).unwrap();
    assert_eq!(partial.len(), 0);
    assert_eq!(partial.validator(), None);
    assert_eq!(partial.total(), None);
    assert!(!partial.path().exists());
}

#[tokio::test]
async fn the_bytes_and_the_sidecar_survive_a_reopen_for_the_same_object() {
    let dir = scratch_dir("reopen");
    seeded(&dir, "1.0.0", URL, b"12345").await;
    let mut partial = PartialDownload::open(&dir, "1.0.0", URL).unwrap();
    assert_eq!(partial.len(), 5);
    assert_eq!(partial.validator(), Some("\"abc123\""));
    assert_eq!(partial.total(), Some(10));
    partial.append(b"67").await.unwrap();
    partial.settle().await.unwrap();
    assert_eq!(std::fs::read(partial.path()).unwrap(), b"1234567");
    assert_eq!(partial.len(), 7);
}

#[tokio::test]
async fn a_sidecar_for_another_url_starts_fresh() {
    let dir = scratch_dir("other-url");
    seeded(&dir, "1.0.0", URL, b"12345").await;
    let partial =
        PartialDownload::open(&dir, "1.0.0", "https://releases.example/moved.tar.gz").unwrap();
    assert_eq!(partial.len(), 0);
    assert_eq!(partial.validator(), None);
    assert!(!partial.path().exists(), "the stale bytes are gone");
    assert!(!dir.join("1.0.0.part.json").exists(), "and their sidecar");
}

#[test]
fn a_part_without_a_sidecar_is_removed() {
    let dir = scratch_dir("no-sidecar");
    std::fs::write(dir.join("1.0.0.part"), b"orphan").unwrap();
    let partial = PartialDownload::open(&dir, "1.0.0", URL).unwrap();
    assert_eq!(partial.len(), 0);
    assert!(!partial.path().exists());
}

#[tokio::test]
async fn opening_a_newer_version_prunes_the_older_partial() {
    let dir = scratch_dir("prune");
    seeded(&dir, "1.0.0", URL, b"12345").await;
    std::fs::write(dir.join("1.0.0.part.json.houston.tmp"), b"{").unwrap();
    let partial = PartialDownload::open(&dir, "1.0.1", URL).unwrap();
    assert_eq!(partial.len(), 0);
    let left: Vec<String> = std::fs::read_dir(&dir)
        .unwrap()
        .map(|e| e.unwrap().file_name().to_string_lossy().into_owned())
        .collect();
    assert!(left.is_empty(), "nothing of 1.0.0 survives: {left:?}");
}

#[tokio::test]
async fn a_restart_without_a_sidecar_forgets_the_object() {
    let dir = scratch_dir("restart-none");
    seeded(&dir, "1.0.0", URL, b"12345").await;
    let mut partial = PartialDownload::open(&dir, "1.0.0", URL).unwrap();
    partial.restart(None).await.unwrap();
    assert_eq!(partial.len(), 0);
    assert_eq!(partial.validator(), None);
    assert_eq!(std::fs::metadata(partial.path()).unwrap().len(), 0);
    assert!(!dir.join("1.0.0.part.json").exists());
}

#[tokio::test]
async fn discard_removes_both_files() {
    let dir = scratch_dir("discard");
    seeded(&dir, "1.0.0", URL, b"12345").await;
    let mut partial = PartialDownload::open(&dir, "1.0.0", URL).unwrap();
    partial.discard().unwrap();
    assert!(!dir.join("1.0.0.part").exists());
    assert!(!dir.join("1.0.0.part.json").exists());
}

#[test]
fn the_version_is_sanitised_into_the_file_name() {
    let dir = scratch_dir("name");
    let partial = PartialDownload::open(&dir, "1.0.0+build/7", URL).unwrap();
    assert_eq!(
        partial.path().file_name().unwrap().to_str().unwrap(),
        "1.0.0_build_7.part"
    );
}
