/**
 * Preload bridge: exposes a typed, minimal API surface to the renderer
 * through `contextBridge`, keeping `contextIsolation` enabled.
 */
import { contextBridge, ipcRenderer } from 'electron';
import type { HmclApi, LauncherEvent } from '@hmcl/shared';

const api: HmclApi = {
  listInstalledVersions: () => ipcRenderer.invoke('versions:list'),
  fetchRemoteVersions: () => ipcRenderer.invoke('versions:remote'),
  installVersion: (id) => ipcRenderer.invoke('versions:install', id),
  fetchLoaderVersions: (kind, mcVersion) => ipcRenderer.invoke('loaders:list', kind, mcVersion),
  installLoader: (kind, mcVersion, loaderId) =>
    ipcRenderer.invoke('loaders:install', kind, mcVersion, loaderId),
  detectJava: () => ipcRenderer.invoke('java:detect'),
  pickJavaExecutable: () => ipcRenderer.invoke('java:pick-executable'),
  pickDirectory: (title) => ipcRenderer.invoke('settings:pick-directory', title),
  getSystemMemory: () => ipcRenderer.invoke('system:memory'),
  searchModrinthProjects: (payload) => ipcRenderer.invoke('modrinth:search', payload.type, payload.query, payload.gameVersion, payload.categories, payload.index, payload.offset, payload.limit),
  fetchModrinthCategories: (projectType) => ipcRenderer.invoke('modrinth:categories', projectType),
  fetchModrinthVersions: (projectIdOrSlug) => ipcRenderer.invoke('modrinth:versions', projectIdOrSlug),
  downloadAddonFile: (instanceId, subdir, version) =>
    ipcRenderer.invoke('addon:download', instanceId, subdir, version),
  saveAddonFile: (url, filename) => ipcRenderer.invoke('addon:save-file', url, filename),
  pickModpackFile: () => ipcRenderer.invoke('modpack:pick'),
  inspectModpackFile: (path) => ipcRenderer.invoke('modpack:inspect', path),
  installModpackFile: (path, instanceName) => ipcRenderer.invoke('modpack:install-file', path, instanceName),
  installModrinthModpack: (projectId, versionId, instanceName) =>
    ipcRenderer.invoke('modpack:install-modrinth', projectId, versionId, instanceName),
  modpackOtherVersions: (instanceId) => ipcRenderer.invoke('modpack:other-versions', instanceId),
  modpackExportDefaults: (instanceId) => ipcRenderer.invoke('modpack:export-defaults', instanceId),
  exportModpack: (instanceId, info) => ipcRenderer.invoke('modpack:export', instanceId, info),
  getSettings: () => ipcRenderer.invoke('settings:get'),
  saveSettings: (settings) => ipcRenderer.invoke('settings:save', settings),
  launch: (versionId) => ipcRenderer.invoke('launch:start', versionId),
  cancelLaunch: (launchId) => ipcRenderer.invoke('launch:cancel', launchId),
  saveLaunchScript: (versionId) => ipcRenderer.invoke('launch:save-script', versionId),
  stopGame: (launchId) => ipcRenderer.invoke('launch:stop', launchId),
  openExternal: (url) => ipcRenderer.invoke('shell:open-external', url),
  listAccounts: () => ipcRenderer.invoke('accounts:list'),
  addOfflineAccount: (username) => ipcRenderer.invoke('accounts:add-offline', username),
  startMicrosoftLogin: () => ipcRenderer.invoke('accounts:microsoft-start'),
  cancelMicrosoftLogin: () => ipcRenderer.invoke('accounts:microsoft-cancel'),
  removeAccount: (id) => ipcRenderer.invoke('accounts:remove', id),
  selectAccount: (id) => ipcRenderer.invoke('accounts:select', id),
  deleteInstance: (id) => ipcRenderer.invoke('instances:delete', id),
  renameInstance: (oldId, newId) => ipcRenderer.invoke('instances:rename', oldId, newId),
  copyInstance: (sourceId, newId) => ipcRenderer.invoke('instances:copy', sourceId, newId),
  getInstanceSettings: (id) => ipcRenderer.invoke('instance-settings:get', id),
  saveInstanceSettings: (id, settings) =>
    ipcRenderer.invoke('instance-settings:set', id, settings),
  listInstanceFolder: (instanceId, folder) =>
    ipcRenderer.invoke('instance:list-folder', instanceId, folder),
  openInstanceFolder: (instanceId, folder) =>
    ipcRenderer.invoke('instance:open-folder', instanceId, folder),
  deleteInstanceFile: (instanceId, folder, name) =>
    ipcRenderer.invoke('instance:delete-file', instanceId, folder, name),
  setResourcePackEnabled: (instanceId, name, enabled) =>
    ipcRenderer.invoke('instance:set-resource-pack-enabled', instanceId, name, enabled),
  readInstanceIcon: (instanceId) => ipcRenderer.invoke('instance:icon-read', instanceId),
  pickInstanceIcon: (instanceId) => ipcRenderer.invoke('instance:icon-pick', instanceId),
  clearInstanceIcon: (instanceId) => ipcRenderer.invoke('instance:icon-clear', instanceId),
  setInstanceIconType: (instanceId, iconType) =>
    ipcRenderer.invoke('instance:icon-type-set', instanceId, iconType),
  deleteRemoteAssets: (instanceId) => ipcRenderer.invoke('instance:clear-assets', instanceId),
  clearLibraries: () => ipcRenderer.invoke('instance:clear-libraries'),
  cleanInstance: (instanceId) => ipcRenderer.invoke('instance:clean', instanceId),
  pickThemeBackground: () => ipcRenderer.invoke('theme:pick-background'),
  readThemeBackground: (path) => ipcRenderer.invoke('theme:read-background', path),
  setLauncherBackgroundTransparent: (enabled) =>
    ipcRenderer.invoke('theme:set-background-transparent', enabled),
  fixBackgroundTransparency: () => ipcRenderer.invoke('theme:fix-background-transparency'),
  exportLogs: () => ipcRenderer.invoke('logs:export'),
  openLogFolder: () => ipcRenderer.invoke('logs:open-folder'),
  openLogWindow: () => ipcRenderer.invoke('logs:open-window'),
  getLogSnapshot: () => ipcRenderer.invoke('logs:snapshot'),
  appendLog: (line) => ipcRenderer.invoke('logs:append', line),
  clearLogs: () => ipcRenderer.invoke('logs:clear'),
  setLogLines: (count) => ipcRenderer.invoke('logs:set-lines', count),
  setLogAlwaysOnTop: (alwaysOnTop) => ipcRenderer.invoke('logs:always-on-top', alwaysOnTop),
  dumpGameStack: () => ipcRenderer.invoke('logs:dump-stack'),
  renameAccount: (id, username) => ipcRenderer.invoke('accounts:rename', id, username),
  minimizeWindow: () => ipcRenderer.invoke('window:minimize'),
  toggleMaximizeWindow: () => ipcRenderer.invoke('window:toggle-maximize'),
  closeWindow: () => ipcRenderer.invoke('window:close'),
  onEvent: (listener) => {
    const wrapped = (_event: unknown, event: LauncherEvent): void => listener(event);
    ipcRenderer.on('hmcl:event', wrapped);
    return () => ipcRenderer.removeListener('hmcl:event', wrapped);
  }
};

contextBridge.exposeInMainWorld('hmcl', api);
