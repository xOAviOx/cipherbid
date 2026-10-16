import { test, expect, type Page } from '@playwright/test'
import { readFile, mkdir } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import {
  createPublicClient,
  createWalletClient,
  defineChain,
  http,
  type Address,
  type Hex,
} from 'viem'
import { auctionAbi, collectibleAbi } from '../../packages/shared/src/generated'
import {
  CHAIN_ID,
  RPC_URL,
  commitment,
  parseBackup,
  type Deployment,
  type Secret,
} from '../../packages/shared/src/index'

const chain = defineChain({
  id: CHAIN_ID,
  name: 'CipherBid Local',
  nativeCurrency: { name: 'ETH', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: [RPC_URL] } },
})
const client = createPublicClient({ chain, transport: http(RPC_URL) })
let d: Deployment, accounts: Address[]
async function rpc(method: string, params: unknown[] = []): Promise<unknown> {
  const response = await fetch(RPC_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  })
  const json = (await response.json()) as { result: unknown; error?: unknown }
  if (json.error) throw new Error(`Test RPC ${method} failed`)
  return json.result
}
const wallet = (index: number) =>
  createWalletClient({ chain, account: accounts[index]!, transport: http(RPC_URL) })
async function mined(hash: Hex) {
  expect((await client.waitForTransactionReceipt({ hash })).status).toBe('success')
}
async function newAuction() {
  const id =
    (await client.readContract({
      address: d.collectible,
      abi: collectibleAbi,
      functionName: 'nextTokenId',
    })) + 1n
  await mined(
    await wallet(0).writeContract({
      address: d.collectible,
      abi: collectibleAbi,
      functionName: 'mint',
      args: [accounts[0]!],
    }),
  )
  await mined(
    await wallet(0).writeContract({
      address: d.collectible,
      abi: collectibleAbi,
      functionName: 'approve',
      args: [d.auction, id],
    }),
  )
  const now = (await client.getBlock()).timestamp
  await mined(
    await wallet(0).writeContract({
      address: d.auction,
      abi: auctionAbi,
      functionName: 'createAuction',
      args: [d.collectible, id, 10n ** 18n, 5n * 10n ** 18n, 10n ** 17n, now + 600n, now + 1200n],
    }),
  )
  return client.readContract({ address: d.auction, abi: auctionAbi, functionName: 'auctionCount' })
}
async function advanceTo(timestamp: bigint) {
  // Test-only time control; validate deployment before touching the local clock.
  expect(await client.getChainId()).toBe(CHAIN_ID)
  expect(
    await client.readContract({
      address: d.auction,
      abi: auctionAbi,
      functionName: 'deploymentId',
    }),
  ).toBe(d.deploymentId)
  await rpc('evm_setNextBlockTimestamp', [Number(timestamp)])
  await rpc('evm_mine')
}
async function inject(page: Page, index = 1, network = CHAIN_ID) {
  // EIP-1193 local-test fixture. No keys and no test wallet code in the application bundle.
  await page.addInitScript(
    ({ account, network, rpcURL }) => {
      const handlers = new Map<string, Set<(...args: unknown[]) => void>>()
      let currentChain = network
      let reject = false
      const emit = (event: string, ...args: unknown[]) =>
        handlers.get(event)?.forEach((fn) => fn(...args))
      const provider = {
        isMetaMask: true,
        on(event: string, fn: (...args: unknown[]) => void) {
          if (!handlers.has(event)) handlers.set(event, new Set())
          handlers.get(event)!.add(fn)
        },
        removeListener(event: string, fn: (...args: unknown[]) => void) {
          handlers.get(event)?.delete(fn)
        },
        async request({ method, params = [] }: { method: string; params?: unknown[] }) {
          if (method === 'eth_chainId') return `0x${currentChain.toString(16)}`
          if (method === 'eth_accounts' || method === 'eth_requestAccounts') return [account]
          if (method === 'wallet_switchEthereumChain') {
            currentChain = Number((params[0] as { chainId: string }).chainId)
            emit('chainChanged', `0x${currentChain.toString(16)}`)
            return null
          }
          if (method === 'wallet_addEthereumChain' || method === 'wallet_requestPermissions')
            return null
          if (method === 'wallet_getPermissions') return []
          if (method === 'eth_sendTransaction') {
            if (reject) {
              reject = false
              throw Object.assign(new Error('User rejected request'), { code: 4001 })
            }
            if (currentChain !== 31338) throw new Error('Wrong network')
            if ((params[0] as { from: string }).from.toLowerCase() !== account.toLowerCase())
              throw new Error('Unexpected signer')
          }
          const response = await fetch(rpcURL, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
          })
          const json = await response.json()
          if (json.error)
            throw Object.assign(new Error('Local wallet RPC failed'), { code: json.error.code })
          return json.result
        },
      }
      Object.assign(window, {
        ethereum: provider,
        __rejectNext: () => {
          reject = true
        },
        __wrongNetwork: () => {
          currentChain = 1
          emit('chainChanged', '0x1')
        },
      })
    },
    { account: accounts[index]!, network, rpcURL: RPC_URL },
  )
}
async function connect(page: Page) {
  await page.getByRole('button', { name: 'Connect wallet', exact: true }).click()
  await page.getByRole('button', { name: /^Connect Injected$/ }).click()
  await expect(page.getByRole('dialog')).not.toBeVisible()
}
async function openAuction(page: Page, id: bigint) {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'The collection' })).toBeVisible()
  // The token caption and auction number are real chain data, not a hard-coded fixture card.
  const count = await client.readContract({
    address: d.auction,
    abi: auctionAbi,
    functionName: 'auctionCount',
  })
  await page
    .locator('.auction-card')
    .nth(Number(id - 1n - (count > 100n ? count - 100n : 0n)))
    .click()
  await expect(
    page.getByText(`CIPHERBID STUDIES / AUCTION ${id.toString().padStart(3, '0')}`, {
      exact: true,
    }),
  ).toBeVisible()
}
test.beforeAll(async () => {
  d = JSON.parse(
    await readFile(new URL('../../apps/web/public/deployment.json', import.meta.url), 'utf8'),
  )
  expect(await client.getChainId()).toBe(CHAIN_ID)
  accounts = (await rpc('eth_accounts')) as Address[]
})
test.beforeEach(async ({ context }) => {
  // The core browser flows must work when all non-local HTTP traffic is blocked.
  await context.route('**/*', (route) => {
    const url = new URL(route.request().url())
    return ['127.0.0.1', 'localhost'].includes(url.hostname) && ['5174', '8546'].includes(url.port)
      ? route.continue()
      : route.abort()
  })
})

test('real contracts: backup recovery, three bidders, accounting and asset collection', async ({
  page,
}) => {
  const id = await newAuction()
  await inject(page)
  await openAuction(page, id)
  await connect(page)
  await page.getByLabel('Your private bid (ETH)').fill('3')
  await page.getByRole('button', { name: 'Prepare & save secret' }).click()
  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Download secret backup' }).click()
  const backup = await download
  const path = test.info().outputPath('sensitive-development-backup.json')
  await backup.saveAs(path)
  const record = parseBackup(await readFile(path, 'utf8'))
  // Solidity/TypeScript parity is checked against the deployed contract, not a mock.
  expect(
    await client.readContract({
      address: d.auction,
      abi: auctionAbi,
      functionName: 'commitmentFor',
      args: [id, accounts[1]!, 3n * 10n ** 18n, record.salt],
    }),
  ).toBe(record.commitment)
  await page.getByRole('checkbox').check()
  await page.getByRole('button', { name: 'Commit 5.1 ETH', exact: true }).click()
  await expect(page.getByText(/Your immutable commitment is onchain/)).toBeVisible()
  for (const index of [2, 3]) {
    const amount = BigInt(index === 2 ? 2 : 4) * 10n ** 18n,
      salt = `0x${String(index).repeat(64)}` as Hex
    await mined(
      await wallet(index).writeContract({
        address: d.auction,
        abi: auctionAbi,
        functionName: 'commit',
        args: [id, commitment(CHAIN_ID, d.auction, id, accounts[index]!, amount, salt)],
        value: 51n * 10n ** 17n,
      }),
    )
  }
  await page.evaluate(async () => {
    localStorage.clear()
    sessionStorage.clear()
    await new Promise<void>((resolve, reject) => {
      const req = indexedDB.open('cipherbid-v1', 1)
      req.onsuccess = () => {
        const db = req.result
        const tx = db.transaction(['secrets', 'events'], 'readwrite')
        tx.objectStore('secrets').clear()
        tx.objectStore('events').clear()
        tx.oncomplete = () => {
          db.close()
          resolve()
        }
        tx.onerror = () => reject(new Error('clear failed'))
      }
    })
  })
  let a = await client.readContract({
    address: d.auction,
    abi: auctionAbi,
    functionName: 'getAuction',
    args: [id],
  })
  await advanceTo(a.commitDeadline)
  await openAuction(page, id)
  await connect(page)
  await expect(page.getByText(/Your reveal secret is missing/)).toBeVisible()
  const wrongSalt = `0x${'f1'.repeat(32)}` as Hex
  const tampered = {
    ...record,
    salt: wrongSalt,
    commitment: commitment(CHAIN_ID, d.auction, id, accounts[1]!, BigInt(record.amount), wrongSalt),
  }
  await page.locator('input[type=file]').setInputFiles({
    name: 'wrong-development-backup.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(tampered)),
  })
  await expect(page.getByRole('alert')).toContainText(
    'Backup does not match the onchain commitment.',
  )
  await page.locator('input[type=file]').setInputFiles(path)
  await expect(
    page.getByText('Backup imported and verified against the onchain commitment.'),
  ).toBeVisible()
  await page.getByRole('button', { name: 'Reveal saved bid' }).click()
  await expect(
    page.getByText('Your bid was revealed successfully. No further reveal is needed.'),
  ).toBeVisible()
  await mined(
    await wallet(2).writeContract({
      address: d.auction,
      abi: auctionAbi,
      functionName: 'reveal',
      args: [id, 2n * 10n ** 18n, `0x${'2'.repeat(64)}`],
    }),
  )
  await advanceTo(a.revealDeadline)
  await page.getByRole('button', { name: 'Finalize auction', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Allocate my refund', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Allocate my refund', exact: true }).click()
  await expect(
    page.getByText('Your refund has been allocated to your monetary credit.'),
  ).toBeVisible()
  await page.getByRole('button', { name: 'Collect NFT', exact: true }).click()
  await expect(page.getByText('Collected', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Go to funds & withdraw' }).click()
  await expect(page.locator('.fund-panel')).toContainText('2.1')
  await page.getByRole('button', { name: 'Withdraw credit', exact: true }).click()
  await expect
    .poll(() =>
      client.readContract({
        address: d.auction,
        abi: auctionAbi,
        functionName: 'credits',
        args: [accounts[1]!],
      }),
    )
    .toBe(0n)
  for (const index of [2, 3])
    await mined(
      await wallet(0).writeContract({
        address: d.auction,
        abi: auctionAbi,
        functionName: 'settleBidder',
        args: [id, accounts[index]!],
      }),
    )
  expect(
    await client.readContract({
      address: d.auction,
      abi: auctionAbi,
      functionName: 'credits',
      args: [accounts[2]!],
    }),
  ).toBe(51n * 10n ** 17n)
  expect(
    await client.readContract({
      address: d.auction,
      abi: auctionAbi,
      functionName: 'credits',
      args: [accounts[3]!],
    }),
  ).toBe(5n * 10n ** 18n)
  expect(
    await client.readContract({
      address: d.auction,
      abi: auctionAbi,
      functionName: 'credits',
      args: [accounts[0]!],
    }),
  ).toBe(31n * 10n ** 17n)
  for (const index of [0, 2, 3])
    await mined(
      await wallet(index).writeContract({
        address: d.auction,
        abi: auctionAbi,
        functionName: 'withdraw',
        args: [accounts[index]!],
      }),
    )
  a = await client.readContract({
    address: d.auction,
    abi: auctionAbi,
    functionName: 'getAuction',
    args: [id],
  })
  expect(
    (
      await client.readContract({
        address: d.collectible,
        abi: collectibleAbi,
        functionName: 'ownerOf',
        args: [a.tokenId],
      })
    ).toLowerCase(),
  ).toBe(accounts[1]!.toLowerCase())
  expect(await client.getBalance({ address: d.auction })).toBe(0n)
  expect(
    await client.readContract({
      address: d.auction,
      abi: auctionAbi,
      functionName: 'totalLiability',
    }),
  ).toBe(0n)
})

test('wallet rejection retains the secret; wrong network blocks writes; mobile remains usable', async ({
  page,
}) => {
  const id = await newAuction()
  await inject(page)
  await page.setViewportSize({ width: 390, height: 844 })
  await openAuction(page, id)
  await connect(page)
  await page.getByLabel('Your private bid (ETH)').fill('2')
  await page.getByRole('button', { name: 'Prepare & save secret' }).click()
  await page.getByRole('button', { name: 'Download secret backup' }).click()
  await page.getByRole('checkbox').check()
  await page.evaluate(() => {
    ;(window as unknown as { __rejectNext: () => void }).__rejectNext()
  })
  await page.getByRole('button', { name: 'Commit 5.1 ETH', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('Wallet request rejected')
  await expect(page.getByText(/Secret saved locally/)).toBeVisible()
  await expect(page.locator('.saved')).toContainText('rejected')
  await page.evaluate(() => {
    ;(window as unknown as { __wrongNetwork: () => void }).__wrongNetwork()
  })
  await expect(page.getByText('Wrong network.', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Commit 5.1 ETH', exact: true })).toBeDisabled()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  )
  const artBounds = await page.locator('.detail .art').boundingBox()
  const infoBounds = await page.locator('.detail-info').boundingBox()
  expect(artBounds && infoBounds && infoBounds.y >= artBounds.y + artBounds.height).toBe(true)
  await mkdir(new URL('../../docs/screenshots/', import.meta.url), { recursive: true })
  await page.screenshot({
    path: new URL('../../docs/screenshots/mobile.png', import.meta.url).pathname,
    fullPage: true,
  })
  await page.getByRole('button', { name: 'Switch network', exact: true }).click()
  await expect(page.getByText('Wrong network.', { exact: true })).not.toBeVisible()
})

test('public explorer, keyboard navigation, privacy rules, and fresh NFT creation', async ({
  page,
}) => {
  await inject(page, 0)
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'The collection' })).toBeVisible()
  await page.locator('.hero').evaluate(async (element) => {
    await Promise.all(
      element.getAnimations({ subtree: true }).map((animation) => animation.finished),
    )
  })
  await expect(page.locator('.hero-object')).toHaveCSS('opacity', '1')
  await mkdir(new URL('../../docs/screenshots/', import.meta.url), { recursive: true })
  await page.screenshot({
    path: new URL('../../docs/screenshots/explorer.png', import.meta.url).pathname,
    fullPage: true,
  })
  await page.keyboard.press('Tab')
  await expect(page.getByRole('link', { name: 'Skip to content' })).toBeFocused()
  await page.getByRole('button', { name: 'How it works' }).click()
  await expect(page.getByText(/This is not anonymous bidding/)).toBeVisible()
  await page.getByRole('button', { name: 'CipherBid home' }).click()
  await page.getByRole('button', { name: 'Create auction', exact: true }).click()
  await connect(page)
  const token =
    (await client.readContract({
      address: d.collectible,
      abi: collectibleAbi,
      functionName: 'nextTokenId',
    })) + 1n
  await mined(
    await wallet(0).writeContract({
      address: d.collectible,
      abi: collectibleAbi,
      functionName: 'mint',
      args: [accounts[0]!],
    }),
  )
  const before = await client.readContract({
    address: d.auction,
    abi: auctionAbi,
    functionName: 'auctionCount',
  })
  await page.getByLabel('Token ID', { exact: true }).fill(token.toString())
  await page.getByRole('button', { name: 'Approve NFT & create auction' }).click()
  await expect
    .poll(() =>
      client.readContract({ address: d.auction, abi: auctionAbi, functionName: 'auctionCount' }),
    )
    .toBe(before + 1n)
  expect(
    (
      await client.readContract({
        address: d.collectible,
        abi: collectibleAbi,
        functionName: 'ownerOf',
        args: [token],
      })
    ).toLowerCase(),
  ).toBe(d.auction.toLowerCase())
})

test('pending and cancelled replacement preserve the secret and allow a safe retry', async ({
  page,
}) => {
  const id = await newAuction()
  await inject(page)
  await openAuction(page, id)
  await connect(page)
  await page.getByLabel('Your private bid (ETH)').fill('2')
  await page.getByRole('button', { name: 'Prepare & save secret' }).click()
  await page.getByRole('button', { name: 'Download secret backup' }).click()
  await page.getByRole('checkbox').check()
  const records = () =>
    page.evaluate(async () => {
      return new Promise<Secret[]>((resolve, reject) => {
        const req = indexedDB.open('cipherbid-v1', 1)
        req.onsuccess = () => {
          const db = req.result
          const read = db.transaction('secrets').objectStore('secrets').getAll()
          read.onsuccess = () => {
            db.close()
            resolve(read.result as Secret[])
          }
          read.onerror = () => reject(new Error('Test record read failed'))
        }
      })
    })
  const original = (await records())[0]!
  await rpc('anvil_setAutomine', [false])
  try {
    await page.getByRole('button', { name: 'Commit 5.1 ETH', exact: true }).click()
    await expect(page.getByRole('status')).toContainText('Transaction pending')
    await expect(page.getByRole('button', { name: 'Commit 5.1 ETH', exact: true })).toBeDisabled()
    const pending = (await records())[0]!
    expect(pending.status).toBe('pending')
    const tx = await client.getTransaction({ hash: pending.transactionHash! })
    const replacement = await wallet(1).sendTransaction({
      to: accounts[1]!,
      value: 0n,
      nonce: tx.nonce,
      gas: 21000n,
      maxFeePerGas: 100_000_000_000n,
      maxPriorityFeePerGas: 10_000_000_000n,
    })
    await rpc('anvil_setAutomine', [true])
    await rpc('evm_mine')
    await mined(replacement)
    await expect(page.getByRole('status')).toContainText(
      'The replacement did not place your commitment.',
    )
    const retained = (await records())[0]!
    expect(retained.status).toBe('cancelled')
    expect(retained.salt).toBe(original.salt)
    expect(retained.commitment).toBe(original.commitment)
    await page.getByRole('button', { name: 'Commit 5.1 ETH', exact: true }).click()
    await expect(page.getByText(/Your immutable commitment is onchain/)).toBeVisible()
  } finally {
    await rpc('anvil_setAutomine', [true])
  }
})

test('chain reset rejects stale deployment and keeps old secrets isolated after redeployment', async ({
  page,
}) => {
  const id = await newAuction()
  await inject(page)
  await openAuction(page, id)
  await connect(page)
  await page.getByLabel('Your private bid (ETH)').fill('2')
  await page.getByRole('button', { name: 'Prepare & save secret' }).click()
  await expect(page.getByRole('button', { name: 'Download secret backup' })).toBeVisible()
  const oldIdentity = d.deploymentId
  expect(await client.getChainId()).toBe(CHAIN_ID)
  // This node was started by Playwright and is discarded at test shutdown.
  await rpc('anvil_reset')
  await page.reload()
  await expect(page.getByRole('alert')).toContainText('Deployment is stale or the chain was reset.')
  await expect(page.getByRole('button', { name: 'Prepare & save secret' })).not.toBeVisible()
  execFileSync('pnpm', ['deploy:local'], {
    cwd: new URL('../..', import.meta.url),
    stdio: 'pipe',
    env: { ...process.env, CIPHERBID_RPC: RPC_URL },
  })
  const next = JSON.parse(
    await readFile(new URL('../../apps/web/public/deployment.json', import.meta.url), 'utf8'),
  ) as Deployment
  expect(next.deploymentId).not.toBe(oldIdentity)
  // The no-store metadata poll discovers the new deployment without a navigation race.
  await expect(page.getByText('A fresh auction room')).toBeVisible()
  await page.getByRole('button', { name: 'Backups', exact: true }).click()
  await expect(page.getByText(/Old or different deployment, retained for recovery/)).toBeVisible()
  const demo = execFileSync('pnpm', ['demo'], {
    cwd: new URL('../..', import.meta.url),
    encoding: 'utf8',
    env: { ...process.env, CIPHERBID_RPC: RPC_URL },
  })
  for (const scenario of ['acceptance', 'reverse-order tie', 'no valid reveal', 'no commitments']) {
    expect(demo).toContain(`PASS ${scenario}:`)
  }
})
