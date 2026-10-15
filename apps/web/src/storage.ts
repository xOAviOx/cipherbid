import { secretKey, type Secret } from '../../../packages/shared/src/index'

const database = new Promise<IDBDatabase>((resolve,reject)=>{
  const req=indexedDB.open('cipherbid-v1',1)
  req.onupgradeneeded=()=>{ req.result.createObjectStore('secrets'); req.result.createObjectStore('events') }
  req.onsuccess=()=>resolve(req.result)
  req.onerror=()=>reject(new Error('Local storage is unavailable. Do not commit without saving a secret.'))
})
export async function db<T>(store:'secrets'|'events',mode:IDBTransactionMode,action:(s:IDBObjectStore)=>IDBRequest<T>):Promise<T> {
  const tx=(await database).transaction(store,mode)
  return new Promise((resolve,reject)=>{
    let value:T
    const req=action(tx.objectStore(store))
    req.onsuccess=()=>{value=req.result}
    tx.oncomplete=()=>resolve(value)
    tx.onabort=tx.onerror=()=>reject(new Error('Could not persist browser data.'))
  })
}
export const saveSecret=(secret:Secret)=>db('secrets','readwrite',s=>s.put(secret,secretKey(secret)))
export const allSecrets=()=>db<Secret[]>('secrets','readonly',s=>s.getAll())
export const deleteSecret=(secret:Secret)=>db('secrets','readwrite',s=>s.delete(secretKey(secret)))
export function downloadSecret(secret:Secret,text:string) {
  const url=URL.createObjectURL(new Blob([text],{type:'application/json'}))
  const a=document.createElement('a'); a.href=url
  a.download=`cipherbid-${secret.deploymentId.slice(2,10)}-auction-${secret.auctionId}-${secret.bidder.slice(2,8)}.json`
  a.click(); setTimeout(()=>URL.revokeObjectURL(url),1000)
}
