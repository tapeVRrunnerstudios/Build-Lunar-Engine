"use strict";
const { app, BrowserWindow, ipcMain, dialog, shell } = require("electron");
const path = require("path");
const fs = require("fs/promises");
const fsSync = require("fs");
const { buildDemoProject } = require("./shared/project-template.js");

const PROJECTS_ROOT = path.join(app.getPath("documents"), "Lunar Engine Projects");
const REGISTRY_PATH = path.join(app.getPath("userData"), "lunar-projects.json");

let hubWindow = null;
const editorWindows = new Map(); // projectPath -> BrowserWindow

// ------------------------------------------------------------- REGISTRY ----
async function readRegistry() {
  try {
    const raw = await fs.readFile(REGISTRY_PATH, "utf8");
    const data = JSON.parse(raw);
    return Array.isArray(data.projects) ? data.projects : [];
  } catch {
    return [];
  }
}
async function writeRegistry(projects) {
  await fs.mkdir(path.dirname(REGISTRY_PATH), { recursive: true });
  await fs.writeFile(REGISTRY_PATH, JSON.stringify({ projects }, null, 2), "utf8");
}
async function touchRegistry(entry) {
  const projects = await readRegistry();
  const idx = projects.findIndex(p => p.path === entry.path);
  const merged = { ...(idx >= 0 ? projects[idx] : {}), ...entry, updatedAt: Date.now() };
  if (idx >= 0) projects[idx] = merged; else projects.unshift(merged);
  projects.sort((a, b) => b.updatedAt - a.updatedAt);
  await writeRegistry(projects.slice(0, 100));
  return merged;
}
async function removeFromRegistry(projectPath) {
  const projects = (await readRegistry()).filter(p => p.path !== projectPath);
  await writeRegistry(projects);
}

function sanitizeFileName(name) {
  return (name || "LunarGame").replace(/[<>:"/\\|?*\x00-\x1F]/g, "_").replace(/\s+/g, "_").slice(0, 80) || "LunarGame";
}

// ---------------------------------------------------------------- WINDOWS --
function createHubWindow() {
  hubWindow = new BrowserWindow({
    width: 960, height: 680, minWidth: 720, minHeight: 480,
    title: "Lunar Engine",
    backgroundColor: "#101218",
    webPreferences: { preload: path.join(__dirname, "preload.js"), contextIsolation: true, nodeIntegration: false },
  });
  hubWindow.setMenuBarVisibility(false);
  hubWindow.loadFile(path.join(__dirname, "hub.html"));
  hubWindow.on("closed", () => { hubWindow = null; });
}

function createEditorWindow(projectPath, projectMeta) {
  const existing = editorWindows.get(projectPath);
  if (existing && !existing.isDestroyed()) { existing.focus(); return existing; }
  const win = new BrowserWindow({
    width: 1400, height: 900, minWidth: 900, minHeight: 600,
    title: `${projectMeta.name} — Lunar Engine`,
    backgroundColor: "#0c0e12",
    webPreferences: { preload: path.join(__dirname, "preload.js"), contextIsolation: true, nodeIntegration: false },
  });
  win.setMenuBarVisibility(false);
  win._lunarProjectPath = projectPath;
  win._lunarProjectMeta = projectMeta;
  win.loadFile(path.join(__dirname, "editor", "index.html"));
  win.on("closed", () => editorWindows.delete(projectPath));
  editorWindows.set(projectPath, win);
  return win;
}

// -------------------------------------------------------------------- IPC --
ipcMain.handle("projects:list", async () => {
  const projects = await readRegistry();
  // drop entries whose file no longer exists, without blocking the UI on a slow disk
  const alive = [];
  for (const p of projects) { if (fsSync.existsSync(p.path)) alive.push(p); }
  if (alive.length !== projects.length) await writeRegistry(alive);
  return alive;
});

ipcMain.handle("projects:create", async (_evt, { name, language }) => {
  const safeName = sanitizeFileName(name);
  let folder = path.join(PROJECTS_ROOT, safeName);
  let n = 2;
  while (fsSync.existsSync(folder)) { folder = path.join(PROJECTS_ROOT, `${safeName}_${n}`); n++; }
  await fs.mkdir(folder, { recursive: true });
  const filePath = path.join(folder, "project.lunagame");
  const projectJson = buildDemoProject(name, language);
  await fs.writeFile(filePath, JSON.stringify(projectJson, null, 2), "utf8");
  const meta = await touchRegistry({ path: filePath, name, language });
  const win = createEditorWindow(filePath, meta);
  return { path: filePath, meta };
});

ipcMain.handle("projects:open", async (_evt, { path: projectPath }) => {
  const projects = await readRegistry();
  const meta = projects.find(p => p.path === projectPath) || { path: projectPath, name: path.basename(path.dirname(projectPath)), language: "lunarscript" };
  await touchRegistry(meta);
  createEditorWindow(projectPath, meta);
  return { ok: true };
});

ipcMain.handle("projects:import", async () => {
  const result = await dialog.showOpenDialog(hubWindow, { properties: ["openFile"], filters: [{ name: "Lunar Engine Project", extensions: ["lunagame", "json"] }] });
  if (result.canceled || !result.filePaths.length) return { ok: false };
  const filePath = result.filePaths[0];
  let projectName = path.basename(filePath, path.extname(filePath));
  let language = "lunarscript";
  try { const data = JSON.parse(await fs.readFile(filePath, "utf8")); projectName = data.projectName || projectName; language = data.projectLanguage || language; } catch {}
  const meta = await touchRegistry({ path: filePath, name: projectName, language });
  createEditorWindow(filePath, meta);
  return { ok: true, path: filePath };
});

ipcMain.handle("projects:remove", async (_evt, { path: projectPath }) => { await removeFromRegistry(projectPath); return { ok: true }; });
ipcMain.handle("projects:revealInFolder", async (_evt, { path: projectPath }) => { shell.showItemInFolder(projectPath); return { ok: true }; });

// called by an editor window to learn which project it is showing
ipcMain.handle("project:context", (evt) => {
  const win = BrowserWindow.fromWebContents(evt.sender);
  return { path: win?._lunarProjectPath || null, meta: win?._lunarProjectMeta || null };
});
ipcMain.handle("project:load", async (_evt, { path: projectPath }) => {
  const raw = await fs.readFile(projectPath, "utf8");
  return { ok: true, data: raw };
});
ipcMain.handle("project:save", async (_evt, { path: projectPath, data, name, language }) => {
  await fs.mkdir(path.dirname(projectPath), { recursive: true });
  await fs.writeFile(projectPath, data, "utf8");
  await touchRegistry({ path: projectPath, name, language });
  return { ok: true };
});
ipcMain.handle("project:exportGame", async (_evt, { defaultName, html }) => {
  const result = await dialog.showSaveDialog({ defaultPath: `${sanitizeFileName(defaultName)}.html`, filters: [{ name: "Standalone Game", extensions: ["html"] }] });
  if (result.canceled || !result.filePath) return { ok: false };
  await fs.writeFile(result.filePath, html, "utf8");
  return { ok: true, path: result.filePath };
});
ipcMain.handle("hub:openProjectsFolder", async () => { await fs.mkdir(PROJECTS_ROOT, { recursive: true }); shell.openPath(PROJECTS_ROOT); return { ok: true }; });
ipcMain.handle("hub:focus", () => { if (hubWindow && !hubWindow.isDestroyed()) hubWindow.focus(); else createHubWindow(); return { ok: true }; });

// ------------------------------------------------------------- LIFECYCLE ---
app.whenReady().then(async () => {
  await fs.mkdir(PROJECTS_ROOT, { recursive: true });
  createHubWindow();
  app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) createHubWindow(); });
});
app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
