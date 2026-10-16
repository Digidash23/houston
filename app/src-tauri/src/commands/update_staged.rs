//! Verified release bytes, held per version for the whole process (H-035).
//!
//! The updater hook remounts across the mobile breakpoint, on identity change
//! and on reload, while the shell's download keeps running. The remounted
//! hook used to get `in_progress`; the orphaned download then staged its
//! bytes in a resource no live hook knew the id of, and the next poll fetched
//! the 330 MB release again from byte 0. Here a second call for the same
//! release waits for the first and gets its outcome, and a call after it
//! succeeded gets the bytes at once. Process-wide on purpose: a reload drops
//! the frontend's module state, and the webview's resource table outlives it.

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

#[derive(Default)]
struct SlotState {
    admitted: Option<Admitted>,
    /// Attempts that have ended, and how the last one failed. A caller that
    /// queued while an attempt ran gets that attempt's failure instead of
    /// running its own: a bad signature or a full disk would only repeat,
    /// 330 MB later.
    ended: u64,
    failed: Option<DownloadFailure>,
}

/// One version. `download` is held for a whole attempt, which is what makes
/// a second caller wait for the first instead of starting its own.
#[derive(Default)]
struct Slot {
    download: AsyncMutex<()>,
    state: Mutex<SlotState>,
}

impl Slot {
    fn state(&self) -> MutexGuard<'_, SlotState> {
        self.state
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }
}

#[derive(Default)]
pub struct StagedReleases {
    slots: Mutex<HashMap<String, Arc<Slot>>>,
}

/// The process's one registry.
pub static STAGED: LazyLock<StagedReleases> = LazyLock::new(StagedReleases::default);

impl StagedReleases {
    fn slots(&self) -> MutexGuard<'_, HashMap<String, Arc<Slot>>> {
        self.slots
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    /// The slot of `version`. Asking for a version drops every other one: a
    /// newer find supersedes whatever was staged of the release before it,
    /// and its bytes would otherwise stay in memory until the app quits.
    fn slot(&self, version: &str) -> Arc<Slot> {
        let mut slots = self.slots();
        slots.retain(|staged, _| staged == version);
        slots.entry(version.to_string()).or_default().clone()
    }

    /// The bytes of `version` signed with `signature`: the ones already
    /// admitted, the outcome of an attempt running now (this call waits for
    /// it), or what `fetch` returns when neither exists. A failed fetch
    /// stages nothing, so a caller arriving after it runs its own.
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
        let seen = slot.state().ended;
        let _download = slot.download.lock().await;
        {
            let state = slot.state();
            if let Some(found) = state.admitted.as_ref().filter(|a| a.signature == signature) {
                return Ok(found.bytes.clone());
            }
            if let (true, Some(failed)) = (state.ended != seen, &state.failed) {
                return Err(failed.clone());
            }
        }
        let result = fetch().await.map(Arc::new);
        let mut state = slot.state();
        state.ended += 1;
        match &result {
            Ok(bytes) => {
                state.admitted = Some(Admitted {
                    signature: signature.to_string(),
                    bytes: bytes.clone(),
                });
                state.failed = None;
            }
            Err(failed) => state.failed = Some(failed.clone()),
        }
        result
    }

    /// The admitted bytes of `version` under `signature`, if any.
    pub fn admitted(&self, version: &str, signature: &str) -> Option<Arc<Vec<u8>>> {
        let slot = self.slots().get(version)?.clone();
        let state = slot.state();
        let admitted = state.admitted.as_ref()?;
        (admitted.signature == signature).then(|| admitted.bytes.clone())
    }

    /// Drop `version`'s bytes once they are installed.
    pub fn forget(&self, version: &str) {
        self.slots().remove(version);
    }
}

#[cfg(test)]
#[path = "update_staged_tests.rs"]
mod tests;
