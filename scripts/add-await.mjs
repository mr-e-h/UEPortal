// One-off codemod: add `await` to every readJson/writeJson/getDeletedProjectIds
// call now that lib/data.ts is async. Wraps chained accesses in parens
// (`readJson<T>(...).filter(...)` → `(await readJson<T>(...)).filter(...)`).
// Skip this file under .claude/worktrees/** because those are stale copies.

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.join(__dirname, '..')

const IGNORE_DIRS = new Set(['node_modules', '.next', '.git', '.claude', 'data', 'public', 'scripts'])

function* walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (IGNORE_DIRS.has(entry.name)) continue
    const p = path.join(dir, entry.name)
    if (entry.isDirectory()) yield* walk(p)
    else if (/\.(ts|tsx)$/.test(entry.name)) yield p
  }
}

const reChain = /(?<!await\s)(readJson\s*<[\s\S]*?>\s*\([^)]*\))(\s*\.)/g
const reBareRead = /(?<!await\s)(?<!\()(readJson\s*<)/g
const reWrite = /(?<!await\s)(writeJson\s*\()/g
const reDeleted = /(?<!await\s)(getDeletedProjectIds\s*\(\s*\))/g

const SKIP_FILES = new Set([
  // The functions are defined here — don't try to await their own definition.
  path.join('lib', 'data.ts'),
])

let changed = 0
for (const file of walk(root)) {
  const rel = path.relative(root, file)
  if (SKIP_FILES.has(rel)) continue
  let src = fs.readFileSync(file, 'utf8')
  const original = src
  src = src.replace(reChain, '(await $1)$2')
  src = src.replace(reBareRead, 'await $1')
  src = src.replace(reWrite, 'await $1')
  src = src.replace(reDeleted, 'await $1')
  if (src !== original) {
    fs.writeFileSync(file, src)
    changed++
    console.log('updated', rel)
  }
}
console.log(`\n${changed} files updated`)
