"use strict";
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("lunarDesktop", {
  isDesktop: true,
  listProjects: () => ipcRenderer.invoke("projects:list"),
  createProject: (name, language) => ipcRenderer.invoke("projects:create", { name, language }),
  openProject: (path) => ipcRenderer.invoke("projects:open", { path }),
  importProject: () => ipcRenderer.invoke("projects:import"),
  removeProject: (path) => ipcRenderer.invoke("projects:remove", { path }),
  revealInFolder: (path) => ipcRenderer.invoke("projects:revealInFolder", { path }),
  openProjectsFolder: () => ipcRenderer.invoke("hub:openProjectsFolder"),
  focusHub: () => ipcRenderer.invoke("hub:focus"),

  // used inside an editor window
  getContext: () => ipcRenderer.invoke("project:context"),
  loadProject: (path) => ipcRenderer.invoke("project:load", { path }),
  saveProject: (path, data, name, language) => ipcRenderer.invoke("project:save", { path, data, name, language }),
  exportGame: (defaultName, html) => ipcRenderer.invoke("project:exportGame", { defaultName, html }),
});
