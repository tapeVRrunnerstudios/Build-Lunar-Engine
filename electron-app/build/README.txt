Drop your own icons here to replace the default Electron icon:
  icon.ico   (Windows, 256x256 multi-size .ico)
  icon.icns  (macOS)
  icon.png   (Linux, 512x512)

Then add to package.json's "build" section, e.g.:
  "win": { "target": ["nsis"], "icon": "build/icon.ico" }
  "mac": { "target": ["dmg"], "icon": "build/icon.icns" }
  "linux": { "target": ["AppImage"], "icon": "build/icon.png" }

Without this, electron-builder uses its own default icon — the app still builds and runs fine.
