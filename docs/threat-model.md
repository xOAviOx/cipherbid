# Threat model and limitations

This is a local educational implementation, not an independent audit or deployment recommendation.

## Protected properties

| Threat                                             | Mitigation                                                           | Residual limitation                                              |
| -------------------------------------------------- | -------------------------------------------------------------------- | ---------------------------------------------------------------- |
| Guess hidden bids                                  | Browser CSPRNG 256-bit salts                                         | Compromised browser/file access reveals the secret               |
| Copy a commitment to another wallet                | Chain, contract, auction, and bidder domain separation               | A copied hash can still be committed uselessly and lose its bond |
| Change a committed amount                          | One immutable digest and exact reveal validation                     | Lost or invalid secrets forfeit B                                |
| Reveal for someone else                            | Commitment comparison uses `msg.sender`                              | Compromised wallet can reveal publicly                           |
| Reveal twice or consume opportunity with bad input | Revert-before-state-change; revealed flag                            | Reveal deadline still applies                                    |
| Influence tie through reveal order                 | Compare stored commit sequence                                       | Transaction inclusion order determines that sequence             |
| Inflate or steal accounting                        | Exact deposit, once-only flags, deterministic beneficiaries          | Gas fees are not refundable                                      |
| Recipient DoS                                      | No transfers in finalize/settle; alternate recipient pull claims     | Beneficiary must eventually perform a claim                      |
| Reentrancy                                         | Checks-effects-interactions and OpenZeppelin guard on transfer paths | Malicious NFT semantics are outside standard ERC-721 guarantees  |
| Finalization gas DoS                               | No bidder iteration, no external call                                | Individual bidders still need separate processing transactions   |
| Unauthorized asset/credit claim                    | Caller beneficiary checks                                            | No key-loss recovery authority                                   |
| Unsolicited NFTs                                   | Expected safe-transfer context                                       | Unsafe transfers may permanently strand assets                   |
| Forced ETH                                         | Liability counters, balance >= liability                             | Surplus has no recovery path                                     |
| Stale chain/reset data                             | Deployment identity and block-hash checks, anchored index            | Backups cannot restore reset chain state                         |
| RPC error payload leaks                            | UI emits safe generic transaction errors                             | A malicious wallet/RPC/browser is not a trusted privacy boundary |

## Deliberate visibility

Before reveal: bidder address, deposit amount C+B, collateral upper bound C, transaction timing, participation, reserve, bond, deadlines, NFT and seller are public. Equal deposits avoid **direct** bid disclosure through the deposit amount; they do not conceal social information, funding patterns, accounts, or network activity.

On reveal: amount and salt are public in calldata; amount is also in the reveal event and contract state. Even a reverted reveal transaction may disclose its arguments. The UI does not claim permanent bid confidentiality, anonymous bidding, transaction-ordering immunity, or FHE.

An auction seller can participate through an unrelated address; the contract can reject only the seller address, not detect shared control. Sybil bids, censorship, bidder collusion, strategic non-reveal, and transaction-ordering influence are economic/system risks, not solved here. Anvil timestamps are controlled by its operator. Public-chain validators also have limited timestamp/inclusion influence.

## Secret custody

Unencrypted IndexedDB is not a vault. Browser extensions, local device users, malware, insecure backups, and cleared storage can compromise or destroy a record. Browser state is persisted before the wallet prompt. Secret-bearing data is never intentionally logged, sent to an application server, analytics, URL, or error reporter. Local RPC and the wallet necessarily receive reveal calldata when you choose to reveal.

Backup import treats files as untrusted: bounded size, schema, integer range, address/bytes validation, digest recomputation, domain matching, bid bounds, and existing onchain digest comparison. It does not execute imported content.

## Deployment and dependency boundary

OpenZeppelin contracts are used unmodified and pinned. Dependency/API references were consulted; the lockfile pins transitive dependencies. This does not eliminate supply-chain risk. Initial setup downloads packages, compiler, and browser binaries; local operation after setup does not.

The local mint faucet is unrestricted and must not be treated as scarcity enforcement. The local RPC exposes unlocked development accounts and must remain on loopback. Development scripts never accept arbitrary networks. No platform owner can seize escrow or bidder funds.

## Remaining limitations

- No independent audit, formal verification, or public-chain production operational review.
- Manual wallet testing depends on an installed injected wallet; automated tests use an isolated test-only EIP-1193 fixture against real Anvil contracts.
- Latest-100 gallery/personal summaries, no notifications outside the open browser, and no distributed index.
- A closed browser cannot reveal for you. Neither calendar reminders nor signing transactions preserve the salt.
- Pending transactions dropped without consuming their nonce may remain pending in the backup record. Check the chain/wallet rather than deleting the secret. Same-session repricing/replacement and consumed nonces are reconciled.
- Public reads depend on the local RPC. A compromised RPC can lie; no light-client verification is implemented.
- Production build may require standard asset caching behavior; deployment metadata must be refreshed after any deployment. Local default Vite serving is configured appropriately.
- Safe-transfer recipient failure is recoverable by choosing another recipient; hostile or nonstandard NFT contract behavior itself cannot be guaranteed recoverable.
