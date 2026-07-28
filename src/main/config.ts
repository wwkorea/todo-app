import fs from 'node:fs'
import path from 'node:path'
import { app } from 'electron'

interface AppConfig {
  dataDir: string | null
}

function configPath(): string {
  return path.join(app.getPath('userData'), 'config.json')
}

export function loadConfig(): AppConfig {
  try {
    const raw = JSON.parse(fs.readFileSync(configPath(), 'utf-8'))
    return { dataDir: typeof raw.dataDir === 'string' ? raw.dataDir : null }
  } catch {
    return { dataDir: null }
  }
}

export function saveConfig(config: AppConfig): void {
  fs.mkdirSync(path.dirname(configPath()), { recursive: true })
  fs.writeFileSync(configPath(), JSON.stringify(config, null, 2), 'utf-8')
}
