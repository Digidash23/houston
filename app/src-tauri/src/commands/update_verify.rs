//! The signature gate on a finished release download: the plugin's minisign
//! check over the whole file, on the same pubkey the plugin reads from
//! `tauri.conf.json` (`plugins.updater.pubkey`). Partial or resumed, bytes
//! only ever reach the installer through `admit_release`.

use super::update_failure::DownloadFailure;
use super::update_partial::PartialDownload;
use minisign_verify::{PublicKey, Signature};

pub fn verify_signature(
    data: &[u8],
    release_signature: &str,
    pubkey_b64: &str,
) -> Result<(), String> {
    use base64::Engine;
    let decode = |value: &str| {
        base64::engine::general_purpose::STANDARD
            .decode(value)
            .map_err(|e| e.to_string())
            .and_then(|bytes| String::from_utf8(bytes).map_err(|e| e.to_string()))
    };
    let public_key = PublicKey::decode(&decode(pubkey_b64)?).map_err(|e| e.to_string())?;
    let signature = Signature::decode(&decode(release_signature)?).map_err(|e| e.to_string())?;
    public_key
        .verify(data, &signature, true)
        .map_err(|e| e.to_string())
}

/// Read the finished partial, verify it against the release signature and
/// hand the bytes over. The file is gone afterwards either way: verified
/// bytes live in the staged resource until the install, and a mismatch must
/// never be resumed onto (the next poll downloads the asset afresh).
pub async fn admit_release(
    mut partial: PartialDownload,
    release_signature: &str,
    pubkey_b64: &str,
) -> Result<Vec<u8>, DownloadFailure> {
    let bytes = tokio::fs::read(partial.path())
        .await
        .map_err(|e| DownloadFailure::other(format!("read finished download: {e}")))?;
    partial
        .discard()
        .map_err(|e| DownloadFailure::other(format!("remove finished download: {e}")))?;
    verify_signature(&bytes, release_signature, pubkey_b64)
        .map_err(|message| DownloadFailure::signature(message, bytes.len() as u64))?;
    Ok(bytes)
}

#[cfg(test)]
mod tests {
    use super::{admit_release, verify_signature};
    use crate::commands::update_failure::DownloadFailureKind;
    use crate::commands::update_partial::tests::scratch_dir;
    use crate::commands::update_partial::{PartialDownload, Sidecar};

    const PUBKEY: &str = "dW50cnVzdGVkIGNvbW1lbnQ6IG1pbmlzaWduIHB1YmxpYyBrZXk6IDJDQTdCMzc1MURERDRFQkQKUldTOVR0MGRkYk9uTEE4SUNnNElWZzVEN3QvcFQzczl6Y2NTMUpLSXJYZkxyK2g5azk4UHpRdmcK";

    /// Minisign-shaped text that is not a signature over any of these bytes.
    fn wrong_signature() -> String {
        base64::Engine::encode(
            &base64::engine::general_purpose::STANDARD,
            "untrusted comment: signature from tauri secret key\nRUS9Tt0ddbOnLNz8OJ/uxxZ7Z2XCvOfOPq+3pf+F4v2tGZJ5EbFqGhRp1yfy/LjrnNmnQ/4DUfL1x6jOSK2E1c1aILtmv0BYWQY=\ntrusted comment: timestamp:1\nO/A8d4Gk1e3G4pVUQFLHwQ4YwjQ8G9x8qz6uJ3+2OMZbjqPjVtKk8jsY0Y3tmBh8gQ7hFbHDd6i5a4Jj+8XCDQ==\n",
        )
    }

    #[test]
    fn rejects_a_signature_that_does_not_verify() {
        assert!(verify_signature(b"not the release", &wrong_signature(), PUBKEY).is_err());
    }

    #[test]
    fn rejects_a_signature_that_is_not_minisign() {
        let signature =
            base64::Engine::encode(&base64::engine::general_purpose::STANDARD, "garbage");
        assert!(verify_signature(b"bytes", &signature, PUBKEY).is_err());
    }

    #[tokio::test]
    async fn a_mismatch_consumes_the_partial_so_it_is_never_resumed_onto() {
        let dir = scratch_dir("verify");
        let url = "https://releases.example/Houston.app.tar.gz";
        let mut partial = PartialDownload::open(&dir, "1.0.0", url).unwrap();
        let sidecar = Sidecar {
            url: url.to_string(),
            validator: None,
            total: Some(15),
        };
        partial.restart(Some(sidecar)).await.unwrap();
        partial.append(b"not the release").await.unwrap();
        partial.settle().await.unwrap();
        let path = partial.path().to_path_buf();

        let failure = admit_release(partial, &wrong_signature(), PUBKEY)
            .await
            .unwrap_err();
        assert_eq!(failure.kind, DownloadFailureKind::Signature);
        assert_eq!(failure.received, 15);
        assert!(!path.exists(), "the unverified bytes are gone");
        assert!(!dir.join("1.0.0.part.json").exists());
    }
}
