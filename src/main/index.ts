import path from 'node:path'
import fs from 'node:fs'
import { BrowserWindow, Menu, Tray, app, dialog, ipcMain, nativeImage, shell } from 'electron'
import { getAiKey, loadConfig, saveConfig, setAiKey } from './config'
import {
  createTab,
  deleteItem,
  ensureDataDir,
  loadAdvice,
  loadAll,
  loadChat,
  saveAdvice,
  saveChat,
  saveGlobalSettings,
  saveItem,
  saveTabSetting
} from './store'
import type { AdviceRecord, ChatEntry, GlobalSettings, Item, TabSetting } from '../shared/types'

let mainWindow: BrowserWindow | null = null
let tray: Tray | null = null
let quitting = false

function requireDataDir(): string {
  const { dataDir } = loadConfig()
  if (!dataDir) throw new Error('data directory is not configured')
  return dataDir
}

/** 구버전 마이그레이션: settings.json에 평문 api_key가 있으면 암호화 저장소로 옮기고 제거 */
function loadAllMigrated(dataDir: string): ReturnType<typeof loadAll> {
  const data = loadAll(dataDir)
  const ai = data.settings.ai as ((typeof data.settings)['ai'] & { api_key?: string }) | undefined
  if (ai?.api_key) {
    if (!getAiKey()) setAiKey(ai.api_key)
    delete ai.api_key
    saveGlobalSettings(dataDir, data.settings)
  }
  return data
}

function createTrayIcon(): Electron.NativeImage {
  // 16x16 단색(포인트 컬러) 사각형 아이콘을 코드로 생성 (BGRA)
  const size = 16
  const buf = Buffer.alloc(size * size * 4)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4
      const edge = x === 0 || y === 0 || x === size - 1 || y === size - 1
      buf[i] = edge ? 120 : 237 // B
      buf[i + 1] = edge ? 90 : 111 // G
      buf[i + 2] = edge ? 60 : 47 // R
      buf[i + 3] = 255 // A
    }
  }
  return nativeImage.createFromBitmap(buf, { width: size, height: size })
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 800,
    minWidth: 700,
    minHeight: 500,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  // 본문 링크로 인한 페이지 이동/새 창은 전부 차단하고, 대신 OS 기본 프로그램으로 연결
  // (에디터 링크 툴팁의 '열기' 버튼도 이 경로를 탄다)
  const openLinkExternally = (url: string): void => {
    if (url.startsWith('file://')) {
      const p = decodeURI(url.replace(/^file:\/{2,3}/, ''))
      if (fs.existsSync(p)) void shell.openPath(p)
    } else if (/^https?:\/\//i.test(url)) {
      void shell.openExternal(url)
    }
  }
  mainWindow.webContents.on('will-navigate', (e, url) => {
    const devUrl = process.env.ELECTRON_RENDERER_URL
    if (devUrl && url.startsWith(devUrl)) return
    e.preventDefault()
    openLinkExternally(url)
  })
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    openLinkExternally(url)
    return { action: 'deny' }
  })

  // 창 닫기 = 트레이로 숨김 (항상 띄워두는 앱)
  mainWindow.on('close', (e) => {
    if (!quitting) {
      e.preventDefault()
      mainWindow?.hide()
    }
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'))
  }
}

function createTray(): void {
  tray = new Tray(createTrayIcon())
  tray.setToolTip('Todo')
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: '열기', click: () => mainWindow?.show() },
      { type: 'separator' },
      {
        label: '종료',
        click: () => {
          quitting = true
          app.quit()
        }
      }
    ])
  )
  tray.on('double-click', () => mainWindow?.show())
}

function registerIpc(): void {
  ipcMain.handle('config:get', () => loadConfig())

  ipcMain.handle('dialog:pick-dir', async () => {
    if (!mainWindow) return null
    const result = await dialog.showOpenDialog(mainWindow, {
      title: '데이터 저장 폴더 선택',
      properties: ['openDirectory', 'createDirectory']
    })
    return result.canceled ? null : result.filePaths[0]
  })

  ipcMain.handle('data:init', (_e, dataDir: string) => {
    if (!dataDir || !fs.existsSync(path.dirname(dataDir))) {
      throw new Error(`invalid data directory: ${dataDir}`)
    }
    ensureDataDir(dataDir)
    saveConfig({ dataDir })
    return loadAllMigrated(dataDir)
  })

  ipcMain.handle('data:load', () => loadAllMigrated(requireDataDir()))

  ipcMain.handle('item:save', (_e, tabDir: string, item: Item, backupKeep: number) => {
    saveItem(requireDataDir(), tabDir, item, backupKeep)
  })

  ipcMain.handle('item:delete', (_e, tabDir: string, id: string, backupKeep: number) => {
    deleteItem(requireDataDir(), tabDir, id, backupKeep)
  })

  ipcMain.handle('tab:save-setting', (_e, tabDir: string, setting: TabSetting) => {
    saveTabSetting(requireDataDir(), tabDir, setting)
  })

  ipcMain.handle('tab:create', (_e, folder: string, setting: TabSetting) => {
    if (!/^[\w-]+$/.test(folder)) throw new Error('탭 폴더명은 영문/숫자/-/_ 만 가능합니다')
    createTab(requireDataDir(), folder, setting)
    return loadAllMigrated(requireDataDir())
  })

  ipcMain.handle('settings:save', (_e, settings: GlobalSettings) => {
    saveGlobalSettings(requireDataDir(), settings)
  })

  // ---- 파일 링크 (본문의 file:// 링크 → 기본 연결 프로그램으로 실행) ----

  ipcMain.handle('dialog:pick-file', async () => {
    if (!mainWindow) return null
    const result = await dialog.showOpenDialog(mainWindow, {
      title: '링크할 파일 선택',
      properties: ['openFile']
    })
    return result.canceled ? null : result.filePaths[0]
  })

  ipcMain.handle('file:open', async (_e, p: string) => {
    if (!fs.existsSync(p)) {
      return { ok: false, error: '파일을 찾을 수 없습니다 (이동/삭제되었을 수 있음)' }
    }
    const err = await shell.openPath(p)
    return err ? { ok: false, error: err } : { ok: true }
  })

  ipcMain.handle('file:open-external', (_e, url: string) => {
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url)
  })

  // ---- AI 도움말 사이드카 ----

  ipcMain.handle('advice:load', () => loadAdvice(requireDataDir()))

  ipcMain.handle('advice:save', (_e, tabDir: string, id: string, record: AdviceRecord) => {
    saveAdvice(requireDataDir(), tabDir, id, record)
  })

  // ---- AI 대화 사이드카 ----

  ipcMain.handle('chat:load', (_e, tabDir: string, id: string) =>
    loadChat(requireDataDir(), tabDir, id)
  )

  ipcMain.handle('chat:save', (_e, tabDir: string, id: string, entries: ChatEntry[]) => {
    saveChat(requireDataDir(), tabDir, id, entries)
  })

  // ---- AI API 키 (userData에 safeStorage 암호화 저장 — 데이터 폴더에 넣지 않음) ----

  ipcMain.handle('ai:set-key', (_e, key: string | null) => {
    setAiKey(key && key.trim() ? key.trim() : null)
  })

  ipcMain.handle('ai:has-key', () => getAiKey() !== null)

  // ---- 사내 LLM 호출 (OpenAI 호환 chat/completions) ----
  // renderer의 CSP/CORS 제약을 피하기 위해 main 프로세스에서 호출한다
  // API 키는 renderer를 거치지 않고 main에서 직접 읽는다
  ipcMain.handle(
    'ai:complete',
    async (
      _e,
      cfg: { base_url: string; model: string },
      messages: { role: string; content: string }[]
    ): Promise<{ ok: boolean; content?: string; error?: string }> => {
      try {
        const apiKey = getAiKey()
        const url = `${cfg.base_url.replace(/\/+$/, '')}/chat/completions`
        const controller = new AbortController()
        const timer = setTimeout(() => controller.abort(), 120_000)
        const res = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {})
          },
          body: JSON.stringify({ model: cfg.model, messages, temperature: 0.2 }),
          signal: controller.signal
        }).finally(() => clearTimeout(timer))
        if (!res.ok) {
          const text = (await res.text()).slice(0, 300)
          return { ok: false, error: `HTTP ${res.status}: ${text}` }
        }
        const data = (await res.json()) as {
          choices?: { message?: { content?: string } }[]
        }
        const content = data.choices?.[0]?.message?.content
        if (!content) return { ok: false, error: '응답에 content가 없습니다' }
        return { ok: true, content }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        return { ok: false, error: msg.includes('abort') ? '요청 시간 초과 (120초)' : msg }
      }
    }
  )
}

// 단일 인스턴스: 이미 실행 중이면 새 프로세스는 즉시 종료하고 기존 창을 앞으로 띄운다
// (중복 실행 시 프로세스·트레이 아이콘이 누적되는 문제 방지)
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return
    mainWindow.show()
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.focus()
  })

  app.whenReady().then(() => {
    registerIpc()
    createWindow()
    createTray()

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
      else mainWindow?.show()
    })
  })
}

app.on('before-quit', () => {
  quitting = true
})

app.on('window-all-closed', () => {
  // 트레이 상주 앱이므로 창이 모두 닫혀도 종료하지 않음 (명시적 종료만)
})
