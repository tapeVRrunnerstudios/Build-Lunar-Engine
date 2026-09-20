/*
 * LunarScript — the native scripting language of Lunar Engine.
 *
 * on start { ... }              runs once when the entity spawns
 * on update(dt) { ... }         runs every frame
 * on collision(other) { ... }   runs when this entity's collider hits another
 *
 * let x = 5;
 * fn add(a, b) { return a + b; }
 * if (self.x > 100) { self.x = 0; }
 * while (x < 10) { x = x + 1; }
 * for (let i = 0; i < 5; i = i + 1) { print(i); }
 *
 * Built-ins: self.*, input.key()/mouseDown()/mouseX/mouseY, time.dt/time.now,
 * math.*, print(), random(a,b), spawn(name), findByName(name), distance(a,b)
 *
 * This file has zero dependencies and runs in the browser or in Node.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.LunarScript = factory();
})(typeof self !== "undefined" ? self : this, function () {
"use strict";

// ---------------------------------------------------------------- LEXER ----
const KEYWORDS = new Set(["let","fn","if","else","while","for","on","return",
  "true","false","break","continue","null","and","or","not"]);

class Token {
  constructor(type, value, line) { this.type = type; this.value = value; this.line = line; }
}

class LunarSyntaxError extends Error {
  constructor(msg, line) { super(`LunarScript syntax error (line ${line}): ${msg}`); this.line = line; }
}

class LunarRuntimeError extends Error {
  constructor(msg, line) { super(`LunarScript runtime error${line ? " (line " + line + ")" : ""}: ${msg}`); this.line = line; }
}

function lex(src) {
  const tokens = [];
  let i = 0, line = 1;
  const n = src.length;
  const isDigit = c => c >= "0" && c <= "9";
  const isAlpha = c => /[A-Za-z_]/.test(c);
  const isAlnum = c => /[A-Za-z0-9_]/.test(c);

  while (i < n) {
    const c = src[i];
    if (c === "\n") { line++; i++; continue; }
    if (c === " " || c === "\t" || c === "\r") { i++; continue; }
    if (c === "/" && src[i + 1] === "/") { while (i < n && src[i] !== "\n") i++; continue; }
    if (c === "/" && src[i + 1] === "*") { i += 2; while (i < n && !(src[i] === "*" && src[i + 1] === "/")) { if (src[i] === "\n") line++; i++; } i += 2; continue; }

    if (c === '"' || c === "'") {
      const quote = c; let j = i + 1; let out = "";
      while (j < n && src[j] !== quote) {
        if (src[j] === "\\" && j + 1 < n) { const esc = src[j + 1]; out += esc === "n" ? "\n" : esc === "t" ? "\t" : esc; j += 2; }
        else { out += src[j]; j++; }
      }
      if (j >= n) throw new LunarSyntaxError("unterminated string", line);
      tokens.push(new Token("STRING", out, line));
      i = j + 1; continue;
    }

    if (isDigit(c) || (c === "." && isDigit(src[i + 1]))) {
      let j = i; while (j < n && (isDigit(src[j]) || src[j] === ".")) j++;
      tokens.push(new Token("NUMBER", parseFloat(src.slice(i, j)), line));
      i = j; continue;
    }

    if (isAlpha(c)) {
      let j = i; while (j < n && isAlnum(src[j])) j++;
      const word = src.slice(i, j);
      tokens.push(new Token(KEYWORDS.has(word) ? word.toUpperCase() : "IDENT", word, line));
      i = j; continue;
    }

    const two = src.slice(i, i + 2);
    if (["==", "!=", "<=", ">=", "&&", "||", "+=", "-=", "*=", "/="].includes(two)) {
      tokens.push(new Token(two, two, line)); i += 2; continue;
    }
    if ("+-*/%()=<>!{},;.".includes(c)) { tokens.push(new Token(c, c, line)); i++; continue; }

    throw new LunarSyntaxError(`unexpected character '${c}'`, line);
  }
  tokens.push(new Token("EOF", null, line));
  return tokens;
}

// --------------------------------------------------------------- PARSER ----
// AST node shape: { kind, ...fields, line }
class Parser {
  constructor(tokens) { this.toks = tokens; this.pos = 0; }
  peek(o = 0) { return this.toks[this.pos + o]; }
  at(...types) { return types.includes(this.peek().type); }
  advance() { return this.toks[this.pos++]; }
  expect(type, msg) {
    if (!this.at(type)) throw new LunarSyntaxError(msg || `expected '${type}' but got '${this.peek().type}'`, this.peek().line);
    return this.advance();
  }

  parseProgram() {
    const events = [], functions = [], globals = [];
    while (!this.at("EOF")) {
      if (this.at("ON")) events.push(this.parseEvent());
      else if (this.at("FN")) functions.push(this.parseFunc());
      else globals.push(this.parseStatement());
    }
    return { kind: "Program", events, functions, globals };
  }

  parseEvent() {
    const line = this.advance().line; // 'on'
    const name = this.expect("IDENT", "expected event name after 'on'").value;
    const params = [];
    if (this.at("(")) {
      this.advance();
      while (!this.at(")")) { params.push(this.expect("IDENT").value); if (this.at(",")) this.advance(); }
      this.advance();
    }
    const body = this.parseBlock();
    return { kind: "Event", name, params, body, line };
  }

  parseFunc() {
    const line = this.advance().line; // 'fn'
    const name = this.expect("IDENT", "expected function name").value;
    this.expect("(");
    const params = [];
    while (!this.at(")")) { params.push(this.expect("IDENT").value); if (this.at(",")) this.advance(); }
    this.advance();
    const body = this.parseBlock();
    return { kind: "Func", name, params, body, line };
  }

  parseBlock() {
    this.expect("{");
    const stmts = [];
    while (!this.at("}")) stmts.push(this.parseStatement());
    this.expect("}");
    return { kind: "Block", stmts };
  }

  parseStatement() {
    if (this.at("LET")) return this.parseLet();
    if (this.at("IF")) return this.parseIf();
    if (this.at("WHILE")) return this.parseWhile();
    if (this.at("FOR")) return this.parseFor();
    if (this.at("RETURN")) { const line = this.advance().line; const arg = this.at(";") ? null : this.parseExpr(); this.expect(";"); return { kind: "Return", arg, line }; }
    if (this.at("BREAK")) { const line = this.advance().line; this.expect(";"); return { kind: "Break", line }; }
    if (this.at("CONTINUE")) { const line = this.advance().line; this.expect(";"); return { kind: "Continue", line }; }
    if (this.at("{")) return this.parseBlock();
    const line = this.peek().line;
    const expr = this.parseExpr();
    this.expect(";", "expected ';' after expression");
    return { kind: "ExprStmt", expr, line };
  }

  parseLet() {
    const line = this.advance().line;
    const name = this.expect("IDENT").value;
    let init = null;
    if (this.at("=")) { this.advance(); init = this.parseExpr(); }
    this.expect(";");
    return { kind: "Let", name, init, line };
  }

  parseIf() {
    const line = this.advance().line;
    this.expect("(");
    const cond = this.parseExpr();
    this.expect(")");
    const then = this.parseBlock();
    let elseBranch = null;
    if (this.at("ELSE")) { this.advance(); elseBranch = this.at("IF") ? this.parseIf() : this.parseBlock(); }
    return { kind: "If", cond, then, elseBranch, line };
  }

  parseWhile() {
    const line = this.advance().line;
    this.expect("(");
    const cond = this.parseExpr();
    this.expect(")");
    const body = this.parseBlock();
    return { kind: "While", cond, body, line };
  }

  parseFor() {
    const line = this.advance().line;
    this.expect("(");
    const init = this.at(";") ? null : (this.at("LET") ? this.parseLet() : (() => { const e = { kind: "ExprStmt", expr: this.parseExpr(), line }; this.expect(";"); return e; })());
    if (!init) this.expect(";");
    const cond = this.at(";") ? { kind: "Bool", value: true } : this.parseExpr();
    this.expect(";");
    const update = this.at(")") ? null : this.parseExpr();
    this.expect(")");
    const body = this.parseBlock();
    return { kind: "For", init, cond, update, body, line };
  }

  // expr precedence: assignment > or > and > equality > comparison > term > factor > unary > call > primary
  parseExpr() { return this.parseAssignment(); }

  parseAssignment() {
    const line = this.peek().line;
    const left = this.parseOr();
    if (this.at("=", "+=", "-=", "*=", "/=")) {
      const op = this.advance().type;
      const value = this.parseAssignment();
      if (left.kind !== "Ident" && left.kind !== "Member") throw new LunarSyntaxError("invalid assignment target", line);
      return { kind: "Assign", op, target: left, value, line };
    }
    return left;
  }

  parseOr() { let l = this.parseAnd(); while (this.at("||", "OR")) { const line = this.advance().line; l = { kind: "Logical", op: "||", left: l, right: this.parseAnd(), line }; } return l; }
  parseAnd() { let l = this.parseEquality(); while (this.at("&&", "AND")) { const line = this.advance().line; l = { kind: "Logical", op: "&&", left: l, right: this.parseEquality(), line }; } return l; }
  parseEquality() { let l = this.parseComparison(); while (this.at("==", "!=")) { const op = this.advance().type; l = { kind: "Binary", op, left: l, right: this.parseComparison() }; } return l; }
  parseComparison() { let l = this.parseTerm(); while (this.at("<", ">", "<=", ">=")) { const op = this.advance().type; l = { kind: "Binary", op, left: l, right: this.parseTerm() }; } return l; }
  parseTerm() { let l = this.parseFactor(); while (this.at("+", "-")) { const op = this.advance().type; l = { kind: "Binary", op, left: l, right: this.parseFactor() }; } return l; }
  parseFactor() { let l = this.parseUnary(); while (this.at("*", "/", "%")) { const op = this.advance().type; l = { kind: "Binary", op, left: l, right: this.parseUnary() }; } return l; }

  parseUnary() {
    if (this.at("!", "NOT") || (this.at("-"))) {
      const op = this.advance().type;
      return { kind: "Unary", op: (op === "NOT" ? "!" : op), arg: this.parseUnary() };
    }
    return this.parseCall();
  }

  parseCall() {
    let expr = this.parsePrimary();
    for (;;) {
      if (this.at("(")) {
        this.advance();
        const args = [];
        while (!this.at(")")) { args.push(this.parseExpr()); if (this.at(",")) this.advance(); }
        this.advance();
        expr = { kind: "Call", callee: expr, args };
      } else if (this.at(".")) {
        this.advance();
        const name = this.expect("IDENT").value;
        expr = { kind: "Member", object: expr, prop: name };
      } else break;
    }
    return expr;
  }

  parsePrimary() {
    const t = this.peek();
    if (this.at("NUMBER")) { this.advance(); return { kind: "Number", value: t.value }; }
    if (this.at("STRING")) { this.advance(); return { kind: "String", value: t.value }; }
    if (this.at("TRUE")) { this.advance(); return { kind: "Bool", value: true }; }
    if (this.at("FALSE")) { this.advance(); return { kind: "Bool", value: false }; }
    if (this.at("NULL")) { this.advance(); return { kind: "Null" }; }
    if (this.at("IDENT")) { this.advance(); return { kind: "Ident", name: t.value }; }
    if (this.at("(")) { this.advance(); const e = this.parseExpr(); this.expect(")"); return e; }
    throw new LunarSyntaxError(`unexpected token '${t.type}'`, t.line);
  }
}

function parse(src) { return new Parser(lex(src)).parseProgram(); }

// ------------------------------------------------------------ INTERPRETER --
class Environment {
  constructor(parent = null) { this.vars = new Map(); this.parent = parent; }
  declare(name, value) { this.vars.set(name, value); }
  has(name) { return this.vars.has(name) || (this.parent && this.parent.has(name)); }
  get(name) {
    if (this.vars.has(name)) return this.vars.get(name);
    if (this.parent) return this.parent.get(name);
    throw new LunarRuntimeError(`undefined variable '${name}'`);
  }
  set(name, value) {
    if (this.vars.has(name)) { this.vars.set(name, value); return; }
    if (this.parent) return this.parent.set(name, value);
    // implicit global declaration, forgiving for beginners
    this.vars.set(name, value);
  }
}

const BREAK = Symbol("break"), CONTINUE = Symbol("continue");
class ReturnSignal { constructor(value) { this.value = value; } }

class LunarFunction {
  constructor(decl, closure) { this.decl = decl; this.closure = closure; }
  call(interp, args) {
    const env = new Environment(this.closure);
    this.decl.params.forEach((p, i) => env.declare(p, args[i] !== undefined ? args[i] : null));
    const result = interp.execBlock(this.decl.body, env);
    return result instanceof ReturnSignal ? result.value : null;
  }
}

class Program {
  constructor(source, host) {
    this.ast = parse(source);
    this.host = host || {};
    this.globals = new Environment();
    this.globals.declare("self", this.host.self || {});
    this.globals.declare("input", this.host.input || {});
    this.globals.declare("time", this.host.time || {});
    this.globals.declare("math", Object.assign({ PI: Math.PI, abs: Math.abs, floor: Math.floor, ceil: Math.ceil,
      round: Math.round, sqrt: Math.sqrt, sin: Math.sin, cos: Math.cos, min: Math.min, max: Math.max,
      clamp: (v, a, b) => Math.min(b, Math.max(a, v)) }, this.host.math || {}));
    this.globals.declare("print", (...a) => (this.host.print || console.log)(...a));
    this.globals.declare("random", (a, b) => a + Math.random() * (b - a));
    this.globals.declare("distance", (a, b) => Math.hypot((a.x || 0) - (b.x || 0), (a.y || 0) - (b.y || 0)));
    this.globals.declare("spawn", (name) => (this.host.spawn ? this.host.spawn(name) : null));
    this.globals.declare("findByName", (name) => (this.host.findByName ? this.host.findByName(name) : null));
    this.functions = new Map();
    for (const fn of this.ast.functions) this.functions.set(fn.name, new LunarFunction(fn, this.globals));
    for (const [name, fn] of this.functions) this.globals.declare(name, (...args) => fn.call(this, args));
    this.events = new Map();
    for (const ev of this.ast.events) this.events.set(ev.name, ev);
    for (const stmt of this.ast.globals) this.execStatement(stmt, this.globals);
  }

  trigger(eventName, args = []) {
    const ev = this.events.get(eventName);
    if (!ev) return;
    const env = new Environment(this.globals);
    ev.params.forEach((p, i) => env.declare(p, args[i] !== undefined ? args[i] : null));
    this.execBlock(ev.body, env);
  }

  hasEvent(name) { return this.events.has(name); }

  execBlock(block, env) {
    for (const stmt of block.stmts) {
      const sig = this.execStatement(stmt, env);
      if (sig === BREAK || sig === CONTINUE || sig instanceof ReturnSignal) return sig;
    }
    return null;
  }

  execStatement(stmt, env) {
    switch (stmt.kind) {
      case "Let": env.declare(stmt.name, stmt.init ? this.evalExpr(stmt.init, env) : null); return null;
      case "ExprStmt": this.evalExpr(stmt.expr, env); return null;
      case "Block": { const inner = new Environment(env); return this.execBlock(stmt, inner); }
      case "If": {
        if (this.truthy(this.evalExpr(stmt.cond, env))) return this.execBlock(stmt.then, new Environment(env));
        if (stmt.elseBranch) return stmt.elseBranch.kind === "If" ? this.execStatement(stmt.elseBranch, env) : this.execBlock(stmt.elseBranch, new Environment(env));
        return null;
      }
      case "While": {
        let guard = 0;
        while (this.truthy(this.evalExpr(stmt.cond, env))) {
          if (++guard > 2_000_000) throw new LunarRuntimeError("possible infinite loop in while", stmt.line);
          const sig = this.execBlock(stmt.body, new Environment(env));
          if (sig === BREAK) break;
          if (sig instanceof ReturnSignal) return sig;
        }
        return null;
      }
      case "For": {
        const scope = new Environment(env);
        if (stmt.init) this.execStatement(stmt.init, scope);
        let guard = 0;
        while (this.truthy(this.evalExpr(stmt.cond, scope))) {
          if (++guard > 2_000_000) throw new LunarRuntimeError("possible infinite loop in for", stmt.line);
          const sig = this.execBlock(stmt.body, new Environment(scope));
          if (sig === BREAK) break;
          if (sig instanceof ReturnSignal) return sig;
          if (stmt.update) this.evalExpr(stmt.update, scope);
        }
        return null;
      }
      case "Return": return new ReturnSignal(stmt.arg ? this.evalExpr(stmt.arg, env) : null);
      case "Break": return BREAK;
      case "Continue": return CONTINUE;
      default: throw new LunarRuntimeError(`unknown statement '${stmt.kind}'`);
    }
  }

  truthy(v) { return v !== false && v !== null && v !== undefined && v !== 0 && v !== ""; }

  evalExpr(node, env) {
    switch (node.kind) {
      case "Number": case "String": case "Bool": return node.value;
      case "Null": return null;
      case "Ident": return env.get(node.name);
      case "Member": { const obj = this.evalExpr(node.object, env); return obj == null ? null : obj[node.prop]; }
      case "Assign": {
        const val = this.evalExpr(node.value, env);
        let finalVal = val;
        if (node.op !== "=") {
          const cur = this.evalExpr(node.target, env);
          finalVal = node.op === "+=" ? cur + val : node.op === "-=" ? cur - val : node.op === "*=" ? cur * val : cur / val;
        }
        if (node.target.kind === "Ident") env.set(node.target.name, finalVal);
        else { const obj = this.evalExpr(node.target.object, env); if (obj) obj[node.target.prop] = finalVal; }
        return finalVal;
      }
      case "Logical": {
        const l = this.evalExpr(node.left, env);
        if (node.op === "&&") return this.truthy(l) ? this.evalExpr(node.right, env) : l;
        return this.truthy(l) ? l : this.evalExpr(node.right, env);
      }
      case "Unary": {
        const v = this.evalExpr(node.arg, env);
        return node.op === "!" ? !this.truthy(v) : -v;
      }
      case "Binary": {
        const l = this.evalExpr(node.left, env), r = this.evalExpr(node.right, env);
        switch (node.op) {
          case "+": return l + r; case "-": return l - r; case "*": return l * r;
          case "/": return l / r; case "%": return l % r;
          case "==": return l === r; case "!=": return l !== r;
          case "<": return l < r; case ">": return l > r; case "<=": return l <= r; case ">=": return l >= r;
        }
        break;
      }
      case "Call": {
        const args = node.args.map(a => this.evalExpr(a, env));
        if (node.callee.kind === "Member") {
          const obj = this.evalExpr(node.callee.object, env);
          const fn = obj ? obj[node.callee.prop] : null;
          if (typeof fn !== "function") throw new LunarRuntimeError(`'${node.callee.prop}' is not a function`);
          return fn.apply(obj, args);
        }
        const fn = this.evalExpr(node.callee, env);
        if (typeof fn !== "function") throw new LunarRuntimeError(`value is not callable`);
        return fn(...args);
      }
      default: throw new LunarRuntimeError(`unknown expression '${node.kind}'`);
    }
  }
}

function compile(source, host) { return new Program(source, host); }

return { lex, parse, compile, Program, LunarSyntaxError, LunarRuntimeError };
});
