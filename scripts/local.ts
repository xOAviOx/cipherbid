import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { randomBytes } from 'node:crypto'
import assert from 'node:assert/strict'
import { createPublicClient, createWalletClient, defineChain, http, type Address, type Hex, type Abi } from 'viem'
import { auctionAbi, collectibleAbi } from '../packages/shared/src/generated.ts'
import { CHAIN_ID, RPC_URL, commitment, type Deployment, ZERO } from '../packages/shared/src/index.ts'

const rpc = process.env.CIPHERBID_RPC ?? RPC_URL
const url = new URL(rpc)
if (!['localhost','127.0.0.1','[::1]'].includes(url.hostname) || url.port !== '8546' || url.protocol !== 'http:' || url.username || url.password) {
  throw new Error('Development commands require loopback HTTP RPC on port 8546.')
}
const chain = defineChain({id:CHAIN_ID,name:'CipherBid Local',nativeCurrency:{name:'Development Ether',symbol:'ETH',decimals:18},rpcUrls:{default:{http:[rpc]}}})
export const client = createPublicClient({chain,transport:http(rpc)})
const rpcCall = async (method: string, params: unknown[] = []): Promise<unknown> => {
  const response = await fetch(rpc,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params})})
  const result = await response.json() as {result?: unknown; error?: unknown}
  if (result.error) throw new Error(`Local RPC command ${method} failed.`)
  return result.result
}
if (await client.getChainId() !== CHAIN_ID || !String(await rpcCall('web3_clientVersion')).toLowerCase().includes('anvil')) throw new Error('Only CipherBid Anvil chain 31338 is allowed.')
const accounts = await rpcCall('eth_accounts') as Address[]
if (accounts.length < 4) throw new Error('Four unlocked local development accounts are required.')
const wallets = accounts.map(account=>createWalletClient({account,chain,transport:http(rpc)}))
const metadataPath = new URL('../apps/web/public/deployment.json',import.meta.url)
const artifact = async (name:string) => JSON.parse(await readFile(new URL(`../contracts/out/${name}.sol/${name}.json`,import.meta.url),'utf8')) as {abi:Abi;bytecode:{object:Hex}}
export async function deployment(): Promise<Deployment> {
  const d = JSON.parse(await readFile(metadataPath,'utf8')) as Deployment
  if (d.chainId!==CHAIN_ID) throw new Error('Wrong deployment chain.')
  const block = await client.getBlock({blockNumber:BigInt(d.blockNumber)})
  if (block.hash!==d.blockHash || await client.readContract({address:d.auction,abi:auctionAbi,functionName:'deploymentId'})!==d.deploymentId) {
    throw new Error('Chain reset or stale deployment. Run pnpm deploy:local and pnpm seed.')
  }
  return d
}
async function receipt(hash: Hex) {
  const r=await client.waitForTransactionReceipt({hash})
  assert.equal(r.status,'success','Transaction reverted')
  return r
}
async function send(index:number,d:Deployment,fn:'finalize'|'settleBidder'|'claimAsset'|'withdraw'|'commit'|'reveal',args:readonly unknown[],value?:bigint) {
  // Dynamic script dispatch, ABI is generated from the build.
  return receipt(await wallets[index]!.writeContract({address:d.auction,abi:auctionAbi as Abi,functionName:fn,args,value}))
}
async function create(d:Deployment,commitSeconds=3600,revealSeconds=3600) {
  const token=await client.readContract({address:d.collectible,abi:collectibleAbi,functionName:'nextTokenId'})+1n
  await receipt(await wallets[0]!.writeContract({address:d.collectible,abi:collectibleAbi,functionName:'mint',args:[accounts[0]!]}))
  await receipt(await wallets[0]!.writeContract({address:d.collectible,abi:collectibleAbi,functionName:'approve',args:[d.auction,token]}))
  const now=(await client.getBlock()).timestamp
  await receipt(await wallets[0]!.writeContract({address:d.auction,abi:auctionAbi,functionName:'createAuction',
    args:[d.collectible,token,10n**18n,5n*10n**18n,10n**17n,now+BigInt(commitSeconds),now+BigInt(commitSeconds+revealSeconds)]}))
  return client.readContract({address:d.auction,abi:auctionAbi,functionName:'auctionCount'})
}
async function warpTo(timestamp:bigint) {
  await rpcCall('evm_setNextBlockTimestamp',[Number(timestamp)])
  await rpcCall('evm_mine')
}
const command=process.argv[2]
if (command==='deploy') {
  const identity=`0x${randomBytes(32).toString('hex')}` as Hex
  const a=await artifact('CipherBid'), n=await artifact('LocalCollectible')
  const ar=await receipt(await wallets[0]!.deployContract({abi:a.abi,bytecode:a.bytecode.object,args:[identity]}))
  const nr=await receipt(await wallets[0]!.deployContract({abi:n.abi,bytecode:n.bytecode.object}))
  const d:Deployment={chainId:CHAIN_ID,deploymentId:identity,auction:ar.contractAddress!,collectible:nr.contractAddress!,blockNumber:ar.blockNumber.toString(),blockHash:ar.blockHash}
  await mkdir(new URL('../apps/web/public/',import.meta.url),{recursive:true})
  await writeFile(metadataPath,JSON.stringify(d,null,2)+'\n')
  console.log('Local deployment exported. Identity:',identity,'\nAuction:',d.auction)
} else if (command==='seed') {
  const d=await deployment()
  for(let i=0;i<4;i++) await create(d,3600+i*600,3600)
  // Extra seller-owned works for the create-auction form.
  for(let i=0;i<3;i++) await receipt(await wallets[0]!.writeContract({address:d.collectible,abi:collectibleAbi,functionName:'mint',args:[accounts[0]!]}))
  console.log('Seeded four real escrowed auctions and three seller-owned collectibles. Seller:',accounts[0])
} else if (command==='time') {
  await deployment()
  const position=process.argv.indexOf('--seconds')
  const seconds=Number(process.argv[position+1])
  if(position<0 || !Number.isSafeInteger(seconds) || seconds<1 || seconds>604800) throw new Error('Use pnpm time:advance --seconds 120 (1–604800).')
  await rpcCall('evm_increaseTime',[seconds]); await rpcCall('evm_mine')
  console.log(`Advanced ONLY local Anvil time by ${seconds} seconds.`)
} else if (command==='demo') {
  const d=await deployment()
  const ONE=10n**18n, deposit=51n*10n**17n
  const read=(id:bigint)=>client.readContract({address:d.auction,abi:auctionAbi,functionName:'getAuction',args:[id]})
  for(const scenario of ['acceptance','reverse-order tie','no valid reveal','no commitments']) {
    const id=await create(d,120,120)
    const salts=[1,2,3].map(i=>`0x${i.toString(16).padStart(64,'0')}` as Hex)
    const amounts=scenario==='reverse-order tie'?[3n*ONE,3n*ONE,4n*ONE]:[3n*ONE,2n*ONE,4n*ONE]
    const count=scenario==='no commitments'?0:3
    const beforeCredits=await client.readContract({address:d.auction,abi:auctionAbi,functionName:'credits',args:[accounts[0]!]})
    for(let i=1;i<=count;i++) await send(i,d,'commit',[id,commitment(CHAIN_ID,d.auction,id,accounts[i]!,amounts[i-1]!,salts[i-1]!)],deposit)
    await warpTo((await read(id)).commitDeadline)
    if(scenario==='acceptance'||scenario==='reverse-order tie') {
      await send(2,d,'reveal',[id,amounts[1],salts[1]])
      await send(1,d,'reveal',[id,amounts[0],salts[0]])
    }
    await warpTo((await read(id)).revealDeadline)
    await send(3,d,'finalize',[id])
    const sold=scenario==='acceptance'||scenario==='reverse-order tie'
    assert.equal((await read(id)).highestBidder.toLowerCase(),sold?accounts[1]!.toLowerCase():ZERO)
    for(let i=1;i<=count;i++) await send(0,d,'settleBidder',[id,accounts[i]])
    const sellerCredit=await client.readContract({address:d.auction,abi:auctionAbi,functionName:'credits',args:[accounts[0]!]})
    assert.equal(sellerCredit-beforeCredits,sold?31n*10n**17n:BigInt(count)*10n**17n)
    for(let i=1;i<=count;i++) {
      const credit=await client.readContract({address:d.auction,abi:auctionAbi,functionName:'credits',args:[accounts[i]!]})
      assert.equal(credit,sold?(i===1?21n*10n**17n:i===2?deposit:5n*ONE):5n*ONE)
      await send(i,d,'withdraw',[accounts[i]])
    }
    if(sellerCredit>0n) await send(0,d,'withdraw',[accounts[0]])
    await send(sold?1:0,d,'claimAsset',[id,accounts[sold?1:0]])
    const a=await read(id)
    assert.equal((await client.readContract({address:d.collectible,abi:collectibleAbi,functionName:'ownerOf',args:[a.tokenId]})).toLowerCase(),accounts[sold?1:0]!.toLowerCase())
    console.log(`PASS ${scenario}: auction ${id}, NFT collected; refunds, proceeds and bonds reconciled.`)
  }
  const liability=await client.readContract({address:d.auction,abi:auctionAbi,functionName:'totalLiability'})
  const balance=await client.getBalance({address:d.auction})
  assert.ok(balance>=liability)
  console.log('Demo complete. Liabilities backed:',liability.toString(),'wei. No real ETH used.')
} else {
  throw new Error('Expected deploy, seed, time, or demo.')
}
