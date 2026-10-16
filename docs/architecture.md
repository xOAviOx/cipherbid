# Architecture

## Trust boundaries

The browser talks directly to one loopback Anvil RPC. There is no application server, database service, indexer service, hosted imagery, third-party script, analytics SDK, cloud storage, or external error reporting.

`CipherBid` is the authoritative auction and accounting state machine. `LocalCollectible` is an intentionally unrestricted development mint faucet with onchain SVG metadata. Neither is upgradeable. CipherBid has no owner, privileged withdrawal, fee collector, platform token, arbitration, or rescue mechanism.

## Commitment

Solidity:

```solidity
keccak256(abi.encode(block.chainid, address(this), auctionId, bidder, bidAmount, salt))
```

TypeScript uses `encodeAbiParameters` with precisely:

```text
uint256, address, uint256, address, uint256, bytes32
```

There is no packed encoding. Browser amounts are parsed to integer wei without floating-point arithmetic. Salts are Web Crypto `getRandomValues(new Uint8Array(32))`. Commit calldata/events contain the digest, not the amount or salt. Reveal authenticates `msg.sender`; successful reveal sets an irreversible per-bidder flag. Invalid attempts revert before setting it.

The stored deployment identity is an extra local-storage/reset boundary. It is not an extra field in the specified commitment formula.

## NFT intake

Creation validates standard ERC-721 interface support and seller ownership, writes auction parameters, establishes an expected `(NFT, seller, token)` transfer context, and calls `safeTransferFrom`. The receiver checks token sender, operator, from, token ID, and a single-use receipt flag. Creation verifies final ownership; failures atomically roll back the auction and NFT transfer.

Unsolicited safe transfers revert. Unsafe direct transfers cannot invoke the receiver and may strand tokens. No rescue method is deliberately provided because a generic admin recovery power can compromise escrow. Arbitrary malicious ERC-721 implementations remain a trust risk; use the supplied local collection.

## Browser state

- Wagmi handles the injected wallet, connection events, account changes, and chain switching.
- Viem performs exact encoding, public reads, transaction simulations, local submissions, receipt monitoring, and replacement handling.
- Receipt monitoring captures the original sender and nonce, then scans at most 20 new local blocks per one-second poll for a same-nonce replacement. It does not depend on looking up a dropped original hash after cancellation. RPC errors/timeouts retain the secret. Offchain CCIP reads are disabled.
- TanStack Query refreshes public snapshots every three seconds. Auction and bid reads use a single block number. An RPC error is visible and disables writes. Every transaction revalidates deployment identity and the wallet chain, then simulates against current state. The contract remains the final phase/authorization check.
- IndexedDB database `cipherbid-v1` has distinct `secrets` and `events` stores.
- A secret key is `(chainId, deploymentId, contract, auctionId, bidder)`, normalized case-insensitively.
- Wallet rejection, reverted receipts, cancellation/replacement, pending receipts, and timeouts retain the record. Hashes are saved immediately after submission. A nonce enables recognition of a consumed replacement after reload. Onchain commitment matching reconciles confirmed records.
- Account or network changes never relabel or migrate a secret. Backups validate their full domain and commitment.

The interface does not add a local signer or time control. The EIP-1193 unlocked-account adapter exists only in Playwright’s initialization script.

## Local event index

Each deployment has its own cache key. At most ten RPC scans of 500 blocks run per snapshot refresh. The scanner persists an inclusive block cursor and its block hash with decoded events. A changed/missing anchor or shorter head causes a rescan. The user can rebuild only the event cache without affecting secrets.

Direct contract reads, not cached events, decide current eligibility and result. Events provide public reveal lists, bidder discovery for permissionless processing, withdrawal records, and actual transaction hashes. A partially indexed UI says it is scanning; rebuilding does not change contract state.

The gallery and personal summaries intentionally cap at the latest 100 auctions for a bounded local demo. Existing details only open for these visible auctions. This is a local-demo scale constraint, not an onchain limitation. A long-lived production application would need paginated discovery and a stronger chain-reorg policy.

## Artifacts and deployment reset

`pnpm contracts:build` invokes Forge and exports ABIs from `contracts/out`. `deploy:local` deploys the actual bytecode with a fresh random 32-byte constructor identity and writes the receipt block/hash, addresses, and chain ID into `apps/web/public/deployment.json`.

The frontend fetches deployment metadata with `no-store`. It verifies the immutable identity and original deployment block hash against chain state. A reset or missing code stops actions until redeployment. A new identity namespaces old event caches away without deleting old reveal secrets.

## Local-only tooling

All mutating development-script commands reject non-loopback hosts, non-HTTP schemes, credentials in URLs, a port other than 8546, non-Anvil clients, and chain IDs other than 31338. Commands using an existing deployment additionally verify its identity and receipt block hash. No private keys are read or printed: transactions use local unlocked accounts through the guarded RPC.

`deploy:local` is the initial bootstrap and therefore has no prior deployment identity to verify. `pnpm chain` intentionally starts a fresh automining local chain with no fork; stopping it discards chain data.
