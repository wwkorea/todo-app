import path from 'node:path'
import fs from 'node:fs'
import { BrowserWindow, Menu, Tray, app, dialog, ipcMain, nativeImage, shell } from 'electron'
import { loadConfig, saveConfig } from './config'
import {
  createTab,
  deleteItem,
  ensureDataDir,
  loadAll,
  saveGlobalSettings,
  saveItem,
  saveTabSetting
} from './store'
import type { GlobalSettings, Item, TabSetting } from '../shared/types'

let mainWindow: BrowserWindow | null = null
let tray: Tray | null = null
let quitting = false

function requireDataDir(): string {
  const { dataDir } = loadConfig()
  if (!dataDir) throw new Error('data directory is not configured')
  return dataDir
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
    return loadAll(dataDir)
  })

  ipcMain.handle('data:load', () => loadAll(requireDataDir()))

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
    return loadAll(requireDataDir())
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
}

app.whenReady().then(() => {
  registerIpc()
  createWindow()
  createTray()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
    else mainWindow?.show()
  })
})

app.on('before-quit', () => {
  quitting = true
})

app.on('window-all-closed', () => {
  // 트레이 상주 앱이므로 창이 모두 닫혀도 종료하지 않음 (명시적 종료만)
})
