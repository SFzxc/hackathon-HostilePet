import { contextBridge, ipcRenderer } from 'electron'
import { commandSchema, statusSchema, type DesktopAPI } from '../shared/desktop'
const api: DesktopAPI = {
  status: async () => statusSchema.parse(await ipcRenderer.invoke('desktop:status')),
  command: async (command) => { await ipcRenderer.invoke('desktop:command', commandSchema.parse(command)) },
  onStatus: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, value: unknown): void => {
      const result = statusSchema.safeParse(value)
      if (result.success) listener(result.data)
    }
    ipcRenderer.on('desktop:changed', handler)
    return () => { ipcRenderer.removeListener('desktop:changed', handler) }
  }
}
contextBridge.exposeInMainWorld('desktop', api)
