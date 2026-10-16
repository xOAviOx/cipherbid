import { describe, it, expect } from 'vitest'
import {
  commitment,
  exactETH,
  eth,
  phase,
  randomSalt,
  parseBackup,
  exportBackup,
  validateContext,
  secretKey,
  type Secret,
  type Deployment,
} from './index'
const contract = '0x1111111111111111111111111111111111111111'
const bidder = '0x2222222222222222222222222222222222222222'
const salt = `0x${'ab'.repeat(32)}` as const
const identity = `0x${'cd'.repeat(32)}` as const
const d: Deployment = {
  chainId: 31338,
  deploymentId: identity,
  auction: contract,
  collectible: bidder,
  blockNumber: '1',
  blockHash: salt,
}
const secret: Secret = {
  schemaVersion: 1,
  chainId: 31338,
  deploymentId: identity,
  contract,
  auctionId: '1',
  bidder,
  amount: '1234567890123456789',
  salt,
  commitment: commitment(31338, contract, 1n, bidder, 1234567890123456789n, salt),
  status: 'saved',
}

describe('exact money, domains, phases, and secret backups', () => {
  it('parses and formats exact wei without floats', () => {
    expect(exactETH('1.234567890123456789')).toBe(1234567890123456789n)
    expect(exactETH('0.000000000000000001')).toBe(1n)
    expect(eth(1234567890123456789n)).toBe('1.234567890123456789')
    expect(exactETH(eth(2n ** 200n))).toBe(2n ** 200n)
  })
  it.each([
    '1.0000000000000000001',
    '1e3',
    '-1',
    'NaN',
    ' 1',
    '01',
    '0x10',
    '1.',
    '',
    '9'.repeat(90),
  ])('rejects inexact or invalid ETH %s', (value) => {
    expect(() => exactETH(value)).toThrow()
  })
  it('changes commitment for each domain component', () => {
    const base = secret.commitment
    expect(commitment(31339, contract, 1n, bidder, BigInt(secret.amount), salt)).not.toBe(base)
    expect(commitment(31338, bidder, 1n, bidder, BigInt(secret.amount), salt)).not.toBe(base)
    expect(commitment(31338, contract, 2n, bidder, BigInt(secret.amount), salt)).not.toBe(base)
    expect(commitment(31338, contract, 1n, contract, BigInt(secret.amount), salt)).not.toBe(base)
    expect(commitment(31338, contract, 1n, bidder, 1n, salt)).not.toBe(base)
  })
  it('uses 32 random bytes', () => {
    expect(randomSalt()).toMatch(/^0x[0-9a-f]{64}$/)
    expect(randomSalt()).not.toBe(randomSalt())
  })
  it('round trips the complete reveal record with exact amount', () => {
    const full = {
      ...secret,
      status: 'replaced' as const,
      transactionHash: salt,
      transactionNonce: '4',
    }
    expect(parseBackup(exportBackup(full))).toEqual(full)
  })
  it('rejects malformed schema, oversized and tampered backups', () => {
    for (const patch of [
      { schemaVersion: 2 },
      { salt: '0x00' },
      { amount: '1.2' },
      { amount: '-1' },
      { amount: '1' },
      { auctionId: '0' },
      { status: 'mystery' },
      { transactionNonce: '-1' },
    ]) {
      expect(() => parseBackup(JSON.stringify({ ...secret, ...patch }))).toThrow()
    }
    expect(() => parseBackup(' '.repeat(20000))).toThrow()
    expect(() => parseBackup('{"schemaVersion":')).toThrow()
  })
  it('isolates wallet, auction, chain, contract, and deployment', () => {
    expect(() => validateContext(secret, d, bidder, 1n)).not.toThrow()
    expect(() => validateContext(secret, d, contract)).toThrow()
    expect(() => validateContext(secret, d, bidder, 2n)).toThrow()
    expect(() => validateContext(secret, { ...d, chainId: 1 }, bidder)).toThrow()
    expect(() => validateContext(secret, { ...d, auction: bidder }, bidder)).toThrow()
    expect(() => validateContext(secret, { ...d, deploymentId: salt }, bidder)).toThrow()
    const patches: Partial<Secret>[] = [
      { bidder: contract },
      { auctionId: '2' },
      { chainId: 1 },
      { contract: bidder },
      { deploymentId: salt },
    ]
    for (const patch of patches) {
      expect(secretKey({ ...secret, ...patch })).not.toBe(secretKey(secret))
    }
    expect(secretKey({ ...secret, bidder: bidder.toUpperCase() as typeof bidder })).toBe(
      secretKey(secret),
    )
  })
  it('handles the exact phase boundaries using chain time', () => {
    const a = { commitDeadline: 100n, revealDeadline: 200n, cancelled: false, finalized: false }
    expect(phase(a, 99n)).toBe('Commit')
    expect(phase(a, 100n)).toBe('Reveal')
    expect(phase(a, 199n)).toBe('Reveal')
    expect(phase(a, 200n)).toBe('Awaiting finalization')
    expect(phase({ ...a, finalized: true }, 200n)).toBe('Finalized')
    expect(phase({ ...a, cancelled: true, finalized: true }, 10n)).toBe('Cancelled')
  })
})
