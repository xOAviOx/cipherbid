# Accounting model

Each bidder deposits exactly `D = C + B`. Gas fees are separate and are never auction credit.

## Four separate operations

1. **Finalize:** record the immutable winner and credit the seller the highest valid bid `W`, once. No ETH/NFT transfer and no bidder loop.
2. **Settle bidder:** anyone can process one committed bidder after finalization. Mark settled before allocating credits. Beneficiaries are fixed; the caller cannot select them.
3. **Withdraw:** the beneficiary withdraws its entire global credit to a nonzero alternate address. Credit, total credits, liabilities, and withdrawal totals update before the ETH call. Reentrancy is rejected; failure reverts these effects.
4. **Claim NFT:** only the final winner, or seller after no sale/cancellation, selects a nonzero recipient. Mark claimed before `safeTransferFrom`; failed receipt rolls back the mark. NFT receipt never gates monetary allocation.

Cancellation has no deposits and permits immediate seller NFT reclaim.

| Bidder result        | Bidder credit on processing |          Seller credit on processing |
| -------------------- | --------------------------: | -----------------------------------: |
| Winner, valid reveal |                 `C - W + B` | `0` (W was credited at finalization) |
| Other valid revealer |                     `C + B` |                                  `0` |
| No valid reveal      |                         `C` |                                  `B` |

A copied commitment or invalid amount can never become a valid reveal, so it is economically a non-reveal. A failed attempt does not mark revealed and can be corrected before the deadline.

## Counters and backing

- `totalDeposited`: cumulative successful commit deposits.
- `totalWithdrawn`: cumulative successful ETH withdrawals.
- `totalLiability`: every deposited wei not yet withdrawn, including unallocated deposits.
- `totalCredits`: allocated, unwithdrawn credit.
- `credits[address]`: global beneficiary credit across all auctions.

Always:

```text
totalDeposited = totalWithdrawn + totalLiability
totalCredits = sum(credits[beneficiary])
totalCredits <= totalLiability <= address(auction).balance
```

Before finalization, every unsettled bid contributes `C+B` to unallocated liabilities. After a sale is finalized, the unsettled winner contributes `C+B-W`, because W is now seller credit. All other unsettled bidders still contribute `C+B`, including an unprocessed non-revealer whose B has not yet moved to seller credit.

```text
totalLiability = totalCredits + sum(unallocated liabilities)
```

Thus the seller may withdraw W before winner processing without causing an insolvency: W is already excluded from the winner’s future refund.

Forced ETH increases balance without changing any counter. The backing check uses `>=`, never balance equality. Surplus is stranded: there is no administrative surplus sweep.

## Acceptance arithmetic

For R=1 ETH, C=5 ETH, B=0.1 ETH, and deposits from three bidders:

```text
Deposits:                       15.3 ETH
Winner (3 ETH bid) refund:        2.1 ETH
Loser (2 ETH bid) refund:         5.1 ETH
Non-revealer (4 ETH hidden) refund:5.0 ETH
Seller winning bid + bond:       3.1 ETH
Total beneficiary credits:      15.3 ETH
```

Each monetary effect is guarded either by the single finalization flag or that bidder’s single settled flag. Withdrawal empties only the caller’s credit. Duplicate claims/withdrawals revert. No owner can seize funds.

## Invariant campaign

The handler creates up to 12 auctions, varies chain time, and uses four independent bidder addresses. It exercises commitments, arbitrary reveal order, repeated reveal/settlement/claim attempts, withdrawals, unauthorized asset claims, and forced ETH. Ghost counters independently track deposits, payouts, reveal/settlement successes, and claims.

After every sequence the tests reconcile all beneficiary credits, unallocated liabilities, deposits, payouts, forced surplus, NFT ownership, and at-most-once actions. A separate 200-bidder test bounds finalization below 100,000 gas. O(1) structure does not depend on that empirical bidder count.
