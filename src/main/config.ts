import fs from 'node:fs'
import path from 'node:path'
import { app, safeStorage } from 'electron'

interface AppConfig {
  dataDir: string | null
  /** AI API 키 — 'enc:<b64>'(safeStorage 암호화) 또는 'plain:<b64>'(암호화 불가 환경 폴백) */
  ai_key?: string
}

function configPath(): string {
  return path.join(app.getPath('userData'), 'config.json')
}

export function loadConfig(): AppConfig {
  try {
    const raw = JSON.parse(fs.readFileSync(configPath(), 'utf-8'))
    return {
      dataDir: typeof raw.dataDir === 'string' ? raw.dataDir : null,
      ai_key: typeof raw.ai_key === 'string' ? raw.ai_key : undefined
    }
  } catch {
    return { dataDir: null }
  }
}

function writeConfig(config: AppConfig): void {
  fs.mkdirSync(path.dirname(configPath()), { recursive: true })
  fs.writeFileSync(configPath(), JSON.stringify(config, null, 2), 'utf-8')
}

/** 다른 필드(ai_key 등)를 보존하면서 일부만 갱신 */
export function saveConfig(patch: Partial<AppConfig>): void {
  writeConfig({ ...loadConfig(), ...patch })
}

/**
 * AI API 키 저장 — 데이터 폴더가 아닌 userData에 두는 이유:
 * 데이터 폴더는 백업·복사·공유 대상이라 키가 따라다니면 유출 경로가 된다.
 * Windows에서는 DPAPI로 암호화되어 현재 로그인 계정만 복호화할 수 있다.
 */
export function setAiKey(key: string | null): void {
  const config = loadConfig()
  if (!key) {
    delete config.ai_key
  } else if (safeStorage.isEncryptionAvailable()) {
    config.ai_key = `enc:${safeStorage.encryptString(key).toString('base64')}`
  } else {
    console.warn('safeStorage unavailable — storing AI key base64-encoded only')
    config.ai_key = `plain:${Buffer.from(key, 'utf-8').toString('base64')}`
  }
  writeConfig(config)
}

export function getAiKey(): string | null {
  const raw = loadConfig().ai_key
  if (!raw) return null
  try {
    if (raw.startsWith('enc:')) {
      return safeStorage.decryptString(Buffer.from(raw.slice(4), 'base64'))
    }
    if (raw.startsWith('plain:')) {
      return Buffer.from(raw.slice(6), 'base64').toString('utf-8')
    }
  } catch (e) {
    console.error('failed to decrypt AI key', e)
  }
  return null
}
