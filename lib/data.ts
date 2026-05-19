import fs from 'fs'
import path from 'path'

const dataDir = path.join(process.cwd(), 'data')

function readJson<T>(filename: string): T[] {
  const file = path.join(dataDir, filename)
  // Runtime data files (users, weekly_reports, password_resets, etc.) are
  // gitignored so a fresh clone starts without them; treat missing as empty.
  if (!fs.existsSync(file)) return []
  const raw = fs.readFileSync(file, 'utf-8')
  return JSON.parse(raw) as T[]
}

function writeJson<T>(filename: string, data: T[]): void {
  const file = path.join(dataDir, filename)
  fs.mkdirSync(dataDir, { recursive: true })
  fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf-8')
}

function getDeletedProjectIds(): Set<string> {
  const projects = readJson<{ id: string; deleted?: boolean }>('projects.json')
  return new Set(projects.filter((p) => p.deleted).map((p) => p.id))
}

export { readJson, writeJson, getDeletedProjectIds }
