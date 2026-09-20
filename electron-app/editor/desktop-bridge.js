// Runs only inside the Electron editor window (window.lunarDesktop is injected
// by preload.js). In a plain browser tab this script no-ops and the editor
// behaves exactly like the standalone version (download/upload .lunagame files).
(function () {
  if (!window.lunarDesktop) return;

  let projectPath = null;

  document.getElementById("new").textContent = "☰ Hub";
  document.getElementById("new").onclick = () => window.lunarDesktop.focusHub();
  document.getElementById("load").style.display = "none";
  document.getElementById("build").textContent = "💾 Export Game";

  window.save = async function () {
    if (!projectPath) { log("No project file open yet.", "err"); return; }
    const data = projectData();
    const res = await window.lunarDesktop.saveProject(projectPath, data, state.projectName, state.projectLanguage);
    if (res && res.ok) log("Saved " + projectPath);
    else log("Save failed.", "err");
  };
  document.getElementById("save").onclick = save;

  window.buildGamePackage = async function () {
    log("Exporting standalone game…");
    const runtime = exportedRuntime();
    const res = await window.lunarDesktop.exportGame(state.projectName, runtime);
    if (res && res.ok) log("Exported playable game to " + res.path + " — open it in any browser, or package it with Electron/nexe for a real .exe.");
    else log("Export canceled.");
  };
  document.getElementById("build").onclick = buildGamePackage;

  (async () => {
    const ctx = await window.lunarDesktop.getContext();
    projectPath = ctx && ctx.path;
    if (!projectPath) { log("No project file associated with this window.", "err"); return; }
    const res = await window.lunarDesktop.loadProject(projectPath);
    if (res && res.ok) {
      try { loadProjectData(res.data); log("Opened " + projectPath); }
      catch (err) { log("Failed to open project: " + err.message, "err"); }
    } else {
      log("Could not read project file.", "err");
    }
  })();
})();
