//! Verified release bytes, held per version for the whole process (H-035).
//!
//! The updater hook remounts across the mobile breakpoint, on identity change
//! and on reload, while the shell's download keeps running. The remounted
//! hook used to get `in_progress`; the orphaned download then staged its
//! bytes in a resource no live hook knew the id of, and the next poll fetched
//! the 330 MB release again from byte 0. Here a second call for the same
//! release waits for the first and is handed the same bytes, and a call after
//! it finished gets them at once. Process-wide on purpose: a reload drops the
//! frontend's module state, and the webview's resource table outlives it.

use super::update_failure::DownloadFailure;
use std::collections::HashMap;
use std::future::Future;
use std::sync::{Arc, LazyLock, Mutex, MutexGuard};
use tokio::sync::Mutex as AsyncMutex;

/// Bytes admitted against `signature`. A release re-signed under the same
/// version is a different object: its caller downloads it afresh.
struct Admitted {
    signature: String,
    bytes: Arc<Vec<u8>>,
}

/// One version's slot. Its lock is held for a whole download, which is what
/// makes a second caller wait for the first instead of starting its own.
type Slot = Arc<AsyncMutex<Option<Admitted>>>;

#[derive(Default)]
pub struct StagedReleases {
    slots: Mutex<HashMap<String, Slot>>,
}

/// The process's one registry.
pub static STAGED: LazyLock<StagedReleases> = LazyLock::new(StagedReleases::default);

impl StagedReleases {
    fn slots(&self) -> MutexGuard<'_, HashMap<String, Slot>> {
        self.slots
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    /// The slot of `version`. Asking for a version drops every other one: a
    /// newer find supersedes whatever was staged of the release before it,
    /// and its bytes would otherwise stay in memory until the app quits.
    fn slot(&self, version: &str) -> Slot {
        let mut slots = self.slots();
        slots.retain(|staged, _| staged == version);
        slots.entry(version.to_string()).or_default().clone()
    }

    /// The bytes of `version` signed with `signature`: the ones already
    /// admitted, the ones a download running now admits (this call waits for
    /// it), or the ones `fetch` admits when neither exists. A failed fetch
    /// stages nothing, so the next caller runs its own.
    pub async fn admitted_or_fetch<F, Fut>(
        &self,
        version: &str,
        signature: &str,
        fetch: F,
    ) -> Result<Arc<Vec<u8>>, DownloadFailure>
    where
        F: FnOnce() -> Fut,
        Fut: Future<Output = Result<Vec<u8>, DownloadFailure>>,
    {
        let slot = self.slot(version);
        let mut admitted = slot.lock().await;
        if let Some(found) = admitted.as_ref().filter(|a| a.signature == signature) {
            return Ok(found.bytes.clone());
        }
        let bytes = Arc::new(fetch().await?);
        *admitted = Some(Admitted {
            signature: signature.to_string(),
            bytes: bytes.clone(),
        });
        Ok(bytes)
    }

    /// Drop `version`'s bytes once they are installed.
    pub fn forget(&self, version: &str) {
        self.slots().remove(version);
    }
}

#[cfg(test)]
#[path = "update_staged_tests.rs"]
mod tests;
