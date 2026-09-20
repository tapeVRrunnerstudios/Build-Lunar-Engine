/*
 * Lunar Blueprints — visual node-graph scripting, the no-code alternative
 * to LunarScript. Same host API (self/input/time/math/spawn/etc), same
 * events (Start/Update/Collision), different authoring surface.
 *
 * Graph shape:
 * {
 *   nodes: [ { id, type, x, y, data: {...} } ],
 *   links: [ { from: nodeId, fromPort: name, to: nodeId, toPort: name, kind: "exec"|"data" } ]
 * }
 *
 * Node catalogue lives in BP_NODE_DEFS below — each def declares its exec
 * and data ports so the editor UI and the runtime share one source of truth.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.LunarBlueprint = factory();
})(typeof self !== "undefined" ? self : this, function () {
"use strict";

// Each node type declares: category, execIn/execOut (booleans), dataIn (named list),
// dataOut (named list), and either exec(ctx,node,inputs) for action/flow nodes
// or eval(ctx,node,inputs) for pure value nodes.
const BP_NODE_DEFS = {
  // ---- Events (graph entry points, exec-out only) ----
  "Event/OnStart":     { category: "event", event: "start", execOut: ["out"] },
  "Event/OnUpdate":    { category: "event", event: "update", execOut: ["out"], dataOut: ["dt"] },
  "Event/OnCollision": { category: "event", event: "collision", execOut: ["out"], dataOut: ["other"] },

  // ---- Flow control ----
  "Flow/If": {
    category: "flow", execIn: true, execOut: ["true", "false"], dataIn: ["cond"],
    exec(ctx, node, inp) { return inp.cond ? "true" : "false"; }
  },
  "Flow/Sequence": {
    category: "flow", execIn: true, execOut: ["1", "2", "3"],
    exec(ctx, node, inp, run) { run("1"); run("2"); run("3"); return null; }
  },

  // ---- Actions (side effects on self / world) ----
  "Action/MoveBy": {
    category: "action", execIn: true, execOut: ["out"], dataIn: ["dx", "dy"],
    exec(ctx) { return "out"; },
    apply(ctx, inp) { ctx.self.x += (inp.dx || 0); ctx.self.y += (inp.dy || 0); }
  },
  "Action/SetVelocity": {
    category: "action", execIn: true, execOut: ["out"], dataIn: ["vx", "vy"],
    apply(ctx, inp) { ctx.self.velX = inp.vx || 0; ctx.self.velY = inp.vy || 0; }
  },
  "Action/Print": {
    category: "action", execIn: true, execOut: ["out"], dataIn: ["value"],
    apply(ctx, inp) { (ctx.print || console.log)(String(inp.value)); }
  },
  "Action/DestroySelf": {
    category: "action", execIn: true, execOut: ["out"],
    apply(ctx) { if (ctx.destroySelf) ctx.destroySelf(); }
  },
  "Action/PlayAnimation": {
    category: "action", execIn: true, execOut: ["out"], dataIn: ["name"],
    apply(ctx, inp) { if (ctx.playAnimation) ctx.playAnimation(inp.name); }
  },
  "Action/Spawn": {
    category: "action", execIn: true, execOut: ["out"], dataIn: ["name"],
    apply(ctx, inp) { if (ctx.spawn) ctx.spawn(inp.name); }
  },

  // ---- Values (pure, no exec pins) ----
  "Value/Number":     { category: "value", dataOut: ["value"], eval: (ctx, node) => Number(node.data.value || 0) },
  "Value/String":     { category: "value", dataOut: ["value"], eval: (ctx, node) => String(node.data.value || "") },
  "Value/Bool":       { category: "value", dataOut: ["value"], eval: (ctx, node) => !!node.data.value },
  "Value/SelfX":      { category: "value", dataOut: ["value"], eval: (ctx) => ctx.self.x },
  "Value/SelfY":      { category: "value", dataOut: ["value"], eval: (ctx) => ctx.self.y },
  "Value/KeyDown":    { category: "value", dataIn: ["key"], dataOut: ["value"], eval: (ctx, node, inp) => !!(ctx.input && ctx.input.key(inp.key || node.data.key)) },
  "Value/Compare": {
    category: "value", dataIn: ["a", "b"], dataOut: ["value"],
    eval(ctx, node, inp) {
      const a = inp.a, b = inp.b, op = node.data.op || "==";
      switch (op) { case "==": return a === b; case "!=": return a !== b; case "<": return a < b; case ">": return a > b; case "<=": return a <= b; case ">=": return a >= b; }
      return false;
    }
  },
  "Value/Math": {
    category: "value", dataIn: ["a", "b"], dataOut: ["value"],
    eval(ctx, node, inp) {
      const a = Number(inp.a || 0), b = Number(inp.b || 0), op = node.data.op || "+";
      switch (op) { case "+": return a + b; case "-": return a - b; case "*": return a * b; case "/": return a / (b || 1); }
      return 0;
    }
  },
  "Value/And": { category: "value", dataIn: ["a", "b"], dataOut: ["value"], eval: (ctx, node, inp) => !!(inp.a && inp.b) },
  "Value/Or":  { category: "value", dataIn: ["a", "b"], dataOut: ["value"], eval: (ctx, node, inp) => !!(inp.a || inp.b) },
  "Value/Not": { category: "value", dataIn: ["a"], dataOut: ["value"], eval: (ctx, node, inp) => !inp.a },
};

class BlueprintGraph {
  constructor(graphData, host) {
    this.nodes = new Map((graphData.nodes || []).map(n => [n.id, n]));
    this.links = graphData.links || [];
    this.host = host || {};
  }

  hasEvent(name) { for (const n of this.nodes.values()) { const def = BP_NODE_DEFS[n.type]; if (def && def.category === "event" && def.event === name) return true; } return false; }

  // find the single link feeding a given data input port
  findDataLink(nodeId, port) { return this.links.find(l => l.kind !== "exec" && l.to === nodeId && l.toPort === port); }
  // find all exec links leaving a given exec output port
  findExecLinks(nodeId, port) { return this.links.filter(l => l.kind === "exec" && l.from === nodeId && l.fromPort === port); }

  // Resolve the value a node itself produces on a given data-out port —
  // either a literal/eval'd value node, or a pseudo-value from the event
  // that is currently firing (dt, other, ...).
  resolveNodeOutput(node, port, ctx, depthGuard) {
    const def = BP_NODE_DEFS[node.type];
    if (!def) return undefined;
    if (def.category === "event") {
      if (!this._eventArgNames) return undefined;
      const idx = this._eventArgNames.indexOf(port);
      return idx >= 0 ? this._eventArgs[idx] : undefined;
    }
    if (def.eval) {
      const inputs = {};
      for (const p of def.dataIn || []) inputs[p] = this.evalData(node.id, p, ctx, depthGuard + 1);
      return def.eval(ctx, node, inputs);
    }
    return undefined;
  }

  evalData(nodeId, port, ctx, depthGuard = 0) {
    if (depthGuard > 500) throw new Error("Blueprint: data cycle detected");
    const link = this.findDataLink(nodeId, port);
    const node = this.nodes.get(nodeId);
    if (!link) {
      // no wire: fall back to the node's own literal field of the same name, if any
      return node && node.data ? node.data[port] : undefined;
    }
    const srcNode = this.nodes.get(link.from);
    if (!srcNode) return undefined;
    return this.resolveNodeOutput(srcNode, link.fromPort, ctx, depthGuard);
  }

  runExec(nodeId, ctx, guard = { n: 0 }) {
    if (!nodeId) return;
    if (++guard.n > 100000) throw new Error("Blueprint: possible infinite loop");
    const node = this.nodes.get(nodeId);
    if (!node) return;
    const def = BP_NODE_DEFS[node.type];
    if (!def) return;
    const inputs = {};
    for (const p of def.dataIn || []) inputs[p] = this.evalData(node.id, p, ctx);
    if (def.apply) def.apply(ctx, inputs, node);
    let outPort = "out";
    if (def.exec) outPort = def.exec(ctx, node, inputs, (port) => {
      for (const link of this.findExecLinks(node.id, port)) this.runExec(link.to, ctx, guard);
    }) || null;
    if (outPort) for (const link of this.findExecLinks(node.id, outPort)) this.runExec(link.to, ctx, guard);
  }

  trigger(eventName, args, ctx) {
    for (const node of this.nodes.values()) {
      const def = BP_NODE_DEFS[node.type];
      if (def && def.category === "event" && def.event === eventName) {
        const fullCtx = Object.assign({}, ctx, { _eventArgs: args });
        // seed data-out for event nodes (e.g. dt, other) via a synthetic lookup
        this._eventArgNames = def.dataOut || [];
        this._eventArgs = args || [];
        for (const link of this.findExecLinks(node.id, "out")) this.runExec(link.to, fullCtx);
      }
    }
  }
}

function compile(graphData, host) { return new BlueprintGraph(graphData, host); }

return { BP_NODE_DEFS, BlueprintGraph, compile };
});
