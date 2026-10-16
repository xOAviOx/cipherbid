import {
  createPublicClient,
  defineChain,
  http,
  TransactionReceiptNotFoundError,
  type Address,
  type Hex,
} from 'viem'
import { createConfig } from 'wagmi'
import { injected } from 'wagmi/connectors'
import { auctionAbi } from '../../../packages/shared/src/generated'
import { CHAIN_ID, RPC_URL, type Deployment, same } from '../../../packages/shared/src/index'
import { db } from './storage'
export const localChain = defineChain({
  id: CHAIN_ID,
  name: 'CipherBid Local',
  nativeCurrency: { name: 'Development ETH', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: [RPC_URL] } },
})
export const config = createConfig({
  chains: [localChain],
  connectors: [injected()],
  transports: { [CHAIN_ID]: http(RPC_URL) },
  multiInjectedProviderDiscovery: false,
})
export const publicClient = createPublicClient({
  chain: localChain,
  ccipRead: false,
  transport: http(RPC_URL, { timeout: 10000 }),
})

// Keep the sender/nonce captured while the original transaction is still known.
// A replacement may have mined before a generic receipt watcher fetched the original hash.
export async function waitLocalReceipt(
  hash: Hex,
  sender: Address,
  nonce: number,
  fromBlock: bigint,
  onReplacement: (hash: Hex) => Promise<void>,
) {
  const timeout = Date.now() + 120000
  let cursor = fromBlock
  while (Date.now() < timeout) {
    try {
      return await publicClient.getTransactionReceipt({ hash })
    } catch (error) {
      if (!(error instanceof TransactionReceiptNotFoundError)) throw error
    }
    const head = await publicClient.getBlockNumber({ cacheTime: 0 })
    // Bound work per poll, including when many local blocks were mined during the wallet prompt.
    for (let scanned = 0; cursor <= head && scanned < 20; cursor++, scanned++) {
      const block = await publicClient.getBlock({ blockNumber: cursor, includeTransactions: true })
      const replacement = block.transactions.find(
        (tx) => same(tx.from, sender) && tx.nonce === nonce,
      )
      if (replacement) {
        if (replacement.hash !== hash) await onReplacement(replacement.hash)
        return publicClient.getTransactionReceipt({ hash: replacement.hash })
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 1000))
  }
  throw new Error('Transaction confirmation timed out.')
}
export type IndexedEvent = {
  name: string
  auctionId?: bigint
  bidder?: string
  amount?: bigint
  refund?: bigint
  recipient?: string
  beneficiary?: string
  forfeitedBond?: bigint
  blockNumber: bigint
  transactionHash: Hex
  logIndex: number
}
type Cache = { through: bigint; hash: Hex; events: IndexedEvent[] }
const cacheKey = (d: Deployment) => `${d.chainId}:${d.deploymentId}:${d.auction}`.toLowerCase()
export async function verifiedDeployment(): Promise<Deployment> {
  const response = await fetch('/deployment.json', { cache: 'no-store' })
  if (!response.ok) throw new Error('No local deployment. Run pnpm deploy:local and pnpm seed.')
  const d = (await response.json()) as Deployment
  if (d.chainId !== CHAIN_ID || (await publicClient.getChainId()) !== CHAIN_ID)
    throw new Error('RPC chain is not CipherBid Local.')
  try {
    const [identity, block] = await Promise.all([
      publicClient.readContract({
        address: d.auction,
        abi: auctionAbi,
        functionName: 'deploymentId',
      }),
      publicClient.getBlock({ blockNumber: BigInt(d.blockNumber) }),
    ])
    if (!same(identity, d.deploymentId) || block.hash !== d.blockHash) throw new Error('stale')
  } catch {
    throw new Error(
      'Deployment is stale or the chain was reset. Redeploy and reload. Old secrets remain separate.',
    )
  }
  return d
}
export async function rebuildIndex(d: Deployment) {
  await db('events', 'readwrite', (s) => s.delete(cacheKey(d)))
}
export async function indexEvents(d: Deployment, head: bigint) {
  const key = cacheKey(d)
  let cache = await db<Cache | undefined>('events', 'readonly', (s) => s.get(key))
  if (cache) {
    try {
      if (
        cache.through > head ||
        (await publicClient.getBlock({ blockNumber: cache.through })).hash !== cache.hash
      )
        cache = undefined
    } catch {
      cache = undefined
    }
  }
  let from = cache ? cache.through + 1n : BigInt(d.blockNumber)
  const events = cache?.events ?? []
  let through = cache?.through ?? BigInt(d.blockNumber) - 1n
  for (let page = 0; page < 10 && from <= head; page++) {
    const to = from + 499n < head ? from + 499n : head
    const logs = await publicClient.getContractEvents({
      address: d.auction,
      abi: auctionAbi,
      fromBlock: from,
      toBlock: to,
      strict: true,
    })
    for (const log of logs) {
      const args = log.args as Record<string, unknown>
      events.push({
        name: log.eventName,
        auctionId: args.auctionId as bigint | undefined,
        bidder: args.bidder as string | undefined,
        amount: (args.amount ?? args.winningBid) as bigint | undefined,
        refund: args.refund as bigint | undefined,
        forfeitedBond: args.forfeitedBond as bigint | undefined,
        recipient: args.recipient as string | undefined,
        beneficiary: args.beneficiary as string | undefined,
        blockNumber: log.blockNumber,
        transactionHash: log.transactionHash,
        logIndex: log.logIndex,
      })
    }
    through = to
    from = to + 1n
  }
  if (through >= BigInt(d.blockNumber)) {
    const hash = (await publicClient.getBlock({ blockNumber: through })).hash!
    await db('events', 'readwrite', (s) => s.put({ through, hash, events }, key))
  }
  return { events, complete: through >= head, through }
}
