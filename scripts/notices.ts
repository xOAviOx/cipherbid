import { readdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
const root = new URL('../node_modules/.pnpm/', import.meta.url).pathname
const entries = await readdir(root)
const sections = new Map<string, string>()
for (const entry of entries) {
  const modules = join(root, entry, 'node_modules')
  let names: string[]
  try {
    names = await readdir(modules)
  } catch {
    continue
  }
  for (const name of names) {
    const paths = name.startsWith('@')
      ? (await readdir(join(modules, name))).map((n) => join(name, n))
      : [name]
    for (const path of paths) {
      const dir = join(modules, path)
      try {
        const pkg = JSON.parse(await readFile(join(dir, 'package.json'), 'utf8')) as {
          name: string
          version: string
          license?: string
        }
        const id = `${pkg.name}@${pkg.version}`
        if (sections.has(id)) continue
        const licenses = (await readdir(dir)).filter((n) =>
          /^(licen[cs]e|copying|notice)(\.|$|-)/i.test(n),
        )
        let text = ''
        for (const license of licenses) {
          try {
            text += `\n${license}\n${await readFile(join(dir, license), 'utf8')}\n`
          } catch {
            /* some packages use a LICENSE directory */
          }
        }
        sections.set(
          id,
          `${id} (${pkg.license ?? 'see package'})\n${text || 'License text is retained in the installed package; consult its package metadata.'}`,
        )
      } catch {
        /* nested links that are not package roots */
      }
    }
  }
}
const notices =
  'CipherBid dependency notices\nGenerated from installed pinned packages, including development tools.\nFull upstream packages remain unmodified. Foundry release binaries also retain their upstream licenses.\n\n' +
  [...sections.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([, text]) => `${'='.repeat(72)}\n${text}`)
    .join('\n')
// Normalize only line endings and trailing whitespace, preserving all license language.
await writeFile(
  new URL('../THIRD_PARTY_NOTICES.txt', import.meta.url),
  notices
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+$/gm, '')
    .trimEnd() + '\n',
)
console.log(`Collected notices for ${sections.size} installed packages.`)
