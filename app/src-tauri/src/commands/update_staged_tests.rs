use super::StagedReleases;
use crate::commands::update_failure::{DownloadFailure, DownloadFailureKind};
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::Arc;
use tokio::sync::oneshot;

async fn counted(fetches: &AtomicU32, bytes: &'static [u8]) -> Result<Vec<u8>, DownloadFailure> {
    fetches.fetch_add(1, Ordering::SeqCst);
    Ok(bytes.to_vec())
}

#[tokio::test]
async fn a_second_caller_joins_the_running_download_instead_of_starting_one() {
    let staged = Arc::new(StagedReleases::default());
    let fetches = Arc::new(AtomicU32::new(0));
    let (release, released) = oneshot::channel::<()>();
    let (started, has_started) = oneshot::channel::<()>();

    let first = tokio::spawn({
        let (staged, fetches) = (staged.clone(), fetches.clone());
        async move {
            staged
                .admitted_or_fetch("1.0.8", "sig", || async move {
                    fetches.fetch_add(1, Ordering::SeqCst);
                    started.send(()).unwrap();
                    released.await.unwrap();
                    Ok(b"release".to_vec())
                })
                .await
        }
    });
    has_started.await.unwrap();
    let second = tokio::spawn({
        let (staged, fetches) = (staged.clone(), fetches.clone());
        async move {
            staged
                .admitted_or_fetch("1.0.8", "sig", || counted(&fetches, b"again"))
                .await
        }
    });
    for _ in 0..3 {
        tokio::task::yield_now().await;
    }
    assert!(
        !second.is_finished(),
        "the second caller waits on the first"
    );
    release.send(()).unwrap();

    let first = first.await.unwrap().unwrap();
    let second = second.await.unwrap().unwrap();
    assert_eq!(fetches.load(Ordering::SeqCst), 1);
    assert!(Arc::ptr_eq(&first, &second), "both hold the one buffer");
}

#[tokio::test]
async fn a_caller_after_the_download_finished_gets_the_bytes_without_fetching() {
    let staged = StagedReleases::default();
    let fetches = AtomicU32::new(0);
    staged
        .admitted_or_fetch("1.0.8", "sig", || counted(&fetches, b"release"))
        .await
        .unwrap();
    let again = staged
        .admitted_or_fetch("1.0.8", "sig", || counted(&fetches, b"again"))
        .await
        .unwrap();
    assert_eq!(fetches.load(Ordering::SeqCst), 1);
    assert_eq!(again.as_slice(), b"release");
}

#[tokio::test]
async fn a_failed_download_stages_nothing_and_the_next_caller_fetches() {
    let staged = StagedReleases::default();
    let fetches = AtomicU32::new(0);
    let failed = staged
        .admitted_or_fetch("1.0.8", "sig", || async {
            Err(DownloadFailure::other("link dropped"))
        })
        .await;
    assert!(failed.is_err());
    let bytes = staged
        .admitted_or_fetch("1.0.8", "sig", || counted(&fetches, b"release"))
        .await
        .unwrap();
    assert_eq!(fetches.load(Ordering::SeqCst), 1);
    assert_eq!(bytes.as_slice(), b"release");
}

#[tokio::test]
async fn a_release_re_signed_under_the_same_version_is_fetched_again() {
    let staged = StagedReleases::default();
    let fetches = AtomicU32::new(0);
    staged
        .admitted_or_fetch("1.0.8", "old-sig", || counted(&fetches, b"old"))
        .await
        .unwrap();
    let bytes = staged
        .admitted_or_fetch("1.0.8", "new-sig", || counted(&fetches, b"new"))
        .await
        .unwrap();
    assert_eq!(fetches.load(Ordering::SeqCst), 2);
    assert_eq!(bytes.as_slice(), b"new");
}

#[tokio::test]
async fn a_newer_version_drops_the_bytes_of_the_one_before() {
    let staged = StagedReleases::default();
    let fetches = AtomicU32::new(0);
    let old = staged
        .admitted_or_fetch("1.0.7", "sig", || counted(&fetches, b"old"))
        .await
        .unwrap();
    staged
        .admitted_or_fetch("1.0.8", "sig", || counted(&fetches, b"new"))
        .await
        .unwrap();
    assert_eq!(Arc::strong_count(&old), 1, "only this test holds 1.0.7 now");
}

#[tokio::test]
async fn forgotten_bytes_are_fetched_again() {
    let staged = StagedReleases::default();
    let fetches = AtomicU32::new(0);
    staged
        .admitted_or_fetch("1.0.8", "sig", || counted(&fetches, b"release"))
        .await
        .unwrap();
    staged.forget("1.0.8");
    staged
        .admitted_or_fetch("1.0.8", "sig", || counted(&fetches, b"release"))
        .await
        .unwrap();
    assert_eq!(fetches.load(Ordering::SeqCst), 2);
}

#[tokio::test]
async fn a_caller_queued_behind_a_failed_attempt_gets_its_failure_without_fetching() {
    let staged = Arc::new(StagedReleases::default());
    let fetches = Arc::new(AtomicU32::new(0));
    let (release, released) = oneshot::channel::<()>();
    let (started, has_started) = oneshot::channel::<()>();

    let first = tokio::spawn({
        let staged = staged.clone();
        async move {
            staged
                .admitted_or_fetch("1.0.8", "sig", || async move {
                    started.send(()).unwrap();
                    released.await.unwrap();
                    Err(DownloadFailure::signature("bad".to_string(), 3))
                })
                .await
        }
    });
    has_started.await.unwrap();
    let second = tokio::spawn({
        let (staged, fetches) = (staged.clone(), fetches.clone());
        async move {
            staged
                .admitted_or_fetch("1.0.8", "sig", || counted(&fetches, b"again"))
                .await
        }
    });
    for _ in 0..3 {
        tokio::task::yield_now().await;
    }
    release.send(()).unwrap();

    assert!(first.await.unwrap().is_err());
    let shared = second.await.unwrap().unwrap_err();
    assert_eq!(shared.kind, DownloadFailureKind::Signature);
    assert_eq!(fetches.load(Ordering::SeqCst), 0);

    staged
        .admitted_or_fetch("1.0.8", "sig", || counted(&fetches, b"release"))
        .await
        .unwrap();
    assert_eq!(fetches.load(Ordering::SeqCst), 1, "a later caller fetches");
}

#[tokio::test]
async fn admitted_bytes_are_found_only_under_their_signature_until_forgotten() {
    let staged = StagedReleases::default();
    let fetches = AtomicU32::new(0);
    assert!(staged.admitted("1.0.8", "sig").is_none());
    staged
        .admitted_or_fetch("1.0.8", "sig", || counted(&fetches, b"release"))
        .await
        .unwrap();
    assert_eq!(
        staged.admitted("1.0.8", "sig").unwrap().as_slice(),
        b"release"
    );
    assert!(staged.admitted("1.0.8", "other-sig").is_none());
    staged.forget("1.0.8");
    assert!(staged.admitted("1.0.8", "sig").is_none());
}
