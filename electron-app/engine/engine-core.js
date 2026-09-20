/*
 * Lunar Engine — core (rendering-agnostic; canvas rendering lives in the editor shell).
 * Real ECS: Entities hold Components, Systems act on the Scene each frame.
 * Ships with a ScriptSystem that drives entities from either a LunarScript
 * program or a Blueprint graph through one shared host API.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(require("./lunarscript.js"), require("./blueprint.js"));
  else root.LunarEngineCore = factory(root.LunarScript, root.LunarBlueprint);
})(typeof self !== "undefined" ? self : this, function (LunarScript, LunarBlueprint) {
"use strict";

// ------------------------------------------------------------- COMPONENTS --
let _uid = 1;
class Component { constructor() { this.enabled = true; this.entity = null; } update() {} }

class Transform extends Component {
  constructor() { super(); this.position = { x: 0, y: 0 }; this.rotation = 0; this.scale = { x: 1, y: 1 }; }
}

class SpriteRenderer extends Component {
  constructor() {
    super();
    this.color = "#8174ff"; this.width = 96; this.height = 96; this.shape = "box";
    this.opacity = 1; this.visible = true; this.sortingLayer = 0; this.image = null; this.imageName = "";
  }
}

class Animator extends Component {
  constructor() { super(); this.clips = {}; this.current = ""; this.playing = false; this.time = 0; }
  play(name) { if (this.clips[name]) { this.current = name; this.playing = true; this.time = 0; } }
  stop() { this.playing = false; this.time = 0; }
  update(dt) {
    if (!this.playing || !this.current || !this.clips[this.current]) return;
    const clip = this.clips[this.current], dur = Math.max(0.001, clip.duration || 1);
    this.time += dt;
    if (this.time > dur) { if (clip.loop) this.time %= dur; else { this.time = dur; this.playing = false; } }
    if (typeof clip.apply === "function") clip.apply(this.entity, this.time);
  }
}

class Rigidbody2D extends Component {
  constructor() { super(); this.bodyType = "Dynamic"; this.velocity = { x: 0, y: 0 }; this.gravityScale = 1; this.restitution = 0.15; this.useGravity = true; }
}

class BoxCollider2D extends Component {
  constructor() { super(); this.size = { x: 96, y: 96 }; this.isTrigger = false; }
}

class ParticleEmitter extends Component {
  constructor() { super(); this.rate = 15; this.life = 1; this.speed = 80; this.gravity = 30; this.size = 5; this.color = "#b7aaff"; this.ps = []; this.acc = 0; }
  update(dt) {
    this.acc += dt * this.rate;
    while (this.acc >= 1) {
      this.acc--;
      this.ps.push({ x: this.entity.transform.position.x, y: this.entity.transform.position.y, vx: (Math.random() - 0.5) * this.speed, vy: (Math.random() - 0.5) * this.speed, life: this.life });
    }
    for (const p of this.ps) { p.life -= dt; p.x += p.vx * dt; p.y += p.vy * dt; p.vy += this.gravity * dt; }
    this.ps = this.ps.filter(p => p.life > 0);
  }
}

// A single script slot on an entity. language: "lunarscript" | "blueprint".
class ScriptComponent extends Component {
  constructor() {
    super();
    this.language = "lunarscript";
    this.source = "on start {\n  print(\"Hello from \" + self.name);\n}\n\non update(dt) {\n  \n}\n";
    this.graph = { nodes: [], links: [] };
    this._compiled = null;
    this._error = null;
    this._startedOk = false;
  }
}

class Entity {
  constructor(id, name) {
    this.id = id; this.name = name; this.active = true; this.tag = "Untagged";
    this.parent = null; this.children = []; this.components = [];
    this.transform = this.add(new Transform());
    this.add(new SpriteRenderer());
  }
  add(c) { c.entity = this; this.components.push(c); return c; }
  remove(c) { const i = this.components.indexOf(c); if (i >= 0) this.components.splice(i, 1); }
  get(T) { return this.components.find(c => c instanceof T) || null; }
  getAll(T) { return this.components.filter(c => c instanceof T); }
}

class Scene {
  constructor(name = "Main Scene") { this.name = name; this.entities = []; this.nextId = 1; }
  create(name = "GameObject") { const e = new Entity(this.nextId++, name); this.entities.push(e); return e; }
  destroy(entity) { const i = this.entities.indexOf(entity); if (i >= 0) this.entities.splice(i, 1); }
  find(id) { return this.entities.find(e => e.id === id) || null; }
  findByName(name) { return this.entities.find(e => e.name === name) || null; }
}

// ----------------------------------------------------------------- INPUT ---
class InputSystem {
  constructor() {
    this.keys = new Set(); this.mouse = { x: 0, y: 0, down: false };
    this._kd = e => this.keys.add(e.code); this._ku = e => this.keys.delete(e.code); this._bl = () => this.keys.clear();
    if (typeof addEventListener === "function") {
      addEventListener("keydown", this._kd); addEventListener("keyup", this._ku); addEventListener("blur", this._bl);
    }
  }
  key(code) { return this.keys.has(code); }
  mouseDown() { return this.mouse.down; }
  dispose() {
    if (typeof removeEventListener === "function") { removeEventListener("keydown", this._kd); removeEventListener("keyup", this._ku); removeEventListener("blur", this._bl); }
  }
}

// --------------------------------------------------------------- PHYSICS ---
// Simple AABB physics with real collision *events* (not just push-out), so
// scripts can react via on collision(other).
class PhysicsSystem {
  constructor() { this.gravity = { x: 0, y: 500 }; this._activePairs = new Set(); }

  step(scene, dt, onCollision) {
    const bodies = scene.entities.filter(e => e.active && e.get(Rigidbody2D) && e.get(BoxCollider2D));
    for (const e of bodies) {
      const rb = e.get(Rigidbody2D);
      if (rb.bodyType === "Dynamic") {
        if (rb.useGravity) rb.velocity.y += this.gravity.y * rb.gravityScale * dt;
        e.transform.position.x += rb.velocity.x * dt;
        e.transform.position.y += rb.velocity.y * dt;
      }
    }
    const stillTouching = new Set();
    for (const a of bodies) {
      const ra = a.get(Rigidbody2D), ca = a.get(BoxCollider2D);
      if (ra.bodyType !== "Dynamic") continue;
      for (const b of bodies) {
        if (a === b) continue;
        const pairKey = a.id < b.id ? `${a.id}:${b.id}` : `${b.id}:${a.id}`;
        const cb = b.get(BoxCollider2D);
        const dx = b.transform.position.x - a.transform.position.x;
        const dy = b.transform.position.y - a.transform.position.y;
        const ox = ca.size.x / 2 + cb.size.x / 2 - Math.abs(dx);
        const oy = ca.size.y / 2 + cb.size.y / 2 - Math.abs(dy);
        if (ox > 0 && oy > 0) {
          stillTouching.add(pairKey);
          // Only fire the script event the frame contact *begins* (like
          // Unity's OnCollisionEnter), not every frame two bodies rest together.
          if (!this._activePairs.has(pairKey)) { this._activePairs.add(pairKey); if (onCollision) onCollision(a, b); }
          if (!ca.isTrigger && !cb.isTrigger) {
            const rb2 = b.get(Rigidbody2D);
            if (!rb2 || rb2.bodyType === "Static") {
              if (ox < oy) { a.transform.position.x += dx > 0 ? -ox : ox; ra.velocity.x *= -ra.restitution; }
              else { a.transform.position.y += dy > 0 ? -oy : oy; ra.velocity.y *= -ra.restitution; }
            }
          }
        }
      }
    }
    for (const key of this._activePairs) if (!stillTouching.has(key)) this._activePairs.delete(key);
  }
}

// ---------------------------------------------------------- SCRIPT SYSTEM --
// Bridges an Entity's live components to a flat, easy-to-script "self" object,
// and drives whichever backend (LunarScript source or Blueprint graph) the
// ScriptComponent is set to. This is the one seam a beginner never has to
// know is there: `self.x = self.x + 1` works identically either way.
function makeSelfHandle(entity, world) {
  const t = entity.transform;
  return {
    get x() { return t.position.x; }, set x(v) { t.position.x = v; },
    get y() { return t.position.y; }, set y(v) { t.position.y = v; },
    get rot() { return t.rotation; }, set rot(v) { t.rotation = v; },
    get scaleX() { return t.scale.x; }, set scaleX(v) { t.scale.x = v; },
    get scaleY() { return t.scale.y; }, set scaleY(v) { t.scale.y = v; },
    get velX() { const rb = entity.get(Rigidbody2D); return rb ? rb.velocity.x : 0; },
    set velX(v) { const rb = entity.get(Rigidbody2D); if (rb) rb.velocity.x = v; },
    get velY() { const rb = entity.get(Rigidbody2D); return rb ? rb.velocity.y : 0; },
    set velY(v) { const rb = entity.get(Rigidbody2D); if (rb) rb.velocity.y = v; },
    get visible() { const s = entity.get(SpriteRenderer); return s ? s.visible : true; },
    set visible(v) { const s = entity.get(SpriteRenderer); if (s) s.visible = v; },
    get color() { const s = entity.get(SpriteRenderer); return s ? s.color : "#ffffff"; },
    set color(v) { const s = entity.get(SpriteRenderer); if (s) s.color = v; },
    get width() { const s = entity.get(SpriteRenderer); return s ? s.width : 0; },
    set width(v) { const s = entity.get(SpriteRenderer); if (s) s.width = v; },
    get height() { const s = entity.get(SpriteRenderer); return s ? s.height : 0; },
    set height(v) { const s = entity.get(SpriteRenderer); if (s) s.height = v; },
    get name() { return entity.name; }, set name(v) { entity.name = v; },
    get tag() { return entity.tag; }, set tag(v) { entity.tag = v; },
    get active() { return entity.active; }, set active(v) { entity.active = v; },
    destroy() { world.destroyEntity(entity); },
    playAnimation(n) { const a = entity.get(Animator); if (a) a.play(n); },
    stopAnimation() { const a = entity.get(Animator); if (a) a.stop(); },
    id: entity.id,
  };
}

class ScriptSystem {
  constructor(world) { this.world = world; }

  makeHost(entity, scriptComp) {
    const self = makeSelfHandle(entity, this.world);
    const input = this.world.input;
    const world = this.world;
    return {
      self, input,
      time: { get dt() { return world.lastDt || 0; }, get now() { return world.time || 0; } },
      print: (...a) => world.log("info", `[${entity.name}] ` + a.join(" ")),
      spawn: (name) => { const e = world.scene.create(name); return makeSelfHandle(e, world); },
      findByName: (name) => { const e = world.scene.findByName(name); return e ? makeSelfHandle(e, world) : null; },
      destroySelf: () => world.destroyEntity(entity),
      playAnimation: (n) => { const a = entity.get(Animator); if (a) a.play(n); },
    };
  }

  compile(entity, s) {
    s._error = null;
    try {
      if (s.language === "blueprint") {
        s._compiled = LunarBlueprint.compile(s.graph, {});
      } else {
        s._compiled = LunarScript.compile(s.source, this.makeHost(entity, s));
      }
    } catch (err) {
      s._compiled = null;
      s._error = err.message || String(err);
      this.world.log("err", `[${entity.name}] ${s._error}`);
    }
  }

  compileAll() {
    for (const e of this.world.scene.entities) {
      const s = e.get(ScriptComponent);
      if (s) this.compile(e, s);
    }
  }

  start() {
    for (const e of this.world.scene.entities) {
      const s = e.get(ScriptComponent);
      if (!s || !s._compiled) continue;
      try {
        if (s.language === "blueprint") s._compiled.trigger("start", [], this.makeHost(e, s));
        else s._compiled.trigger("start");
        s._startedOk = true;
      } catch (err) { this.world.log("err", `[${e.name}] ${err.message || err}`); }
    }
  }

  update(dt) {
    for (const e of this.world.scene.entities) {
      if (!e.active) continue;
      const s = e.get(ScriptComponent);
      if (!s || !s.enabled || !s._compiled) continue;
      try {
        if (s.language === "blueprint") s._compiled.trigger("update", [dt], this.makeHost(e, s));
        else s._compiled.trigger("update", [dt]);
      } catch (err) { this.world.log("err", `[${e.name}] ${err.message || err}`); s.enabled = false; }
    }
  }

  collision(a, b) {
    for (const [self, other] of [[a, b], [b, a]]) {
      const s = self.get(ScriptComponent);
      if (!s || !s.enabled || !s._compiled) continue;
      try {
        const otherHandle = makeSelfHandle(other, this.world);
        if (s.language === "blueprint") s._compiled.trigger("collision", [otherHandle], this.makeHost(self, s));
        else s._compiled.trigger("collision", [otherHandle]);
      } catch (err) { this.world.log("err", `[${self.name}] ${err.message || err}`); }
    }
  }
}

// ------------------------------------------------------------------ WORLD --
// Ties Scene + Input + Physics + ScriptSystem together into one runnable game.
class World {
  constructor(scene, opts = {}) {
    this.scene = scene;
    this.input = opts.input || new InputSystem();
    this.physics = new PhysicsSystem();
    this.scripts = new ScriptSystem(this);
    this.time = 0; this.lastDt = 0;
    this.onLog = opts.onLog || (() => {});
    this._pendingDestroy = [];
  }
  log(level, msg) { this.onLog(level, msg); }
  destroyEntity(entity) { this._pendingDestroy.push(entity); }

  begin() { this.scripts.compileAll(); this.scripts.start(); }

  step(dt) {
    this.lastDt = dt; this.time += dt;
    for (const e of this.scene.entities) {
      if (!e.active) continue;
      for (const c of e.components) { if (c.enabled && !(c instanceof ScriptComponent)) c.update(dt); }
    }
    this.physics.step(this.scene, dt, (a, b) => this.scripts.collision(a, b));
    this.scripts.update(dt);
    if (this._pendingDestroy.length) {
      for (const e of this._pendingDestroy) this.scene.destroy(e);
      this._pendingDestroy.length = 0;
    }
  }

  end() { this.input.dispose && this.scripts === this.scripts; }
}

return {
  Component, Transform, SpriteRenderer, Animator, Rigidbody2D, BoxCollider2D, ParticleEmitter, ScriptComponent,
  Entity, Scene, InputSystem, PhysicsSystem, ScriptSystem, World, makeSelfHandle,
};
});
