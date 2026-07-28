import { contextBridge, ipcRenderer } from 'electron'
import type { AppData, GlobalSettings, Item, TabSetting } from '../shared/types'

const api = {
  getConfig: (): Promise<{ dataDir: string | null }> => ipcRenderer.invoke('config:get'),
  pickDir: (): Promise<string | null> => ipcRenderer.invoke('dialog:pick-dir'),
  initData: (dataDir: string): Promise<AppData> => ipcRenderer.invoke('data:init', dataDir),
  loadData: (): Promise<AppData> => ipcRenderer.invoke('data:load'),
  saveItem: (tabDir: string, item: Item, backupKeep: number): Promise<void> =>
    ipcRenderer.invoke('item:save', tabDir, item, backupKeep),
  deleteItem: (tabDir: string, id: string, backupKeep: number): Promise<void> =>
    ipcRenderer.invoke('item:delete', tabDir, id, backupKeep),
  saveTabSetting: (tabDir: string, setting: TabSetting): Promise<void> =>
    ipcRenderer.invoke('tab:save-setting', tabDir, setting),
  createTab: (folder: string, setting: TabSetting): Promise<AppData> =>
    ipcRenderer.invoke('tab:create', folder, setting),
  saveSettings: (settings: GlobalSettings): Promise<void> =>
    ipcRenderer.invoke('settings:save', settings)
}

export type Api = typeof api

contextBridge.exposeInMainWorld('api', api)
