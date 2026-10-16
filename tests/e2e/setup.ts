import { execFileSync } from 'node:child_process'
export default function setup() {
  // Playwright owns a fresh Anvil process. No reset of a user's existing chain is permitted.
  execFileSync('pnpm', ['deploy:local'], {
    cwd: new URL('../..', import.meta.url),
    stdio: 'pipe',
    env: { ...process.env, CIPHERBID_RPC: 'http://127.0.0.1:8546' },
  })
  execFileSync('pnpm', ['seed'], {
    cwd: new URL('../..', import.meta.url),
    stdio: 'pipe',
    env: { ...process.env, CIPHERBID_RPC: 'http://127.0.0.1:8546' },
  })
}
