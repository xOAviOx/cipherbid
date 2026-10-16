# Reveal secrets and recovery

## Before committing

1. Enter a bid within the displayed inclusive reserve/collateral bounds.
2. **Prepare & save secret** generates a fresh 32-byte Web Crypto salt, computes the domain-bound commitment, and waits for the IndexedDB write transaction to complete.
3. **Download secret backup** exports the complete record. Keep the file private.
4. Acknowledge that losing the secret may cost the bond.
5. Commit the exact public C+B deposit.

The record includes schema version 1, exact integer-wei amount string, salt, commitment, chain ID, immutable deployment identity, contract, auction ID, wallet, transaction status, and submitted hash/nonce when available. Exporting before submission naturally produces a file without a transaction hash. That file still contains everything required to reveal; import validates the onchain digest directly.

The UI asks you to download; a browser reporting a download does not prove you retained the file. Check that you can find it.

## Rejection, failure, and replacement

Wallet rejection or simulation failure does not delete the record. Retry with the same saved secret. A mined revert retains it with a reverted status. Pending transactions retain the hash; timeouts do not imply failure. Same-session transaction replacements update the monitored hash; matching onchain commitments determine confirmation. Saved nonces help detect consumed replacements after reload.

If a transaction is pending, do not blindly resubmit. Check your wallet. Once the chain confirms the matching digest, the app recognizes the commitment even if the local transaction record was interrupted.

## Another browser or device

This works only while connected to the **same running chain and deployment**:

1. Connect the same bidder wallet to chain 31338.
2. Open **Backup manager**, or the auction with the missing-secret warning.
3. Import the original JSON.
4. CipherBid validates schema and integer ranges, recomputes the hash, checks wallet/chain/contract/auction/deployment, checks bid bounds, and compares the onchain commitment.
5. During reveal, choose **Reveal saved bid** and confirm the transaction.

Importing is not a transaction and does not reveal a bid. A valid file with no matching onchain participation can be retained for retry, but is clearly identified as not yet committed. Conflicting local records are not overwritten.

Using a different device also requires access to the same local blockchain. The default node binds to loopback, so the simplest supported recovery demonstration is a different browser profile on the same machine. Do not expose unlocked Anvil to a network to attempt remote-device recovery.

## When a secret is missing

A public commitment cannot reconstruct a strong random salt. Wallet signatures do not contain it. There is no account support service, master key, password reset, or server backup.

If you miss the reveal deadline, you cannot reveal late. After finalization, anyone can allocate your C refund. B is forfeited to the seller. You never owe the unrevealed bid amount.

## Deletion and reset

The backup manager allows explicit, confirmed deletion of a current-deployment record after the contract says the auction is finalized. Export first if you want an archive. The application does not silently delete failed, old-deployment, or completed records.

A chain reset destroys its old contracts and auctions. Redeployment uses a fresh identity even if deployment addresses repeat. Old files remain distinguishable but cannot create a commitment or recover funds from destroyed chain state. Event-cache rebuild does not clear secrets.

## Sensitive data handling

Both IndexedDB and JSON files are unencrypted. Treat them as sensitive before reveal and as identifying records afterward. Do not attach them to issues, logs, analytics, or screenshots. Browser-test backups use development accounts only, remain in ignored `test-results/`, and should not be published.
