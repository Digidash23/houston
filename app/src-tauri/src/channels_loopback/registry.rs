//! The Slack return listeners still waiting, keyed by attempt id. Apart from
//! sign-in's registry, so neither ever supersedes or cancels the other.

use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Mutex, MutexGuard};

use crate::oauth_loopback::state::ActiveListener;

/// Every Slack listener still waiting, keyed by attempt id.
#[derive(Default)]
pub struct ChannelsLoopbackState {
    active: Mutex<HashMap<u64, ActiveListener>>,
    next_id: AtomicU64,
}

impl ChannelsLoopbackState {
    fn lock(&self) -> Result<MutexGuard<'_, HashMap<u64, ActiveListener>>, String> {
        self.active
            .lock()
            .map_err(|e| format!("channels loopback state lock poisoned: {e}"))
    }

    /// Ids start at 1, so 0 is never a live attempt.
    pub(super) fn mint_id(&self) -> u64 {
        self.next_id.fetch_add(1, Ordering::Relaxed) + 1
    }

    pub(super) fn insert(&self, listener: ActiveListener) -> Result<(), String> {
        self.lock()?.insert(listener.id, listener);
        Ok(())
    }

    pub(super) fn take(&self, id: u64) -> Result<Option<ActiveListener>, String> {
        Ok(self.lock()?.remove(&id))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::sync::oneshot;

    fn listener(id: u64) -> (ActiveListener, oneshot::Receiver<()>) {
        let (cancel, cancel_rx) = oneshot::channel::<()>();
        let (_freed_tx, freed) = oneshot::channel::<()>();
        (ActiveListener { id, cancel, freed }, cancel_rx)
    }

    #[test]
    fn attempts_are_kept_side_by_side_and_taken_by_id() {
        let state = ChannelsLoopbackState::default();
        assert_eq!(state.mint_id(), 1);
        assert_eq!(state.mint_id(), 2);
        let (first, _rx1) = listener(1);
        let (second, _rx2) = listener(2);
        state.insert(first).unwrap();
        state.insert(second).unwrap();
        assert_eq!(state.take(1).unwrap().map(|l| l.id), Some(1));
        assert!(state.take(1).unwrap().is_none());
        assert_eq!(state.take(2).unwrap().map(|l| l.id), Some(2));
    }
}
