# Verification record

Verified locally on macOS arm64, Node 22.22.0, pnpm 11.6.0, Foundry 1.7.1, Solidity 0.8.37, and Playwright 1.64.1 with Chromium 156.0.8078.4.

## Checks

| Command                                    | Result                                                                                                     |
| ------------------------------------------ | ---------------------------------------------------------------------------------------------------------- |
| `pnpm install`                             | Installed exact pinned packages; lockfile generated                                                        |
| `pnpm install --offline --frozen-lockfile` | Passed using the installed package cache without network access                                            |
| `pnpm contracts:build`                     | Contracts compiled; shared ABIs generated from actual artifacts                                            |
| `pnpm test`                                | 18 Foundry tests and 17 Vitest cases passed                                                                |
| Foundry fuzz                               | 256 refund-conservation cases passed                                                                       |
| Foundry invariant                          | 128 runs, depth 64, 8,192 handler actions; zero reverts                                                    |
| Finalization bound                         | 200 committed bidders; finalization below 100,000 gas                                                      |
| `pnpm typecheck`                           | Strict application, scripts, shared code, and browser-test types passed                                    |
| `pnpm build`                               | Production frontend built successfully                                                                     |
| `pnpm test:e2e`                            | Seven clean-chain browser tests passed against real local contracts                                        |
| `pnpm demo`                                | Acceptance, reverse-reveal tie, no valid reveals, and no commitments passed                                |
| License notices                            | Collected notices for 121 pinned installed packages; production build includes notices and project license |

## Real-chain browser coverage

The test suite starts fresh loopback Anvil and Vite processes; it refuses occupied ports. All non-local browser HTTP traffic is blocked in the fixture.

- Seller NFT escrow and UI creation with separate approval/creation transactions.
- A browser-generated secret, local persistence, downloadable backup, and actual commit deposit.
- Solidity/TypeScript commitment parity against the deployed `commitmentFor`.
- Three bidders; two valid reveals, one non-reveal.
- IndexedDB/local-storage clearing, missing-secret warning, wrong-onchain-backup rejection, correct backup import, and reveal.
- Finalization, winner excess collateral allocation and withdrawal, loser/non-revealer processing, seller proceeds, and winner NFT collection. Zero liabilities and zero remaining contract ETH after the acceptance auction.
- Wallet rejection preserves the secret.
- Pending transaction disables resubmission. A real same-nonce cancellation/replacement preserves the record, updates status, and allows successful retry.
- Wrong-network warning and write disablement, then wallet network switching.
- A discovered wallet restored on page load while on another network enables bidding immediately after switching to CipherBid Local, without a reload.
- EIP-6963 wallet discovery with a restored Phantom-like wallet: Phantom is disabled and offered no network switch, the user switches to a local-network wallet, and Phantom stays disconnected after a reload and after **Disconnect wallet**.
- Public gallery without a connected wallet, keyboard skip link, privacy explanation.
- Mobile viewport with no horizontal overflow or artwork/detail overlap.
- Real chain reset, stale deployment rejection, fresh deployment identity, and old-secret isolation.
- The terminal demo is additionally executed against the fresh redeployment and all four scenario outcomes asserted.

Desktop and mobile captures are in `docs/screenshots/`. They use local development accounts and no real private data.

## Warnings and limitations

- Forge warns about `selfdestruct` in the **forced-ETH test helper only**. It is intentionally used to demonstrate surplus accounting under Cancun semantics. Production contracts do not use it.
- Forge’s timestamp lint flags the deliberately timestamp-based phase checks. Chain-time/inclusion manipulation is a documented limitation.
- Vite warns that the main bundled JavaScript exceeds 500 kB before gzip. It is a local, self-contained bundle; the warning does not prevent a successful production build.
- Manual interaction with a separately installed wallet extension was not automated. The tested wallet is an isolated EIP-1193 fixture backed by real unlocked Anvil accounts, not mocked transactions. The Phantom stand-in follows Phantom’s documented lack of custom-network support; the real Phantom, MetaMask, and Rabby extensions were not exercised.
- This is not a formal proof or an independent security audit. No mainnet-readiness claim is made.
