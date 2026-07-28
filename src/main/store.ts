import fs from 'node:fs'
import path from 'node:path'
import matter from 'gray-matter'
import {
  AppData,
  DEFAULT_GLOBAL_SETTINGS,
  DEFAULT_TOKENS,
  GlobalSettings,
  Item,
  ItemMeta,
  TabData,
  TabSetting,
  defaultTabSetting
} from '../shared/types'

const EXCLUDE_DIRS = new Set(['backup', 'backup_days'])

function ts(): string {
  const d = new Date()
  const p = (n: number, w = 2): string => String(n).padStart(w, '0')
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}T${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
}

function today(): string {
  return ts().slice(0, 8)
}

/** 임시파일에 쓴 뒤 rename — 저장 중 크래시에도 원본이 깨지지 않게 */
function atomicWrite(filePath: string, content: string): void {
  const tmp = `${filePath}.tmp`
  fs.writeFileSync(tmp, content, 'utf-8')
  fs.renameSync(tmp, filePath)
}

function readJson<T>(filePath: string, fallback: T): T {
  try {
    return { ...fallback, ...JSON.parse(fs.readFileSync(filePath, 'utf-8')) }
  } catch {
    return fallback
  }
}

/** 데이터 디렉토리 초기화: settings.json과 기본 탭(todos/memos)이 없으면 생성 */
export function ensureDataDir(dataDir: string): void {
  fs.mkdirSync(dataDir, { recursive: true })

  const settingsPath = path.join(dataDir, 'settings.json')
  if (!fs.existsSync(settingsPath)) {
    atomicWrite(settingsPath, JSON.stringify(DEFAULT_GLOBAL_SETTINGS, null, 2))
  }

  const tabDirs = scanTabDirs(dataDir)
  if (tabDirs.length === 0) {
    createTab(dataDir, 'todos', defaultTabSetting('Todos', 'todo'))
    createTab(dataDir, 'memos', defaultTabSetting('Memos', 'memo'))
  }
}

function scanTabDirs(dataDir: string): string[] {
  return fs
    .readdirSync(dataDir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && !EXCLUDE_DIRS.has(e.name))
    .filter((e) => fs.existsSync(path.join(dataDir, e.name, 'setting.json')))
    .map((e) => e.name)
}

export function createTab(dataDir: string, folder: string, setting: TabSetting): void {
  const dir = path.join(dataDir, folder)
  fs.mkdirSync(dir, { recursive: true })
  atomicWrite(path.join(dir, 'setting.json'), JSON.stringify(setting, null, 2))
}

function loadTab(dataDir: string, tabDir: string): TabData {
  const dir = path.join(dataDir, tabDir)
  const setting = readJson<TabSetting>(
    path.join(dir, 'setting.json'),
    defaultTabSetting(tabDir, 'todo')
  )
  // 구버전 setting.json 보정: tags 키가 없으면 탭 타입에 맞는 기본값
  if (!Array.isArray(setting.tags)) {
    setting.tags = defaultTabSetting(setting.name, setting.type).tags
  }
  // 구버전 토큰 목록(3종) → 6종 기본값으로 업그레이드 (사용자가 직접 고친 목록은 유지)
  if (
    !Array.isArray(setting.tokens) ||
    setting.tokens.join(',') === '미처리,진행중,완료'
  ) {
    setting.tokens = [...DEFAULT_TOKENS]
  }
  const items: Item[] = []
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith('.md')) continue
    try {
      const raw = fs.readFileSync(path.join(dir, f), 'utf-8')
      const parsed = matter(raw)
      const meta = parsed.data as ItemMeta & { tested?: boolean; v2_applied?: boolean }
      const id = meta.id ?? f.replace(/\.md$/, '')
      // 구버전 마이그레이션: tested / v2_applied 불리언 → 태그
      const tags = Array.isArray(meta.tags) ? meta.tags.map(String) : []
      if (meta.tested === true && !tags.includes('테스트완료')) tags.push('테스트완료')
      if (meta.v2_applied === true && !tags.includes('v2반영')) tags.push('v2반영')
      delete meta.tested
      delete meta.v2_applied
      items.push({
        ...meta,
        id: String(id),
        title: meta.title ?? id,
        tags,
        created_at: String(meta.created_at ?? ''),
        updated_at: String(meta.updated_at ?? ''),
        body: parsed.content.replace(/^\n/, '')
      })
    } catch (e) {
      console.error(`failed to parse ${tabDir}/${f}`, e)
    }
  }
  // order 배열 순서대로 정렬, order에 없는 파일(외부 추가분)은 끝에
  const orderIndex = new Map(setting.order.map((id, i) => [id, i]))
  items.sort((a, b) => {
    const ia = orderIndex.has(a.id) ? orderIndex.get(a.id)! : Number.MAX_SAFE_INTEGER
    const ib = orderIndex.has(b.id) ? orderIndex.get(b.id)! : Number.MAX_SAFE_INTEGER
    return ia - ib || a.id.localeCompare(b.id)
  })
  return { dir: tabDir, setting, items }
}

export function loadAll(dataDir: string): AppData {
  ensureDataDir(dataDir)
  const settings = readJson<GlobalSettings>(
    path.join(dataDir, 'settings.json'),
    DEFAULT_GLOBAL_SETTINGS
  )
  const dirs = scanTabDirs(dataDir)
  // settings.tab_order 순서 우선, 새 폴더는 끝에. 순서 미지정이면 todos가 맨 앞
  const base = settings.tab_order.length > 0 ? settings.tab_order : ['todos']
  const ordered = [
    ...base.filter((d) => dirs.includes(d)),
    ...dirs.filter((d) => !base.includes(d))
  ]
  return { dataDir, settings, tabs: ordered.map((d) => loadTab(dataDir, d)) }
}

/** 저장 직전 원본을 backup/(파일별 롤링 N개) + backup_days/(하루 1회)로 복사 */
function backupFile(dataDir: string, tabDir: string, id: string, keep: number): void {
  const src = path.join(dataDir, tabDir, `${id}.md`)
  if (!fs.existsSync(src)) return

  const bdir = path.join(dataDir, 'backup', tabDir)
  fs.mkdirSync(bdir, { recursive: true })
  fs.copyFileSync(src, path.join(bdir, `${id}_${ts()}.md`))
  const siblings = fs
    .readdirSync(bdir)
    .filter((f) => f.startsWith(`${id}_`) && f.endsWith('.md'))
    .sort()
    .reverse()
  for (const old of siblings.slice(Math.max(keep, 1))) {
    fs.unlinkSync(path.join(bdir, old))
  }

  const ddir = path.join(dataDir, 'backup_days', today(), tabDir)
  fs.mkdirSync(ddir, { recursive: true })
  const dayDest = path.join(ddir, `${id}.md`)
  if (!fs.existsSync(dayDest)) fs.copyFileSync(src, dayDest)
}

export function saveItem(dataDir: string, tabDir: string, item: Item, backupKeep: number): void {
  const { body, ...meta } = item
  const cleanMeta: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(meta)) {
    if (v === undefined || v === null || v === '') continue
    if (Array.isArray(v) && v.length === 0) continue
    cleanMeta[k] = v
  }
  const content = matter.stringify(body.endsWith('\n') ? body : `${body}\n`, cleanMeta)
  backupFile(dataDir, tabDir, item.id, backupKeep)
  atomicWrite(path.join(dataDir, tabDir, `${item.id}.md`), content)
}

export function deleteItem(dataDir: string, tabDir: string, id: string, backupKeep: number): void {
  backupFile(dataDir, tabDir, id, backupKeep)
  const p = path.join(dataDir, tabDir, `${id}.md`)
  if (fs.existsSync(p)) fs.unlinkSync(p)
}

export function saveTabSetting(dataDir: string, tabDir: string, setting: TabSetting): void {
  atomicWrite(path.join(dataDir, tabDir, 'setting.json'), JSON.stringify(setting, null, 2))
}

export function saveGlobalSettings(dataDir: string, settings: GlobalSettings): void {
  atomicWrite(path.join(dataDir, 'settings.json'), JSON.stringify(settings, null, 2))
}
