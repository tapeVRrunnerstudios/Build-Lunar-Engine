"use strict";
// Builds the same demo project a fresh "New Project" produces in the browser
// editor, but from the main process (no DOM available), so the Hub can
// write a ready-to-open .lunagame file to disk before the editor even opens.
const Engine = require("../engine/engine-core.js");

const LUNARSCRIPT_DEMO = `// Move with arrow keys, jump with Space.
on start {
  print("Player ready! Arrow keys to move, Space to jump.");
}

on update(dt) {
  if (input.key("ArrowLeft")) {
    self.velX = -180;
  } else if (input.key("ArrowRight")) {
    self.velX = 180;
  } else {
    self.velX = self.velX * 0.85;
  }
  if (input.key("Space") && self.velY < 15 && self.velY > -15) {
    self.velY = -270;
  }
}

on collision(other) {
  print("Touched " + other.name);
}
`;

function demoBlueprintGraph() {
  return {
    nodes: [
      { id: "ev", type: "Event/OnUpdate", x: 40, y: 40, data: {} },
      { id: "keyL", type: "Value/KeyDown", x: 40, y: 160, data: { key: "ArrowLeft" } },
      { id: "keyR", type: "Value/KeyDown", x: 40, y: 260, data: { key: "ArrowRight" } },
      { id: "ifL", type: "Flow/If", x: 260, y: 40, data: {} },
      { id: "ifR", type: "Flow/If", x: 480, y: 40, data: {} },
      { id: "negSpeed", type: "Value/Number", x: 260, y: 200, data: { value: -3 } },
      { id: "posSpeed", type: "Value/Number", x: 480, y: 200, data: { value: 3 } },
      { id: "moveL", type: "Action/MoveBy", x: 260, y: 320, data: {} },
      { id: "moveR", type: "Action/MoveBy", x: 480, y: 320, data: {} },
    ],
    links: [
      { kind: "exec", from: "ev", fromPort: "out", to: "ifL", toPort: "in" },
      { kind: "data", from: "keyL", fromPort: "value", to: "ifL", toPort: "cond" },
      { kind: "exec", from: "ifL", fromPort: "true", to: "moveL", toPort: "in" },
      { kind: "data", from: "negSpeed", fromPort: "value", to: "moveL", toPort: "dx" },
      { kind: "exec", from: "ifL", fromPort: "false", to: "ifR", toPort: "in" },
      { kind: "data", from: "keyR", fromPort: "value", to: "ifR", toPort: "cond" },
      { kind: "exec", from: "ifR", fromPort: "true", to: "moveR", toPort: "in" },
      { kind: "data", from: "posSpeed", fromPort: "value", to: "moveR", toPort: "dx" },
    ],
  };
}

// Pure — identical shape to the browser editor's sceneToJSON(), no DOM involved.
function sceneToJSON(scene) {
  return {
    name: scene.name, nextId: scene.nextId,
    entities: scene.entities.map(e => ({
      id: e.id, name: e.name, active: e.active, tag: e.tag, parent: e.parent ? e.parent.id : null,
      transform: { ...e.transform.position }, rotation: e.transform.rotation, scale: { ...e.transform.scale },
      sprite: (() => { const s = e.get(Engine.SpriteRenderer); return s && { color: s.color, width: s.width, height: s.height, shape: s.shape, opacity: s.opacity, visible: s.visible, sortingLayer: s.sortingLayer, image: s.image, imageName: s.imageName }; })(),
      animator: (() => { const a = e.get(Engine.Animator); return a && { clips: a.clips, current: a.current, playing: a.playing, time: a.time }; })(),
      rb: (() => { const rb = e.get(Engine.Rigidbody2D); return rb && { bodyType: rb.bodyType, gravityScale: rb.gravityScale, restitution: rb.restitution, useGravity: rb.useGravity, velocity: { ...rb.velocity } }; })(),
      col: (() => { const c = e.get(Engine.BoxCollider2D); return c && { size: { ...c.size }, isTrigger: c.isTrigger }; })(),
      particle: (() => { const p = e.get(Engine.ParticleEmitter); return p && { rate: p.rate, life: p.life, speed: p.speed, gravity: p.gravity, size: p.size, color: p.color }; })(),
      script: (() => { const s = e.get(Engine.ScriptComponent); return s && { language: s.language, source: s.source, graph: s.graph, enabled: s.enabled }; })(),
    })),
  };
}

function buildDemoProject(name, language) {
  const scene = new Engine.Scene("Main Scene");

  const p = scene.create("Player");
  p.transform.position = { x: -150, y: -100 };
  p.get(Engine.SpriteRenderer).shape = "circle";
  p.add(new Engine.Rigidbody2D());
  p.add(new Engine.BoxCollider2D());
  const script = p.add(new Engine.ScriptComponent());
  script.language = language;
  if (language === "blueprint") script.graph = demoBlueprintGraph();
  else script.source = LUNARSCRIPT_DEMO;

  const g = scene.create("Ground");
  g.transform.position = { x: 0, y: 170 };
  Object.assign(g.get(Engine.SpriteRenderer), { color: "#454b58", width: 720, height: 50 });
  g.add(new Engine.Rigidbody2D()).bodyType = "Static";
  g.add(Object.assign(new Engine.BoxCollider2D(), { size: { x: 720, y: 50 } }));

  const pl = scene.create("Platform");
  pl.transform.position = { x: 120, y: 25 };
  Object.assign(pl.get(Engine.SpriteRenderer), { color: "#596273", width: 220, height: 30 });
  pl.add(new Engine.Rigidbody2D()).bodyType = "Static";
  pl.add(Object.assign(new Engine.BoxCollider2D(), { size: { x: 220, y: 30 } }));

  const em = scene.create("Particles");
  em.transform.position = { x: 240, y: -100 };
  em.get(Engine.SpriteRenderer).visible = false;
  em.add(Object.assign(new Engine.ParticleEmitter(), { rate: 18 }));

  return {
    format: "LUNAGAME", formatVersion: 3, engine: "Lunar Engine", engineVersion: "0.6.0",
    projectName: name, projectLanguage: language,
    images: [],
    scene: sceneToJSON(scene),
  };
}

module.exports = { buildDemoProject };
