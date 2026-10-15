import { encodeAbiParameters, keccak256, parseEther, formatEther, isAddress, type Address, type Hex } from 'viem'

export const CHAIN_ID = 31338
export const RPC_URL = 'http://127.0.0.1:8546'
export const ZERO = '0x0000000000000000000000000000000000000000'
export type Deployment = {
  chainId: number
  deploymentId: Hex
  auction: Address
  collectible: Address
  blockNumber: string
  blockHash: Hex
}
export type Auction = {
  seller: Address; nft: Address; tokenId: bigint; reserve: bigint; collateral: bigint; bond: bigint
  commitDeadline: bigint; revealDeadline: bigint; commitmentCount: bigint; highestBid: bigint
  highestBidder: Address; highestSequence: bigint; finalized: boolean; cancelled: boolean; claimed: boolean
}
export type Bid = { commitment: Hex; sequence: bigint; amount: bigint; revealed: boolean; settled: boolean }
export type Phase = 'Commit' | 'Reveal' | 'Awaiting finalization' | 'Finalized' | 'Cancelled'
export function phase(a: Pick<Auction, 'cancelled' | 'finalized' | 'commitDeadline' | 'revealDeadline'>, now: bigint): Phase {
  if (a.cancelled) return 'Cancelled'
  if (a.finalized) return 'Finalized'
  if (now < a.commitDeadline) return 'Commit'
  if (now < a.revealDeadline) return 'Reveal'
  return 'Awaiting finalization'
}
export function commitment(chainId: number, contract: Address, auctionId: bigint, bidder: Address, amount: bigint, salt: Hex): Hex {
  return keccak256(encodeAbiParameters(
    [{type:'uint256'}, {type:'address'}, {type:'uint256'}, {type:'address'}, {type:'uint256'}, {type:'bytes32'}],
    [BigInt(chainId), contract, auctionId, bidder, amount, salt],
  ))
}
export function exactETH(value: string): bigint {
  if (!/^(0|[1-9]\d*)(\.\d{1,18})?$/.test(value)) throw new Error('Use a positive decimal with at most 18 decimal places.')
  const result = parseEther(value)
  if (result >= 2n ** 256n) throw new Error('Amount exceeds uint256.')
  return result
}
export const eth = (amount: bigint) => formatEther(amount)
export const short = (address: string) => `${address.slice(0,6)}…${address.slice(-4)}`
export const same = (a: string | undefined, b: string | undefined) => !!a && !!b && a.toLowerCase() === b.toLowerCase()
export function randomSalt(): Hex {
  const bytes = crypto.getRandomValues(new Uint8Array(32))
  return `0x${Array.from(bytes, b => b.toString(16).padStart(2,'0')).join('')}`
}

export const statuses = ['saved', 'pending', 'confirmed', 'rejected', 'reverted', 'replaced', 'cancelled'] as const
export type Secret = {
  schemaVersion: 1
  chainId: number
  deploymentId: Hex
  contract: Address
  auctionId: string
  bidder: Address
  amount: string
  salt: Hex
  commitment: Hex
  status: typeof statuses[number]
  transactionHash?: Hex
}
export function secretKey(s: Pick<Secret,'chainId'|'deploymentId'|'contract'|'auctionId'|'bidder'>): string {
  return `${s.chainId}:${s.deploymentId.toLowerCase()}:${s.contract.toLowerCase()}:${s.auctionId}:${s.bidder.toLowerCase()}`
}
const bytes32 = (x: unknown): x is Hex => typeof x === 'string' && /^0x[0-9a-fA-F]{64}$/.test(x)
const integer = (x: unknown): x is string => typeof x === 'string' && /^(0|[1-9]\d*)$/.test(x) && x.length <= 78 && BigInt(x) < 2n**256n
export function parseBackup(text: string): Secret {
  if (text.length > 16384) throw new Error('Backup is too large.')
  const x: unknown = JSON.parse(text)
  if (!x || typeof x !== 'object') throw new Error('Invalid backup.')
  const s = x as Record<string,unknown>
  if (s.schemaVersion !== 1 || !Number.isSafeInteger(s.chainId) || Number(s.chainId)<=0 ||
      !bytes32(s.deploymentId) || typeof s.contract !== 'string' || !isAddress(s.contract) ||
      typeof s.bidder !== 'string' || !isAddress(s.bidder) || !integer(s.auctionId) || BigInt(s.auctionId)===0n ||
      !integer(s.amount) || !bytes32(s.salt) || !bytes32(s.commitment) ||
      !statuses.includes(s.status as Secret['status']) || (s.transactionHash !== undefined && !bytes32(s.transactionHash))) {
    throw new Error('Invalid backup schema.')
  }
  const result = s as Secret
  if (commitment(result.chainId,result.contract,BigInt(result.auctionId),result.bidder,BigInt(result.amount),result.salt) !== result.commitment.toLowerCase()) {
    throw new Error('Backup commitment does not match its contents.')
  }
  return result
}
export function validateContext(s: Secret, d: Deployment, bidder: Address, auctionId?: bigint) {
  if (s.chainId !== d.chainId || !same(s.deploymentId,d.deploymentId) || !same(s.contract,d.auction) ||
      !same(s.bidder,bidder) || (auctionId !== undefined && BigInt(s.auctionId)!==auctionId)) {
    throw new Error('Backup belongs to a different wallet, chain, auction, or deployment.')
  }
}
export function exportBackup(s: Secret): string { return JSON.stringify(s,null,2) }
