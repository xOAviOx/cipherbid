import { useState, type ReactNode, type FormEvent } from 'react'
import {
  useConnection,
  useConnect,
  useConnectors,
  useDisconnect,
  useSwitchChain,
  useWalletClient,
} from 'wagmi'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import * as Dialog from '@radix-ui/react-dialog'
import {
  ArrowUpRight,
  ArrowRight,
  ArrowLeft,
  LockKeyhole,
  Wallet,
  Plus,
  ShieldCheck,
  Download,
  Upload,
  RefreshCw,
  X,
  Check,
  Clock3,
  Layers,
  BookOpen,
} from 'lucide-react'
import { isAddress, type Address, type Abi } from 'viem'
import { auctionAbi, collectibleAbi } from '../../../packages/shared/src/generated'
import {
  CHAIN_ID,
  ZERO,
  commitment,
  exactETH,
  eth,
  short,
  same,
  phase,
  randomSalt,
  parseBackup,
  validateContext,
  exportBackup,
  secretKey,
  type Secret,
  type Auction,
  type Bid,
  type Deployment,
  type Phase,
} from '../../../packages/shared/src/index'
import {
  publicClient,
  verifiedDeployment,
  indexEvents,
  rebuildIndex,
  waitLocalReceipt,
  type IndexedEvent,
} from './chain'
import { allSecrets, saveSecret, deleteSecret, downloadSecret } from './storage'

type Row = { id: bigint; auction: Auction; bid?: Bid }
type View = 'explore' | 'create' | 'commitments' | 'funds' | 'backups' | 'rules'
const date = (t: bigint) =>
  new Date(Number(t) * 1000).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
const title = (id: bigint) =>
  ['Orbital Form', 'Quiet Intersections', 'Violet Assembly', 'A Study in Balance'][
    Number((id - 1n) % 4n)
  ]
function failure(error: unknown): string {
  // Never surface RPC payloads, calldata, or raw wallet errors: reveal errors can contain the secret.
  const text = String(error).toLowerCase()
  if (text.includes('reject') || text.includes('4001') || text.includes('denied'))
    return 'Wallet request rejected. Your saved secret is still safe here. You can retry.'
  if (text.includes('insufficient')) return 'Insufficient development ETH for the deposit and gas.'
  if (text.includes('timeout') || text.includes('timed out'))
    return 'Confirmation timed out. The transaction may still be pending. Refresh before retrying; keep your backup.'
  return 'Transaction failed or conditions changed. Refresh the chain state, check the phase and wallet, then retry. Your secret was not deleted.'
}
function Pill({ value }: { value: Phase }) {
  return (
    <span className={`pill ${value === 'Commit' ? 'live' : value === 'Reveal' ? 'reveal' : ''}`}>
      <span />
      {value === 'Commit' ? 'Open for commitments' : value}
    </span>
  )
}
function Stat({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="stat">
      <span>{label}</span>
      <strong>{children}</strong>
    </div>
  )
}
function Art({ row, d, large = false }: { row: Row; d: Deployment; large?: boolean }) {
  const q = useQuery({
    queryKey: ['art', d.deploymentId, row.auction.nft, row.auction.tokenId.toString()],
    staleTime: Infinity,
    queryFn: async () => {
      if (!same(row.auction.nft, d.collectible)) return undefined
      const uri = await publicClient.readContract({
        address: d.collectible,
        abi: collectibleAbi,
        functionName: 'tokenURI',
        args: [row.auction.tokenId],
      })
      const json = JSON.parse(atob(uri.split(',')[1]!)) as { image: string }
      return json.image.startsWith('data:image/svg+xml;base64,') ? json.image : undefined
    },
  })
  return (
    <div className={`art art-${Number(row.auction.tokenId % 4n)} ${large ? 'large' : ''}`}>
      {q.data ? (
        <img src={q.data} alt={`Onchain artwork for collectible ${row.auction.tokenId}`} />
      ) : (
        <div className="art-empty">
          <Layers size={48} />
          <span>{q.isPending ? 'Loading onchain artwork' : 'ERC-721 collectible'}</span>
        </div>
      )}
      <span className="art-caption">
        CIPHERBID STUDIES <span>№ {row.auction.tokenId.toString().padStart(3, '0')}</span>
      </span>
    </div>
  )
}

export default function App() {
  const qc = useQueryClient()
  const connection = useConnection()
  const { address, chainId } = connection
  const connectors = useConnectors()
  const connect = useConnect(),
    disconnect = useDisconnect(),
    switchChain = useSwitchChain()
  const wallet = useWalletClient()
  const [view, setView] = useState<View>('explore')
  const [selected, setSelected] = useState<bigint>()
  const [filter, setFilter] = useState('All auctions')
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  const [walletOpen, setWalletOpen] = useState(false)
  const secrets = useQuery({ queryKey: ['secrets'], queryFn: allSecrets })
  const state = useQuery({
    queryKey: ['chain', address],
    refetchInterval: 3000,
    queryFn: async () => {
      const d = await verifiedDeployment()
      const block = await publicClient.getBlock()
      const count = await publicClient.readContract({
        address: d.auction,
        abi: auctionAbi,
        functionName: 'auctionCount',
      })
      const start = count > 99n ? count - 99n : 1n
      const rows: Row[] = await Promise.all(
        Array.from({ length: Number(count - start + 1n) }, async (_, i) => {
          const id = start + BigInt(i)
          const [auction, bid] = await Promise.all([
            publicClient.readContract({
              address: d.auction,
              abi: auctionAbi,
              functionName: 'getAuction',
              args: [id],
              blockNumber: block.number,
            }),
            address
              ? publicClient.readContract({
                  address: d.auction,
                  abi: auctionAbi,
                  functionName: 'getBid',
                  args: [id, address],
                  blockNumber: block.number,
                })
              : undefined,
          ])
          return { id, auction, bid }
        }),
      )
      const [index, credit, balance] = await Promise.all([
        indexEvents(d, block.number),
        address
          ? publicClient.readContract({
              address: d.auction,
              abi: auctionAbi,
              functionName: 'credits',
              args: [address],
              blockNumber: block.number,
            })
          : 0n,
        address ? publicClient.getBalance({ address, blockNumber: block.number }) : 0n,
      ])
      // Recover transaction state after reload without ever deleting or replacing the reveal record.
      let updated = false
      for (const secret of await allSecrets()) {
        if (
          !same(secret.deploymentId, d.deploymentId) ||
          !same(secret.contract, d.auction) ||
          secret.chainId !== CHAIN_ID ||
          !same(secret.bidder, address)
        )
          continue
        const bid = rows.find((r) => r.id.toString() === secret.auctionId)?.bid
        if (bid && same(bid.commitment, secret.commitment) && secret.status !== 'confirmed') {
          await saveSecret({ ...secret, status: 'confirmed' })
          updated = true
        } else if (
          bid?.sequence === 0n &&
          secret.transactionHash &&
          ['pending', 'replaced'].includes(secret.status)
        ) {
          try {
            const receipt = await publicClient.getTransactionReceipt({
              hash: secret.transactionHash,
            })
            await saveSecret({
              ...secret,
              status: receipt.status === 'reverted' ? 'reverted' : 'cancelled',
            })
            updated = true
          } catch {
            if (secret.transactionNonce !== undefined && address) {
              const nonce = await publicClient.getTransactionCount({ address })
              if (BigInt(nonce) > BigInt(secret.transactionNonce)) {
                await saveSecret({ ...secret, status: 'replaced' })
                updated = true
              }
            }
          }
        }
      }
      if (updated) await qc.invalidateQueries({ queryKey: ['secrets'] })
      return { d, now: block.timestamp, block: block.number, rows, index, credit, balance, count }
    },
  })
  const data = state.data
  const wrongNetwork = !!address && chainId !== CHAIN_ID
  const canWrite = !!address && !wrongNetwork && !busy && !state.isError && !!data && !!wallet.data
  const navigate = (v: View) => {
    setView(v)
    setSelected(undefined)
    setError('')
    setNotice('')
  }
  const open = (id: bigint) => {
    setSelected(id)
    setError('')
    setNotice('')
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }
  const reload = async () => {
    await Promise.all([
      qc.invalidateQueries({ queryKey: ['chain'] }),
      qc.invalidateQueries({ queryKey: ['secrets'] }),
    ])
  }
  const localSecret = (id: bigint) =>
    secrets.data?.find(
      (s) =>
        data &&
        same(s.bidder, address) &&
        same(s.deploymentId, data.d.deploymentId) &&
        s.chainId === CHAIN_ID &&
        same(s.contract, data.d.auction) &&
        s.auctionId === id.toString(),
    )

  async function transaction(
    fn: string,
    args: readonly unknown[],
    value?: bigint,
    secret?: Secret,
    target?: Address,
    abi: Abi = auctionAbi,
  ): Promise<boolean> {
    if (!canWrite || !wallet.data || !address || !data) {
      setError(
        'Connect a wallet on CipherBid Local. Wait for a fresh chain read before continuing.',
      )
      return false
    }
    setBusy(true)
    setError('')
    setNotice('Confirm the transaction in your wallet.')
    let submitted = false
    try {
      const d = await verifiedDeployment()
      if (
        !same(d.deploymentId, data.d.deploymentId) ||
        (await wallet.data.getChainId()) !== CHAIN_ID
      )
        throw new Error('network changed')
      const simulation = await publicClient.simulateContract({
        account: address,
        address: target ?? d.auction,
        abi,
        functionName: fn,
        args,
        ...(value !== undefined ? { value } : {}),
      })
      const scanFrom = await publicClient.getBlockNumber({ cacheTime: 0 })
      const hash = await wallet.data.writeContract(simulation.request)
      submitted = true
      if (secret) await saveSecret({ ...secret, status: 'pending', transactionHash: hash })
      const sent = await publicClient.getTransaction({ hash })
      if (secret) {
        secret = { ...secret, transactionHash: hash, transactionNonce: sent.nonce.toString() }
        await saveSecret({ ...secret, status: 'pending' })
      }
      setNotice(`Transaction pending · ${short(hash)}. Do not resubmit while it is pending.`)
      await qc.invalidateQueries({ queryKey: ['secrets'] })
      const receipt = await waitLocalReceipt(
        hash,
        sent.from,
        sent.nonce,
        scanFrom,
        async (replacementHash) => {
          if (secret)
            await saveSecret({
              ...secret,
              status: 'replaced',
              transactionHash: replacementHash,
            })
          setNotice('Transaction replaced. Checking its onchain outcome; the secret is retained.')
        },
      )
      if (secret) {
        const bid = await publicClient.readContract({
          address: d.auction,
          abi: auctionAbi,
          functionName: 'getBid',
          args: [BigInt(secret.auctionId), secret.bidder],
        })
        await saveSecret({
          ...secret,
          transactionHash: receipt.transactionHash,
          status: same(bid.commitment, secret.commitment)
            ? 'confirmed'
            : receipt.status === 'reverted'
              ? 'reverted'
              : 'cancelled',
        })
        if (receipt.status === 'success' && !same(bid.commitment, secret.commitment)) {
          setNotice(
            'The replacement did not place your commitment. Your secret is retained; you can retry before the commit deadline.',
          )
          await reload()
          return false
        }
      }
      if (receipt.status !== 'success') throw new Error('reverted')
      setNotice('Transaction confirmed on the local chain.')
      await reload()
      return true
    } catch (e) {
      if (secret && !submitted)
        await saveSecret({ ...secret, status: 'rejected' }).catch(() => undefined)
      setError(failure(e))
      setNotice('')
      await reload()
      return false
    } finally {
      setBusy(false)
    }
  }
  async function prepare(row: Row, amountText: string) {
    if (!data || !address || !canWrite) return
    setError('')
    try {
      const amount = exactETH(amountText)
      if (amount < row.auction.reserve || amount > row.auction.collateral)
        throw new Error('Your bid must be between the reserve and collateral, inclusive.')
      if (data.balance < row.auction.collateral + row.auction.bond)
        throw new Error('Insufficient development ETH for the deposit (plus gas).')
      const salt = randomSalt()
      const secret: Secret = {
        schemaVersion: 1,
        chainId: CHAIN_ID,
        deploymentId: data.d.deploymentId,
        contract: data.d.auction,
        auctionId: row.id.toString(),
        bidder: address,
        amount: amount.toString(),
        salt,
        commitment: commitment(CHAIN_ID, data.d.auction, row.id, address, amount, salt),
        status: 'saved',
      }
      await saveSecret(secret)
      await qc.invalidateQueries({ queryKey: ['secrets'] })
      setNotice(
        'Reveal secret saved in this browser. Download a backup before sending your commitment.',
      )
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save the secret. Do not commit.')
    }
  }
  async function importFile(file: File | undefined) {
    if (!file || !data || !address) {
      setError('Connect the matching wallet before importing.')
      return
    }
    setError('')
    try {
      if (wrongNetwork) throw new Error('Switch to CipherBid Local before importing.')
      if (file.size > 16384) throw new Error('Backup is too large.')
      const secret = parseBackup(await file.text())
      const d = await verifiedDeployment()
      validateContext(secret, d, address, selected)
      const [bid, a] = await Promise.all([
        publicClient.readContract({
          address: d.auction,
          abi: auctionAbi,
          functionName: 'getBid',
          args: [BigInt(secret.auctionId), address],
        }),
        publicClient.readContract({
          address: d.auction,
          abi: auctionAbi,
          functionName: 'getAuction',
          args: [BigInt(secret.auctionId)],
        }),
      ])
      if (BigInt(secret.amount) < a.reserve || BigInt(secret.amount) > a.collateral)
        throw new Error('Backup bid is outside this auction’s permitted range.')
      if (bid.sequence !== 0n && !same(bid.commitment, secret.commitment))
        throw new Error('Backup does not match the onchain commitment.')
      const existing = (await allSecrets()).find((s) => secretKey(s) === secretKey(secret))
      if (existing && !same(existing.commitment, secret.commitment))
        throw new Error(
          'A different secret already exists here. Export it before resolving the conflict.',
        )
      await saveSecret({ ...secret, status: bid.sequence !== 0n ? 'confirmed' : secret.status })
      await reload()
      setNotice(
        bid.sequence !== 0n
          ? 'Backup imported and verified against the onchain commitment.'
          : 'Backup imported. No onchain commitment exists yet; this file alone does not place a bid.',
      )
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Invalid backup.')
    }
  }
  const upload = (
    <label className="button secondary file-button">
      <Upload size={16} />
      Import backup
      <input
        type="file"
        accept=".json,application/json"
        disabled={!address || wrongNetwork}
        onChange={(e) => {
          void importFile(e.target.files?.[0])
          e.target.value = ''
        }}
      />
    </label>
  )
  const row = data?.rows.find((r) => r.id === selected)
  const commitmentRows = data?.rows.filter((r) => r.bid && r.bid.sequence > 0n)
  return (
    <>
      <a className="skip" href="#main">
        Skip to content
      </a>
      <div className="local-strip">
        <span className="dot" /> AN INDEPENDENT AUCTION ROOM{' '}
        <span>LOCAL ANVIL · DEVELOPMENT ETH ONLY</span>
      </div>
      <header className="header">
        <button className="brand" onClick={() => navigate('explore')} aria-label="CipherBid home">
          <span className="brand-mark">
            <LockKeyhole size={22} />
          </span>
          CipherBid<span className="brand-period">.</span>
        </button>
        <nav aria-label="Main navigation">
          {(
            [
              ['explore', 'Auctions'],
              ['commitments', 'My commitments'],
              ['funds', 'Funds'],
              ['backups', 'Backups'],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              className={view === id && !selected ? 'active' : ''}
              onClick={() => navigate(id)}
            >
              {label}
            </button>
          ))}
        </nav>
        <button className="button wallet-button" onClick={() => setWalletOpen(true)}>
          <Wallet size={16} />
          {address ? short(address) : 'Connect wallet'}
        </button>
      </header>
      <Dialog.Root open={walletOpen} onOpenChange={setWalletOpen}>
        <Dialog.Portal>
          <Dialog.Overlay className="overlay" />
          <Dialog.Content className="dialog">
            <Dialog.Title>Your local wallet</Dialog.Title>
            <Dialog.Description>
              Use a browser wallet connected to Anvil on port 8546, chain 31338. Never fund these
              development accounts with real ETH.
            </Dialog.Description>
            <Dialog.Close className="close" aria-label="Close wallet dialog">
              <X />
            </Dialog.Close>
            {address ? (
              <>
                <p className="mono wrap">{address}</p>
                <button
                  className="button"
                  onClick={() => {
                    disconnect.mutate()
                    setWalletOpen(false)
                  }}
                >
                  Disconnect wallet
                </button>
              </>
            ) : (
              connectors.map((c) => (
                <button
                  className="button"
                  key={c.uid}
                  disabled={connect.isPending}
                  onClick={() => {
                    void connect
                      .mutateAsync({ connector: c })
                      .then(() => setWalletOpen(false))
                      .catch(() =>
                        setError(
                          'Wallet connection was rejected or unavailable. Install an injected browser wallet for the local chain.',
                        ),
                      )
                  }}
                >
                  Connect {c.name}
                  <ArrowRight size={16} />
                </button>
              ))
            )}
            {!connectors.length && (
              <p>
                No injected wallet detected. Install a local-compatible browser wallet, then reload.
              </p>
            )}
            <dl className="rpc-list">
              <dt>RPC URL</dt>
              <dd>http://127.0.0.1:8546</dd>
              <dt>Chain ID</dt>
              <dd>31338</dd>
              <dt>Currency</dt>
              <dd>ETH (development only)</dd>
            </dl>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
      <main id="main">
        {wrongNetwork && (
          <div role="alert" className="alert">
            <strong>Wrong network.</strong> Switch your wallet to CipherBid Local, chain 31338.
            Public auctions still work.
            <button
              className="button secondary"
              onClick={() =>
                void switchChain
                  .mutateAsync({ chainId: CHAIN_ID })
                  .catch(() =>
                    setError(
                      'Could not switch networks. Add the local network using the wallet details.',
                    ),
                  )
              }
            >
              Switch network
            </button>
          </div>
        )}
        {error && (
          <div role="alert" className="alert">
            {error}
          </div>
        )}
        {notice && (
          <div role="status" className="notice">
            <Check size={18} />
            {notice}
          </div>
        )}
        {state.isError && (
          <div role="alert" className="alert">
            {state.error.message}{' '}
            <button className="text-button" onClick={() => void state.refetch()}>
              Retry connection
            </button>
          </div>
        )}
        {state.isPending && (
          <section className="empty">
            <RefreshCw className="spin" />
            <h1>Opening the auction room</h1>
            <p>Reading the local blockchain. No wallet required.</p>
          </section>
        )}
        {data && (
          <>
            {selected && row ? (
              <>
                <button className="back text-button" onClick={() => setSelected(undefined)}>
                  <ArrowLeft size={16} /> Back to{' '}
                  {view === 'commitments' ? 'my commitments' : 'auctions'}
                </button>
                <Detail
                  key={`${data.d.deploymentId}:${row.id}:${address}`}
                  row={row}
                  d={data.d}
                  now={data.now}
                  secret={localSecret(row.id)}
                  events={data.index.events}
                  address={address}
                  canWrite={canWrite}
                  prepare={prepare}
                  transaction={transaction}
                  upload={upload}
                  goFunds={() => navigate('funds')}
                  setError={setError}
                />
              </>
            ) : view === 'explore' ? (
              <>
                <section className="hero">
                  <div className="hero-copy">
                    <p className="eyebrow">
                      <span /> THE SEALED AUCTION ROOM
                    </p>
                    <h1>
                      A little mystery.
                      <br />A fairer <em>bid.</em>
                    </h1>
                    <p className="hero-description">
                      Discover digital objects worth collecting.
                      <br />
                      Place your bid in private. Let the rules do the rest.
                    </p>
                    <div className="hero-actions">
                      <button
                        className="button"
                        onClick={() =>
                          document
                            .getElementById('auctions')
                            ?.scrollIntoView({ behavior: 'smooth' })
                        }
                      >
                        Explore auctions <ArrowRight size={17} />
                      </button>
                      <button className="text-button" onClick={() => navigate('rules')}>
                        How it works <ArrowUpRight size={17} />
                      </button>
                    </div>
                    <div className="hero-note">
                      <ShieldCheck size={16} /> Escrowed assets. Fixed rules. No middleman.
                    </div>
                  </div>
                  <div className="hero-object" aria-hidden="true">
                    <div className="orbit orbit-one" />
                    <div className="orbit orbit-two" />
                    <div className="orbit orbit-three" />
                    <div className="orb-center" />
                    <span className="object-note">THE ART OF NOT SHOWING YOUR HAND</span>
                    <span className="object-number">001 / SEALED BY DESIGN</span>
                  </div>
                </section>
                <div className="process-strip">
                  {[
                    ['01', 'Commit', 'Your amount stays hidden.'],
                    ['02', 'Reveal', 'Show your bid before the deadline.'],
                    ['03', 'Collect', 'Highest valid bid wins.'],
                  ].map(([n, t, desc]) => (
                    <div key={n}>
                      <span className="step-number">{n}</span>
                      <div>
                        <strong>{t}</strong>
                        <p>{desc}</p>
                      </div>
                    </div>
                  ))}
                  <button
                    className="text-button"
                    onClick={() => navigate('rules')}
                    aria-label="Read the auction rules"
                  >
                    <ArrowUpRight />
                  </button>
                </div>
                <section id="auctions" className="auction-section">
                  <div className="section-heading">
                    <div>
                      <p className="eyebrow">CURATED ON YOUR LOCAL CHAIN</p>
                      <h2>
                        The collection <span>({data.count.toString()})</span>
                      </h2>
                    </div>
                    <button className="button secondary" onClick={() => navigate('create')}>
                      <Plus size={17} />
                      Create auction
                    </button>
                  </div>
                  <div className="filter-bar">
                    <div role="group" aria-label="Filter auctions">
                      {['All auctions', 'Commit', 'Reveal', 'Finalized'].map((f) => (
                        <button
                          key={f}
                          aria-pressed={filter === f}
                          onClick={() => setFilter(f)}
                          className={filter === f ? 'selected' : ''}
                        >
                          {f === 'Commit' ? 'Open for bids' : f}
                        </button>
                      ))}
                    </div>
                    <span>
                      <span className="dot" /> Live from Anvil
                    </span>
                  </div>
                  <div className="auction-grid">
                    {data.rows
                      .filter(
                        (r) => filter === 'All auctions' || phase(r.auction, data.now) === filter,
                      )
                      .map((r) => (
                        <button
                          className="auction-card"
                          key={r.id.toString()}
                          onClick={() => open(r.id)}
                        >
                          <Art row={r} d={data.d} />
                          <div className="card-content">
                            <div className="card-meta">
                              STUDY {r.auction.tokenId.toString().padStart(3, '0')}
                              <Pill value={phase(r.auction, data.now)} />
                            </div>
                            <h3>
                              {same(r.auction.nft, data.d.collectible)
                                ? title(r.auction.tokenId)
                                : 'ERC-721 collectible'}
                              <ArrowUpRight size={22} />
                            </h3>
                            <p className="creator">Offered by {short(r.auction.seller)}</p>
                            <div className="card-stats">
                              <Stat label="Reserve">
                                {eth(r.auction.reserve)} <small>ETH</small>
                              </Stat>
                              <Stat label="Commitments">
                                <LockKeyhole size={13} />
                                {r.auction.commitmentCount.toString()}
                              </Stat>
                            </div>
                            <div className="card-foot">
                              <Clock3 size={13} />
                              {phase(r.auction, data.now) === 'Commit'
                                ? 'Commit ends'
                                : phase(r.auction, data.now) === 'Reveal'
                                  ? 'Reveal ends'
                                  : 'Reveal ended'}{' '}
                              {date(
                                phase(r.auction, data.now) === 'Commit'
                                  ? r.auction.commitDeadline
                                  : r.auction.revealDeadline,
                              )}
                            </div>
                          </div>
                        </button>
                      ))}
                  </div>
                  {!data.rows.length && (
                    <div className="empty">
                      <Layers />
                      <h3>A fresh auction room</h3>
                      <p>
                        Run <code>pnpm seed</code> or create an auction with a local collectible.
                      </p>
                    </div>
                  )}
                  {!!data.rows.length &&
                    !data.rows.some(
                      (r) => filter === 'All auctions' || phase(r.auction, data.now) === filter,
                    ) && <div className="empty">No auctions in this phase.</div>}
                  {data.count > 100n && (
                    <p>
                      The explorer shows the latest 100 auctions. Earlier transactions remain in the
                      local event index.
                    </p>
                  )}
                </section>
                <section className="privacy-banner">
                  <LockKeyhole size={28} />
                  <div>
                    <h3>Private bids. Public rules.</h3>
                    <p>
                      Amounts stay hidden until reveal, not forever. Participation and collateral
                      are public.
                    </p>
                  </div>
                  <button className="text-button" onClick={() => navigate('rules')}>
                    Know what’s visible <ArrowUpRight size={18} />
                  </button>
                </section>
              </>
            ) : view === 'create' ? (
              <Create
                d={data.d}
                now={data.now}
                address={address}
                canWrite={canWrite}
                transaction={transaction}
                setError={setError}
              />
            ) : view === 'commitments' ? (
              <section className="page">
                <p className="eyebrow">DON’T MISS YOUR REVEAL</p>
                <h1>My commitments</h1>
                <p>
                  Secrets stay in this browser. Revealing requires your matching wallet and backup.
                </p>
                {!address ? (
                  <div className="empty">Connect your wallet to read its onchain commitments.</div>
                ) : !commitmentRows?.length ? (
                  <div className="empty">
                    No onchain commitments for this wallet in the latest 100 auctions.
                  </div>
                ) : (
                  commitmentRows.map((r) => (
                    <div className="list-row" key={r.id.toString()}>
                      <div>
                        <strong>Auction #{r.id.toString()}</strong>
                        <p>
                          <Pill value={phase(r.auction, data.now)} /> · Reveal by{' '}
                          {date(r.auction.revealDeadline)}
                        </p>
                        <p>
                          {r.bid?.revealed
                            ? 'Bid revealed publicly.'
                            : localSecret(r.id)
                              ? 'Reveal secret available in this browser.'
                              : 'Missing secret. Import your backup. Without it, you recover collateral but lose the bond if the deadline passes.'}
                        </p>
                      </div>
                      <button className="button secondary" onClick={() => open(r.id)}>
                        Open auction <ArrowUpRight size={16} />
                      </button>
                    </div>
                  ))
                )}
              </section>
            ) : view === 'funds' ? (
              <Funds
                data={data}
                address={address}
                canWrite={canWrite}
                transaction={transaction}
                open={open}
              />
            ) : view === 'backups' ? (
              <section className="page narrow">
                <p className="eyebrow">YOUR SECRET, YOUR RESPONSIBILITY</p>
                <h1>Backup manager</h1>
                <p>
                  IndexedDB and exported JSON files are <strong>not encrypted</strong>. Anyone with
                  a file can read its bid amount and salt. Keep it somewhere private. A transaction
                  signature does not back up your salt.
                </p>
                <div className="actions">{upload}</div>
                <h2>Saved reveal records</h2>
                {!secrets.data?.length && (
                  <div className="empty">
                    No local secrets. Import a backup to recover a commitment from another browser
                    or device.
                  </div>
                )}
                {secrets.data?.map((s) => {
                  const current =
                    same(s.deploymentId, data.d.deploymentId) &&
                    s.chainId === CHAIN_ID &&
                    same(s.contract, data.d.auction)
                  const r = data.rows.find((r) => r.id.toString() === s.auctionId)
                  return (
                    <div className="backup-record" key={secretKey(s)}>
                      <strong>
                        Auction #{s.auctionId} · {short(s.bidder)}
                      </strong>
                      <p className="mono">
                        {s.chainId} / {s.deploymentId.slice(0, 14)}…
                      </p>
                      <p>
                        {current
                          ? 'Current deployment'
                          : 'Old or different deployment, retained for recovery'}{' '}
                        · {s.status}
                      </p>
                      <div className="actions">
                        <button
                          className="button secondary"
                          onClick={() => downloadSecret(s, exportBackup(s))}
                        >
                          <Download size={16} />
                          Export backup
                        </button>
                        {current && r?.auction.finalized && same(address, s.bidder) && (
                          <button
                            className="text-button danger"
                            onClick={() => {
                              if (
                                window.confirm(
                                  'Permanently delete this local secret? Export a backup first if you want to retain it.',
                                )
                              )
                                void deleteSecret(s).then(reload)
                            }}
                          >
                            Delete completed record
                          </button>
                        )}
                      </div>
                    </div>
                  )
                })}
                <h2>Recover on another device</h2>
                <ol className="prose-list">
                  <li>Connect the same wallet to this same local chain and deployment.</li>
                  <li>
                    Import the original JSON file. CipherBid checks the domain, wallet, recomputed
                    hash, and onchain commitment.
                  </li>
                  <li>
                    Open the auction and reveal before its deadline. Importing alone does not reveal
                    a bid.
                  </li>
                </ol>
                <p>
                  There is no password reset or server copy. A chain reset creates a new deployment
                  identity, so old files cannot be mistaken for current bids.
                </p>
              </section>
            ) : (
              <Rules />
            )}
            <footer>
              <button className="brand" onClick={() => navigate('explore')}>
                CipherBid<span className="brand-period">.</span>
              </button>
              <p>A local experiment in trust, not a mainnet product.</p>
              <div>
                <button className="text-button" onClick={() => navigate('rules')}>
                  <BookOpen size={14} />
                  Rules & privacy
                </button>
                <button
                  className="text-button"
                  disabled={busy}
                  onClick={() =>
                    void rebuildIndex(data.d)
                      .then(reload)
                      .catch(() => setError('Could not rebuild the event index.'))
                  }
                >
                  <RefreshCw size={14} />
                  Rebuild event index
                </button>
              </div>
              <small>
                Chain time {date(data.now)} · block {data.block.toString()} ·{' '}
                {data.index.complete
                  ? 'Events synced'
                  : `Scanning through block ${data.index.through}`}
                <br />
                Phases use the latest block timestamp, not your device clock.
              </small>
            </footer>
          </>
        )}
      </main>
    </>
  )
}

type Tx = (
  fn: string,
  args: readonly unknown[],
  value?: bigint,
  secret?: Secret,
  target?: Address,
  abi?: Abi,
) => Promise<boolean>
function Detail({
  row,
  d,
  now,
  secret,
  events,
  address,
  canWrite,
  prepare,
  transaction,
  upload,
  goFunds,
  setError,
}: {
  row: Row
  d: Deployment
  now: bigint
  secret?: Secret
  events: IndexedEvent[]
  address?: Address
  canWrite: boolean
  prepare: (r: Row, a: string) => Promise<void>
  transaction: Tx
  upload: ReactNode
  goFunds: () => void
  setError: (s: string) => void
}) {
  const [amount, setAmount] = useState('')
  const [ack, setAck] = useState(false)
  const [exported, setExported] = useState(false)
  const [recipient, setRecipient] = useState('')
  const a = row.auction,
    b = row.bid,
    p = phase(a, now),
    isSeller = same(address, a.seller)
  const claimant = a.highestBidder === ZERO ? a.seller : a.highestBidder
  const onchain = b && b.sequence > 0n
  const revealEvents = events.filter((e) => e.auctionId === row.id && e.name === 'Revealed')
  const history = events.filter(
    (e) => e.auctionId === row.id || (e.name === 'Withdrawn' && same(e.beneficiary, address)),
  )
  const refund = b?.sequence
    ? b.revealed
      ? a.collateral + a.bond - (same(address, a.highestBidder) ? a.highestBid : 0n)
      : a.collateral
    : 0n
  return (
    <section className="detail page">
      <div>
        <Art row={row} d={d} large />
        <div className="asset-provenance">
          <ShieldCheck size={17} />
          <span>
            NFT escrowed at {short(d.auction)}
            <br />
            <small>
              {a.nft} / Token #{a.tokenId.toString()}
            </small>
          </span>
        </div>
        <h2>Onchain activity</h2>
        <p className="muted">
          Actual contract events. Withdrawals shown for your wallet are global across auctions.
        </p>
        <div className="history">
          {history
            .slice()
            .reverse()
            .map((e) => (
              <details key={`${e.transactionHash}:${e.logIndex}`}>
                <summary>
                  <span>{e.name}</span>
                  <small>Block {e.blockNumber.toString()}</small>
                </summary>
                <p className="mono wrap">Transaction {e.transactionHash}</p>
                {e.bidder && <p>Bidder {short(e.bidder)}</p>}
                {e.amount !== undefined && <p>Public amount {eth(e.amount)} ETH</p>}
                {e.refund !== undefined && (
                  <p>
                    Allocated refund {eth(e.refund)} ETH · Forfeited bond{' '}
                    {eth(e.forfeitedBond ?? 0n)} ETH
                  </p>
                )}
              </details>
            ))}
          {!history.length && <p>Scanning local events…</p>}
        </div>
      </div>
      <div className="detail-info">
        <Pill value={p} />
        <p className="eyebrow">CIPHERBID STUDIES / AUCTION {row.id.toString().padStart(3, '0')}</p>
        <h1>{same(a.nft, d.collectible) ? title(a.tokenId) : 'ERC-721 collectible'}</h1>
        <p className="creator">
          Offered by <span className="mono">{short(a.seller)}</span>
        </p>
        <p>
          A digital object, held in escrow. A first-price sealed auction, settled entirely by the
          contract.
        </p>
        <div className="detail-stats">
          <Stat label="Reserve price R">
            {eth(a.reserve)} <small>ETH</small>
          </Stat>
          <Stat label="Maximum collateral C">
            {eth(a.collateral)} <small>ETH</small>
          </Stat>
          <Stat label="Non-reveal bond B">
            {eth(a.bond)} <small>ETH</small>
          </Stat>
          <Stat label="Commitments">{a.commitmentCount.toString()}</Stat>
        </div>
        <ol className="timeline">
          <li className={p === 'Commit' ? 'current' : ''}>
            <span>01</span>
            <div>
              <strong>Commit</strong>
              <small>Until {date(a.commitDeadline)}</small>
            </div>
          </li>
          <li className={p === 'Reveal' ? 'current' : ''}>
            <span>02</span>
            <div>
              <strong>Reveal</strong>
              <small>Until {date(a.revealDeadline)}</small>
            </div>
          </li>
          <li className={a.finalized ? 'current' : ''}>
            <span>03</span>
            <div>
              <strong>Finalize & collect</strong>
              <small>From {date(a.revealDeadline)}</small>
            </div>
          </li>
        </ol>
        <div className="action-panel">
          <h2>
            {p === 'Commit'
              ? 'Seal your bid'
              : p === 'Reveal'
                ? 'Time to reveal'
                : a.finalized
                  ? 'The result is settled'
                  : 'Ready to finalize'}
          </h2>
          {!address && <p>Connect your wallet to participate. Browsing is always public.</p>}
          {p === 'Commit' && !isSeller && !onchain && (
            <>
              <p>
                You lock <strong>{eth(a.collateral + a.bond)} ETH (C + B)</strong>. Your bid stays
                hidden until you reveal. If you do not reveal in time, you recover{' '}
                <strong>{eth(a.collateral)} ETH (C)</strong> and lose{' '}
                <strong>{eth(a.bond)} ETH (B)</strong>.
              </p>
              {!secret ? (
                <form
                  onSubmit={(e) => {
                    e.preventDefault()
                    void prepare(row, amount)
                  }}
                >
                  <label>
                    Your private bid (ETH)
                    <input
                      required
                      inputMode="decimal"
                      placeholder={`${eth(a.reserve)} – ${eth(a.collateral)}`}
                      value={amount}
                      onChange={(e) => setAmount(e.target.value)}
                    />
                  </label>
                  <button className="button full" disabled={!canWrite}>
                    <LockKeyhole size={16} />
                    Prepare & save secret
                  </button>
                </form>
              ) : (
                <>
                  <p className="saved">
                    <Check size={16} />
                    Secret saved locally · {eth(BigInt(secret.amount))} ETH · {secret.status}
                  </p>
                  {secret.transactionHash && (
                    <p className="mono wrap">Transaction {secret.transactionHash}</p>
                  )}
                  <button
                    className="button secondary full"
                    onClick={() => {
                      downloadSecret(secret, exportBackup(secret))
                      setExported(true)
                    }}
                  >
                    <Download size={16} />
                    Download secret backup
                  </button>
                  <label className="checkbox">
                    <input
                      type="checkbox"
                      checked={ack}
                      onChange={(e) => setAck(e.target.checked)}
                    />
                    I understand that losing my secret can forfeit my bond. My local record and
                    backup are unencrypted.
                  </label>
                  <button
                    className="button full"
                    disabled={!canWrite || !ack || !exported || secret.status === 'pending'}
                    onClick={() =>
                      void transaction(
                        'commit',
                        [row.id, secret.commitment],
                        a.collateral + a.bond,
                        secret,
                      )
                    }
                  >
                    <LockKeyhole size={16} />
                    Commit {eth(a.collateral + a.bond)} ETH
                  </button>
                </>
              )}
            </>
          )}
          {p === 'Commit' && onchain && (
            <>
              <p>
                Your immutable commitment is onchain, sequence #{b.sequence.toString()}. Keep your
                backup and return during the reveal window.
              </p>
              <p>Amounts remain hidden until revealed.</p>
              {secret ? (
                <button
                  className="button secondary"
                  onClick={() => downloadSecret(secret, exportBackup(secret))}
                >
                  <Download size={16} />
                  Export backup
                </button>
              ) : (
                <>
                  <p className="danger">
                    Missing secret. Import your backup; a transaction signature does not contain
                    your salt.
                  </p>
                  {upload}
                </>
              )}
            </>
          )}
          {p === 'Commit' && isSeller && (
            <>
              <p>You are the seller and cannot bid.</p>
              {a.commitmentCount === 0n && (
                <button
                  className="button secondary"
                  disabled={!canWrite}
                  onClick={() => void transaction('cancel', [row.id])}
                >
                  Cancel empty auction
                </button>
              )}
            </>
          )}
          {p === 'Reveal' && onchain && !b.revealed && (
            <>
              {secret && same(secret.commitment, b.commitment) ? (
                <>
                  <p>
                    Reveal your saved bid of <strong>{eth(BigInt(secret.amount))} ETH</strong>. The
                    amount and salt will become public onchain.
                  </p>
                  <button
                    className="button full"
                    disabled={!canWrite}
                    onClick={() =>
                      void transaction('reveal', [row.id, BigInt(secret.amount), secret.salt])
                    }
                  >
                    Reveal saved bid <ArrowRight size={16} />
                  </button>
                </>
              ) : (
                <>
                  <p className="danger">
                    Your reveal secret is missing. Import the original backup before the deadline.
                    CipherBid cannot recover a lost salt. If you miss reveal, you recover C and lose
                    only B.
                  </p>
                  {upload}
                </>
              )}
            </>
          )}
          {p === 'Reveal' && b?.revealed && (
            <p className="saved">
              <Check size={16} />
              Your bid was revealed successfully. No further reveal is needed.
            </p>
          )}
          {p === 'Reveal' && !onchain && (
            <p>You did not commit to this auction. New bids are closed.</p>
          )}
          {p === 'Awaiting finalization' && (
            <>
              <p>
                The reveal deadline has passed. Anyone may finalize the deterministic result. This
                does not send ETH or transfer the NFT.
              </p>
              <button
                className="button full"
                disabled={!canWrite}
                onClick={() => void transaction('finalize', [row.id])}
              >
                Finalize auction
              </button>
            </>
          )}
          {a.finalized && (
            <>
              <p>
                {a.cancelled ? (
                  'The seller cancelled this empty auction.'
                ) : a.highestBidder === ZERO ? (
                  'No valid bid. The seller can reclaim the NFT.'
                ) : (
                  <>
                    Winner <strong className="mono">{short(a.highestBidder)}</strong> pays{' '}
                    <strong>{eth(a.highestBid)} ETH</strong>.
                  </>
                )}
              </p>
              {onchain && (
                <>
                  <p>
                    Your refundable amount: <strong>{eth(refund)} ETH</strong>.{' '}
                    {!b.revealed && <>The {eth(a.bond)} ETH bond is forfeited to the seller.</>}
                  </p>
                  {!b.settled ? (
                    <button
                      className="button full"
                      disabled={!canWrite}
                      onClick={() => void transaction('settleBidder', [row.id, address])}
                    >
                      Allocate my refund
                    </button>
                  ) : (
                    <p className="saved">
                      <Check size={16} />
                      Your refund has been allocated to your monetary credit.
                    </p>
                  )}
                  <button className="text-button" onClick={goFunds}>
                    Go to funds & withdraw <ArrowUpRight size={16} />
                  </button>
                </>
              )}
              {same(address, claimant) && !a.claimed && (
                <>
                  <label>
                    NFT recipient (optional)
                    <input
                      placeholder="Defaults to your connected wallet"
                      value={recipient}
                      onChange={(e) => setRecipient(e.target.value)}
                    />
                  </label>
                  <button
                    className="button full"
                    disabled={!canWrite}
                    onClick={() => {
                      if (recipient && !isAddress(recipient)) {
                        setError('Enter a valid recipient address.')
                        return
                      }
                      void transaction('claimAsset', [row.id, recipient || address])
                    }}
                  >
                    {a.highestBidder === ZERO ? 'Reclaim NFT' : 'Collect NFT'}
                    <ArrowUpRight size={16} />
                  </button>
                </>
              )}
              <p>
                Asset status:{' '}
                <strong>
                  {a.claimed ? 'Collected' : 'Held in escrow, awaiting authorized claim'}
                </strong>
                .
              </p>
              <Permissionless
                row={row}
                events={events}
                canWrite={canWrite}
                transaction={transaction}
              />
            </>
          )}
        </div>
        <div className="tie-note">
          <ShieldCheck size={19} />
          <p>
            <strong>Same bid? Earlier commitment wins.</strong>
            <br />
            The earlier onchain commit sequence breaks ties, regardless of reveal order. Transaction
            inclusion order can influence this tie-break.
          </p>
        </div>
        <h2>Revealed bids</h2>
        {revealEvents.length ? (
          <div className="revealed-bids">
            {revealEvents.map((e) => (
              <div key={e.transactionHash}>
                <span className="mono">{short(e.bidder!)}</span>
                <strong>{eth(e.amount!)} ETH</strong>
              </div>
            ))}
          </div>
        ) : (
          <p className="muted">No revealed bids yet. Commitment amounts are not published.</p>
        )}
      </div>
    </section>
  )
}

function Permissionless({
  row,
  events,
  canWrite,
  transaction,
}: {
  row: Row
  events: IndexedEvent[]
  canWrite: boolean
  transaction: Tx
}) {
  const settled = new Set(
    events
      .filter((e) => e.auctionId === row.id && e.name === 'BidderSettled')
      .map((e) => e.bidder?.toLowerCase()),
  )
  const unprocessed = events.filter(
    (e) =>
      e.auctionId === row.id && e.name === 'Committed' && !settled.has(e.bidder?.toLowerCase()),
  )
  return unprocessed.length ? (
    <details className="permissionless">
      <summary>Help process bidder refunds ({unprocessed.length})</summary>
      <p>
        Anyone can allocate these credits. Beneficiaries are fixed by the contract; processing
        cannot redirect funds.
      </p>
      {unprocessed.map((e) => (
        <button
          className="button secondary"
          key={e.bidder}
          disabled={!canWrite}
          onClick={() => void transaction('settleBidder', [row.id, e.bidder])}
        >
          Allocate for {short(e.bidder!)}
        </button>
      ))}
    </details>
  ) : null
}

function Funds({
  data,
  address,
  canWrite,
  transaction,
  open,
}: {
  data: { credit: bigint; rows: Row[]; d: Deployment; index: { events: IndexedEvent[] } }
  address?: Address
  canWrite: boolean
  transaction: Tx
  open: (id: bigint) => void
}) {
  const [recipient, setRecipient] = useState('')
  const [invalid, setInvalid] = useState(false)
  return (
    <section className="page">
      <p className="eyebrow">NOTHING SENT WITHOUT YOU</p>
      <h1>Refunds & proceeds</h1>
      <p>
        First allocate a bidder’s refund after finalization, then withdraw your credit. The seller’s
        winning-bid proceeds are credited at finalization. Forfeited bonds are credited as each
        non-revealer is processed.
      </p>
      <div className="fund-panel">
        <Stat label="Your withdrawable credit">
          {eth(data.credit)} <small>ETH</small>
        </Stat>
        <label>
          Alternate ETH recipient (optional)
          <input
            placeholder="Defaults to your connected wallet"
            value={recipient}
            onChange={(e) => {
              setRecipient(e.target.value)
              setInvalid(false)
            }}
          />
        </label>
        {invalid && <p role="alert">Enter a valid Ethereum address.</p>}
        <button
          className="button"
          disabled={!canWrite || data.credit === 0n}
          onClick={() => {
            if (recipient && !isAddress(recipient)) {
              setInvalid(true)
              return
            }
            void transaction('withdraw', [recipient || address])
          }}
        >
          Withdraw credit <ArrowUpRight size={16} />
        </button>
      </div>
      <h2>Your completed auctions</h2>
      {!address && <p>Connect a wallet to see your credits.</p>}
      {data.rows
        .filter(
          (r) =>
            r.auction.finalized &&
            (same(address, r.auction.seller) || (r.bid?.sequence ?? 0n) > 0n),
        )
        .map((r) => (
          <div className="list-row" key={r.id.toString()}>
            <div>
              <strong>Auction #{r.id.toString()}</strong>
              <p>
                {same(address, r.auction.seller)
                  ? 'Seller proceeds'
                  : r.bid?.settled
                    ? 'Refund allocated'
                    : 'Refund awaiting allocation'}{' '}
                · NFT {r.auction.claimed ? 'collected' : 'awaiting claim'}
              </p>
            </div>
            <button className="button secondary" onClick={() => open(r.id)}>
              Open settlement
            </button>
          </div>
        ))}
      <h2>Withdrawal history</h2>
      {data.index.events
        .filter((e) => e.name === 'Withdrawn' && same(e.beneficiary, address))
        .map((e) => (
          <div className="list-row" key={`${e.transactionHash}:${e.logIndex}`}>
            <span>
              {eth(e.amount ?? 0n)} ETH to {short(e.recipient!)}
            </span>
            <span className="mono" title={e.transactionHash}>
              {short(e.transactionHash)}
            </span>
          </div>
        ))}
      <p className="muted">
        No automatic pushes. A failing recipient cannot block finalization or another user’s
        withdrawal. Only the credit owner chooses where to send it.
      </p>
    </section>
  )
}

function Create({
  d,
  now,
  address,
  canWrite,
  transaction,
  setError,
}: {
  d: Deployment
  now: bigint
  address?: Address
  canWrite: boolean
  transaction: Tx
  setError: (s: string) => void
}) {
  const [nft, setNFT] = useState(d.collectible as string)
  const [token, setToken] = useState('')
  const [reserve, setReserve] = useState('1')
  const [collateral, setCollateral] = useState('5')
  const [bond, setBond] = useState('0.1')
  const [commitMinutes, setCommitMinutes] = useState('60')
  const [revealMinutes, setRevealMinutes] = useState('60')
  const [approved, setApproved] = useState(false)
  const [creating, setCreating] = useState(false)
  async function create(e: FormEvent) {
    e.preventDefault()
    setError('')
    try {
      if (!isAddress(nft) || !/^[1-9]\d*$/.test(token))
        throw new Error('Enter a valid ERC-721 address and token ID.')
      const r = exactETH(reserve),
        c = exactETH(collateral),
        b = exactETH(bond),
        cm = Number(commitMinutes),
        rm = Number(revealMinutes)
      if (
        r === 0n ||
        r > c ||
        b === 0n ||
        c + b >= 2n ** 256n ||
        !Number.isSafeInteger(cm) ||
        !Number.isSafeInteger(rm) ||
        cm < 1 ||
        rm < 1 ||
        cm > 525600 ||
        rm > 525600
      )
        throw new Error(
          'Require 0 < reserve ≤ collateral, bond > 0, and phase lengths of 1–525600 minutes.',
        )
      const owner = await publicClient.readContract({
        address: nft,
        abi: collectibleAbi,
        functionName: 'ownerOf',
        args: [BigInt(token)],
      })
      if (!same(owner, address)) throw new Error('Your connected wallet does not own this NFT.')
      setCreating(true)
      const ok = await transaction(
        'approve',
        [d.auction, BigInt(token)],
        undefined,
        undefined,
        nft,
        collectibleAbi,
      )
      if (!ok) return
      setApproved(true)
      const timestamp = (await publicClient.getBlock()).timestamp
      const created = await transaction('createAuction', [
        nft,
        BigInt(token),
        r,
        c,
        b,
        timestamp + BigInt(cm * 60),
        timestamp + BigInt((cm + rm) * 60),
      ])
      if (created) {
        setToken('')
        setApproved(false)
      }
    } catch (e) {
      setError(
        e instanceof Error && e.message.length < 180
          ? e.message
          : 'NFT validation failed. Check ownership, approval, and ERC-721 support.',
      )
    } finally {
      setCreating(false)
    }
  }
  return (
    <section className="page narrow">
      <p className="eyebrow">LET THE RULES DO THE REST</p>
      <h1>Create an auction</h1>
      <p>
        Your NFT is safely transferred into escrow when creation succeeds. Approval and creation are
        two separate wallet transactions. If creation fails, you retain ownership; approval may
        remain.
      </p>
      <form className="create-form" onSubmit={(e) => void create(e)}>
        <fieldset disabled={!canWrite || creating}>
          <legend>01 / The collectible</legend>
          <label>
            ERC-721 contract
            <input required value={nft} onChange={(e) => setNFT(e.target.value)} />
          </label>
          <label>
            Token ID
            <input
              required
              inputMode="numeric"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder="A collectible your wallet owns"
            />
          </label>
        </fieldset>
        <fieldset disabled={!canWrite || creating}>
          <legend>02 / Fixed economics</legend>
          <label>
            Reserve price R (ETH)
            <input
              required
              inputMode="decimal"
              value={reserve}
              onChange={(e) => setReserve(e.target.value)}
            />
          </label>
          <label>
            Maximum bid collateral C (ETH)
            <input
              required
              inputMode="decimal"
              value={collateral}
              onChange={(e) => setCollateral(e.target.value)}
            />
          </label>
          <label>
            Non-reveal bond B (ETH)
            <input
              required
              inputMode="decimal"
              value={bond}
              onChange={(e) => setBond(e.target.value)}
            />
          </label>
          <p>
            Every bidder deposits exactly C + B. Identical deposits avoid directly disclosing a bid
            through its deposit, but lock extra capital and publish an upper bound.
          </p>
        </fieldset>
        <fieldset disabled={!canWrite || creating}>
          <legend>03 / The schedule</legend>
          <label>
            Commit phase (minutes)
            <input
              type="number"
              min="1"
              max="525600"
              value={commitMinutes}
              onChange={(e) => setCommitMinutes(e.target.value)}
            />
          </label>
          <label>
            Reveal phase (minutes)
            <input
              type="number"
              min="1"
              max="525600"
              value={revealMinutes}
              onChange={(e) => setRevealMinutes(e.target.value)}
            />
          </label>
          <p>
            Deadlines are based on chain time at creation, not the device clock. Latest block:{' '}
            {date(now)}.
          </p>
        </fieldset>
        <button className="button full" disabled={!canWrite || creating}>
          {approved ? 'Retry approval & create' : 'Approve NFT & create auction'}{' '}
          <ArrowRight size={17} />
        </button>
      </form>
    </section>
  )
}

function Rules() {
  return (
    <article className="page narrow prose">
      <p className="eyebrow">TRANSPARENCY ABOUT PRIVACY</p>
      <h1>
        Private bids.
        <br />
        Public rules.
      </h1>
      <p className="lead">
        A first-price sealed-bid auction. No hidden settlement logic. No promise of anonymity.
      </p>
      <h2>01 / Commit with a secure secret</h2>
      <p>
        Your browser generates 32 cryptographically random bytes using Web Crypto. The commitment
        binds the chain, auction contract, auction ID, your wallet, bid amount, and salt. The commit
        transaction publishes only the hash, with an exact C + B deposit.
      </p>
      <p>
        Bid amounts are hidden during commit if secrets are generated securely. Bidder addresses,
        participation, timing, collateral, NFT details, and auction metadata are public.
      </p>
      <h2>02 / Back up, then reveal</h2>
      <p>
        The full reveal record is saved in IndexedDB before submission. Export it somewhere private.
        Neither IndexedDB nor the JSON backup is encrypted. There is no backend, cloud copy,
        analytics, or recovery administrator. Signing a transaction does not back up your salt.
      </p>
      <p>
        Reveal with the same wallet during the reveal window. Amount and salt become public,
        including in calldata. This is not anonymous bidding or permanent confidentiality. FHE is a
        future possibility, not part of v1.
      </p>
      <h2>03 / The highest valid bid wins</h2>
      <p>
        Valid bids lie between reserve R and collateral C, inclusive. Equal highest bids are broken
        by the earlier onchain commit sequence, irrespective of reveal order. Transaction inclusion
        order determines this tie-break, so it does not prevent transaction-ordering influence.
      </p>
      <h2>04 / Settle without surprises</h2>
      <div className="rule-table">
        <div>
          <strong>Winning revealer</strong>
          <span>Refund C − winning bid + B</span>
        </div>
        <div>
          <strong>Other valid revealers</strong>
          <span>Refund C + B</span>
        </div>
        <div>
          <strong>Non-revealer</strong>
          <span>Refund C; seller receives B</span>
        </div>
        <div>
          <strong>Seller</strong>
          <span>Winning bid, plus processed forfeited bonds</span>
        </div>
      </div>
      <p>
        Anyone finalizes after the deadline, once, without bidder loops or transfers. Anyone can
        process one bidder’s accounting; funds always go to the recorded beneficiary. Each
        beneficiary then withdraws to a chosen address. NFT collection is separate and only the
        winner (or seller after no sale/cancellation) can choose its recipient.
      </p>
      <h2>Fixed collateral is a tradeoff</h2>
      <p>
        Identical deposits avoid directly revealing each bid through its deposit amount, but lock
        more capital and disclose C as a public upper bound. Network fees and inclusion timing
        remain public.
      </p>
      <h2>The precise phase boundaries</h2>
      <p>
        Commit before the commit deadline. Reveal at or after the commit deadline and before the
        reveal deadline. Finalize at or after the reveal deadline. Sellers may cancel only before
        the commit deadline and with zero commitments. No seller bidding, replacements, or
        active-phase bid withdrawals.
      </p>
      <h2>A local experiment, not an audited product</h2>
      <p>
        Only Anvil, locally minted collectibles, and development ETH are used. No mainnet fork, paid
        RPC, backend, indexer service, or real funds. Terminal time-advance commands affect only the
        guarded local chain. This implementation has not received an independent security audit and
        is not claimed mainnet-ready.
      </p>
      <h2>Unexpected assets</h2>
      <p>
        Unsolicited safe NFT transfers are rejected. Unsafe direct transfers can strand assets
        permanently. Forced ETH creates surplus, not claimable credit. There is no owner rescue or
        seizure function. Use standard, trustworthy ERC-721 contracts; malicious token contracts can
        lie about ownership or callbacks.
      </p>
    </article>
  )
}
