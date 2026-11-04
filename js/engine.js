// Schematic WebGL2 viewer. Boxes, orbit, and ray picking — no lighting simulation.
var PlotEngine = (function () {
  const M = PlotMath;
  const FOV = 45 * Math.PI / 180;

  const SOLID_VS = `#version 300 es
layout(location=0) in vec3 aPos;
layout(location=1) in vec3 aNormal;
uniform mat4 uMvp;
uniform mat4 uModel;
out vec3 vNormal;
out vec3 vWorld;
void main() {
  vec4 world = uModel * vec4(aPos, 1.0);
  vWorld = world.xyz;
  vNormal = mat3(uModel) * aNormal;
  gl_Position = uMvp * vec4(aPos, 1.0);
}`;

  const SOLID_FS = `#version 300 es
precision mediump float;
in vec3 vNormal;
in vec3 vWorld;
uniform vec3 uColor;
uniform vec3 uEye;
uniform float uSelect;
out vec4 outColor;
void main() {
  vec3 n = normalize(vNormal);
  vec3 key = normalize(vec3(0.35, 0.9, 0.2));
  vec3 fill = normalize(vec3(-0.55, 0.25, -0.45));
  float shade = 0.34 + 0.62 * max(dot(n, key), 0.0) + 0.22 * max(dot(n, fill), 0.0);
  vec3 color = uColor * min(shade, 1.15);
  vec3 viewDir = normalize(uEye - vWorld);
  float rim = pow(1.0 - max(dot(n, viewDir), 0.0), 2.2);
  color += uColor * rim * 0.15;
  color = mix(color, vec3(0.96, 0.78, 0.42), clamp(uSelect, 0.0, 1.0) * 0.62);
  outColor = vec4(color, 1.0);
}`;

  const LINE_VS = `#version 300 es
layout(location=0) in vec3 aPos;
layout(location=1) in vec3 aColor;
uniform mat4 uViewProj;
out vec3 vColor;
void main() {
  vColor = aColor;
  gl_Position = uViewProj * vec4(aPos, 1.0);
}`;

  const LINE_FS = `#version 300 es
precision mediump float;
in vec3 vColor;
out vec4 outColor;
void main() {
  outColor = vec4(vColor, 1.0);
}`;

  function compile(gl, type, source) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      throw new Error(gl.getShaderInfoLog(shader) || "Не собрался шейдер");
    }
    return shader;
  }

  function program(gl, vs, fs) {
    const prog = gl.createProgram();
    gl.attachShader(prog, compile(gl, gl.VERTEX_SHADER, vs));
    gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, fs));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      throw new Error(gl.getProgramInfoLog(prog) || "Не слинковался шейдер");
    }
    return prog;
  }

  function boxGeometry(gl) {
    const data = [];
    function face(n, a, b, c, d) {
      [a, b, c, a, c, d].forEach(function (v) {
        data.push(v[0], v[1], v[2], n[0], n[1], n[2]);
      });
    }
    const s = 0.5;
    face([1, 0, 0], [s, -s, -s], [s, -s, s], [s, s, s], [s, s, -s]);
    face([-1, 0, 0], [-s, -s, s], [-s, -s, -s], [-s, s, -s], [-s, s, s]);
    face([0, 1, 0], [-s, s, -s], [s, s, -s], [s, s, s], [-s, s, s]);
    face([0, -1, 0], [-s, -s, s], [s, -s, s], [s, -s, -s], [-s, -s, -s]);
    face([0, 0, 1], [-s, -s, s], [-s, s, s], [s, s, s], [s, -s, s]);
    face([0, 0, -1], [s, -s, -s], [s, s, -s], [-s, s, -s], [-s, -s, -s]);

    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(data), gl.STATIC_DRAW);
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 24, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 24, 12);
    gl.bindVertexArray(null);
    return { vao: vao, count: data.length / 6 };
  }

  function composeModel(position, rotation, size, out) {
    const t = M.mat4();
    const r = M.mat4();
    const s = M.mat4();
    const rs = M.mat4();
    M.translation(position, t);
    M.fromEuler(rotation, r);
    M.scaling(size, s);
    M.multiply(r, s, rs);
    M.multiply(t, rs, out);
    return out;
  }

  function Engine(canvas) {
    this.canvas = canvas;
    const gl = canvas.getContext("webgl2", { antialias: true, alpha: false });
    if (!gl) throw new Error("Браузер не дал WebGL2.");
    this.gl = gl;
    this.solid = program(gl, SOLID_VS, SOLID_FS);
    this.lines = program(gl, LINE_VS, LINE_FS);
    this.box = boxGeometry(gl);
    this.lineBuffer = gl.createBuffer();
    this.lineVao = gl.createVertexArray();
    gl.bindVertexArray(this.lineVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.lineBuffer);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 24, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 24, 12);
    gl.bindVertexArray(null);

    this.plot = null;
    this.items = [];
    this.hidden = new Set();
    this.selectedId = null;
    this.hoverId = null;
    this.azimuth = 0.5;
    this.elevation = 0.48;
    this.distance = 24;
    this.target = [0, 3, 3];
    this.ortho = false;
    this.viewName = "orbit";
    this.tool = "look";
    this.ghost = null;
    this.placeHeight = 0;
    this.onSelect = null;
    this.onViewChange = null;
    this.onTransform = null;
    this.onPlace = null;
    this._scratch = {
      proj: M.mat4(),
      view: M.mat4(),
      viewProj: M.mat4(),
      mvp: M.mat4(),
      inv: M.mat4(),
    };
    this._lineVerts = new Float32Array(0);
    this._drag = null;
    this._bindInput();
    const self = this;
    this._frame = function () {
      self._draw();
      self._raf = requestAnimationFrame(self._frame);
    };
    this._raf = requestAnimationFrame(this._frame);
    this._resizeObs = new ResizeObserver(function () { self._draw(); });
    this._resizeObs.observe(canvas);
  }

  Engine.prototype._applyLens = function (item) {
    const obj = item.obj;
    if (obj.kind !== "fixture") {
      item.lens = null;
      return;
    }
    const lensSize = [
      Math.min(obj.size[0] * 0.55, 0.18),
      Math.min(obj.size[1] * 0.42, 0.14),
      Math.min(Math.max(obj.size[2] * 0.18, 0.05), 0.1),
    ];
    const lensModel = M.mat4();
    const local = [0, 0, obj.size[2] / 2 + lensSize[2] / 2];
    const r = M.mat4();
    const t = M.mat4();
    const lt = M.mat4();
    const s = M.mat4();
    const a = M.mat4();
    const b = M.mat4();
    M.fromEuler(obj.rotation, r);
    M.translation(obj.position, t);
    M.translation(local, lt);
    M.scaling(lensSize, s);
    M.multiply(lt, s, a);
    M.multiply(r, a, b);
    M.multiply(t, b, lensModel);
    item.lens = { model: lensModel, color: [0.08, 0.08, 0.09] };
  };

  Engine.prototype._itemFor = function (obj) {
    const model = M.mat4();
    composeModel(obj.position, obj.rotation, obj.size, model);
    const item = {
      obj: obj,
      model: model,
      color: PlotFormat.colorFor(obj),
      lens: null,
    };
    this._applyLens(item);
    return item;
  };

  Engine.prototype.load = function (plot) {
    this.plot = plot;
    this.items = plot.objects.map((obj) => this._itemFor(obj));
    this.hidden.clear();
    this.selectedId = null;
    this.hoverId = null;
    this.ghost = null;
    this.tool = "look";
    this._rebuildLines();
    this.setView("orbit");
    if (this.onSelect) this.onSelect(null);
  };

  Engine.prototype.refresh = function (id) {
    const item = this.items.find(function (entry) { return entry.obj.id === id; });
    if (!item) return;
    composeModel(item.obj.position, item.obj.rotation, item.obj.size, item.model);
    item.color = PlotFormat.colorFor(item.obj);
    this._applyLens(item);
    this._rebuildLines();
  };

  Engine.prototype.addObject = function (obj) {
    this.plot.objects.push(obj);
    this.items.push(this._itemFor(obj));
    this._rebuildLines();
    this.select(obj.id);
  };

  Engine.prototype.removeObject = function (id) {
    this.plot.objects = this.plot.objects.filter(function (obj) { return obj.id !== id; });
    this.items = this.items.filter(function (item) { return item.obj.id !== id; });
    if (this.selectedId === id) this.selectedId = null;
    this._rebuildLines();
    if (this.onSelect) this.onSelect(this.selected());
  };

  Engine.prototype.setGhost = function (obj) {
    this.ghost = obj ? this._itemFor(obj) : null;
  };

  Engine.prototype.syncGhost = function () {
    if (!this.ghost) return;
    composeModel(this.ghost.obj.position, this.ghost.obj.rotation, this.ghost.obj.size, this.ghost.model);
    this.ghost.color = PlotFormat.colorFor(this.ghost.obj);
    this._applyLens(this.ghost);
  };

  Engine.prototype.layers = function () {
    const names = [];
    this.items.forEach(function (item) {
      if (names.indexOf(item.obj.layer) === -1) names.push(item.obj.layer);
    });
    return names;
  };

  Engine.prototype.setLayerVisible = function (layer, visible) {
    if (visible) this.hidden.delete(layer);
    else this.hidden.add(layer);
  };

  Engine.prototype.select = function (id) {
    this.selectedId = id;
    this._rebuildLines();
    if (this.onSelect) this.onSelect(this.selected());
  };

  Engine.prototype.selected = function () {
    const id = this.selectedId;
    const found = this.items.find(function (item) { return item.obj.id === id; });
    return found ? found.obj : null;
  };

  Engine.prototype.focus = function (id) {
    const found = this.items.find(function (item) { return item.obj.id === id; });
    if (!found) return;
    const p = found.obj.position;
    this.target = [p[0], p[1], p[2]];
  };

  Engine.prototype.setView = function (name) {
    this.viewName = name;
    this.ortho = name === "top";
    if (name === "top") {
      this.azimuth = 0;
      this.elevation = 1.15;
    } else if (name === "front") {
      this.azimuth = 0;
      this.elevation = 0.22;
    } else if (name === "side") {
      this.azimuth = Math.PI / 2;
      this.elevation = 0.28;
    } else {
      this.azimuth = 0.55;
      this.elevation = 0.5;
    }
    this.frame();
    if (this.onViewChange) this.onViewChange(name);
  };

  Engine.prototype.frame = function () {
    const visible = this.items.filter((item) => !this.hidden.has(item.obj.layer));
    if (!visible.length) return;
    const min = [Infinity, Infinity, Infinity];
    const max = [-Infinity, -Infinity, -Infinity];
    visible.forEach(function (item) {
      const p = item.obj.position;
      const h = item.obj.size;
      for (let i = 0; i < 3; i++) {
        min[i] = Math.min(min[i], p[i] - h[i] / 2);
        max[i] = Math.max(max[i], p[i] + h[i] / 2);
      }
    });
    this.target = [
      (min[0] + max[0]) / 2,
      (min[1] + max[1]) / 2,
      (min[2] + max[2]) / 2,
    ];
    const extent = Math.max(max[0] - min[0], max[1] - min[1], max[2] - min[2], 4);
    this.distance = Math.max(8, (extent * 0.72) / Math.tan(FOV / 2));
  };

  Engine.prototype._visible = function (item) {
    return !this.hidden.has(item.obj.layer);
  };

  Engine.prototype._eye = function () {
    if (this.ortho) {
      return [this.target[0], this.target[1] + Math.max(this.distance, 4), this.target[2]];
    }
    const ce = Math.cos(this.elevation);
    const se = Math.sin(this.elevation);
    return [
      this.target[0] + this.distance * Math.sin(this.azimuth) * ce,
      this.target[1] + this.distance * se,
      this.target[2] - this.distance * Math.cos(this.azimuth) * ce,
    ];
  };

  Engine.prototype._matrices = function (width, height) {
    const aspect = width / Math.max(height, 1);
    const eye = this._eye();
    const up = this.ortho ? [0, 0, 1] : [0, 1, 0];
    const s = this._scratch;
    M.lookAt(eye, this.target, up, s.view);
    if (this.ortho) {
      const halfH = Math.max(this.distance * 0.42, 2);
      const halfW = halfH * aspect;
      M.ortho(-halfW, halfW, -halfH, halfH, 0.05, 500, s.proj);
    } else {
      M.perspective(FOV, aspect, 0.08, 500, s.proj);
    }
    M.multiply(s.proj, s.view, s.viewProj);
    return eye;
  };

  Engine.prototype._draw = function () {
    const gl = this.gl;
    const canvas = this.canvas;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const width = Math.max(1, Math.floor(canvas.clientWidth * dpr));
    const height = Math.max(1, Math.floor(canvas.clientHeight * dpr));
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    gl.viewport(0, 0, width, height);
    gl.enable(gl.DEPTH_TEST);
    gl.clearColor(0.071, 0.078, 0.094, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    if (!this.items.length && !this.ghost) return;

    const eye = this._matrices(canvas.clientWidth, canvas.clientHeight);
    const s = this._scratch;
    gl.useProgram(this.solid);
    const uMvp = gl.getUniformLocation(this.solid, "uMvp");
    const uModel = gl.getUniformLocation(this.solid, "uModel");
    const uColor = gl.getUniformLocation(this.solid, "uColor");
    const uEye = gl.getUniformLocation(this.solid, "uEye");
    const uSelect = gl.getUniformLocation(this.solid, "uSelect");
    gl.uniform3f(uEye, eye[0], eye[1], eye[2]);
    gl.bindVertexArray(this.box.vao);

    const drawItem = (model, color, id, forced) => {
      M.multiply(s.viewProj, model, s.mvp);
      gl.uniformMatrix4fv(uMvp, false, s.mvp);
      gl.uniformMatrix4fv(uModel, false, model);
      gl.uniform3f(uColor, color[0], color[1], color[2]);
      const selected = forced != null ? forced : id && id === this.selectedId ? 1 : id && id === this.hoverId ? 0.38 : 0;
      gl.uniform1f(uSelect, selected);
      gl.drawArrays(gl.TRIANGLES, 0, this.box.count);
    };

    const structures = [];
    const fixtures = [];
    this.items.forEach((item) => {
      if (!this._visible(item)) return;
      if (item.obj.kind === "fixture") fixtures.push(item);
      else structures.push(item);
    });
    structures.forEach((item) => drawItem(item.model, item.color, item.obj.id));
    // In plan, the pipe sits above the hanging fixture and would hide it.
    if (this.ortho) gl.disable(gl.DEPTH_TEST);
    fixtures.forEach((item) => {
      drawItem(item.model, item.color, item.obj.id);
      if (item.lens) drawItem(item.lens.model, item.lens.color, item.obj.id);
    });
    if (this.ghost) {
      drawItem(this.ghost.model, this.ghost.color, null, 0.85);
      if (this.ghost.lens) drawItem(this.ghost.lens.model, this.ghost.lens.color, null, 0.2);
    }
    if (this.ortho) gl.enable(gl.DEPTH_TEST);

    gl.useProgram(this.lines);
    gl.uniformMatrix4fv(gl.getUniformLocation(this.lines, "uViewProj"), false, s.viewProj);
    gl.bindVertexArray(this.lineVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.lineBuffer);
    gl.drawArrays(gl.LINES, 0, this._lineVerts.length / 6);
    gl.bindVertexArray(null);
  };

  Engine.prototype._rebuildLines = function () {
    const verts = [];
    function push(a, b, color) {
      verts.push(a[0], a[1], a[2], color[0], color[1], color[2]);
      verts.push(b[0], b[1], b[2], color[0], color[1], color[2]);
    }

    if (this.items.length) {
      const min = [Infinity, Infinity];
      const max = [-Infinity, -Infinity];
      this.items.forEach(function (item) {
        const p = item.obj.position;
        const hx = item.obj.size[0] / 2;
        const hz = item.obj.size[2] / 2;
        min[0] = Math.min(min[0], p[0] - hx);
        min[1] = Math.min(min[1], p[2] - hz);
        max[0] = Math.max(max[0], p[0] + hx);
        max[1] = Math.max(max[1], p[2] + hz);
      });
      const x0 = Math.floor(min[0]) - 2;
      const x1 = Math.ceil(max[0]) + 2;
      const z0 = Math.floor(min[1]) - 2;
      const z1 = Math.ceil(max[1]) + 2;
      const span = Math.max(x1 - x0, z1 - z0);
      const step = span > 80 ? 5 : 1;
      for (let x = x0; x <= x1; x += step) {
        const major = x % 5 === 0;
        push([x, 0, z0], [x, 0, z1], major ? [0.32, 0.35, 0.39] : [0.18, 0.2, 0.23]);
      }
      for (let z = z0; z <= z1; z += step) {
        const major = z % 5 === 0;
        push([x0, 0, z], [x1, 0, z], major ? [0.32, 0.35, 0.39] : [0.18, 0.2, 0.23]);
      }
    }

    push([0, 0, 0], [1.6, 0, 0], [0.78, 0.32, 0.26]);
    push([0, 0, 0], [0, 1.6, 0], [0.36, 0.66, 0.38]);
    push([0, 0, 0], [0, 0, 1.6], [0.32, 0.5, 0.82]);

    const selected = this.items.find((item) => item.obj.id === this.selectedId);
    if (selected) {
      const corners = [
        [-0.53, -0.53, -0.53], [0.53, -0.53, -0.53], [0.53, 0.53, -0.53], [-0.53, 0.53, -0.53],
        [-0.53, -0.53, 0.53], [0.53, -0.53, 0.53], [0.53, 0.53, 0.53], [-0.53, 0.53, 0.53],
      ].map((c) => {
        const out = [0, 0, 0];
        M.transformPoint(selected.model, c, out);
        return out;
      });
      const edges = [[0, 1], [1, 2], [2, 3], [3, 0], [4, 5], [5, 6], [6, 7], [7, 4], [0, 4], [1, 5], [2, 6], [3, 7]];
      const amber = [0.95, 0.76, 0.38];
      edges.forEach(function (e) { push(corners[e[0]], corners[e[1]], amber); });
    }

    this._lineVerts = new Float32Array(verts);
    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.lineBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, this._lineVerts, gl.DYNAMIC_DRAW);
  };

  Engine.prototype._pick = function (x, y, width, height) {
    if (!width || !height) return null;
    const eye = this._matrices(width, height);
    const inv = this._scratch.inv;
    if (!M.invert(this._scratch.viewProj, inv)) return null;
    const ndcX = (x / width) * 2 - 1;
    const ndcY = 1 - (y / height) * 2;
    const near = [0, 0, 0];
    const far = [0, 0, 0];
    M.transformPoint(inv, [ndcX, ndcY, -1], near);
    M.transformPoint(inv, [ndcX, ndcY, 1], far);
    const origin = near;
    const dir = [far[0] - near[0], far[1] - near[1], far[2] - near[2]];
    const dirLen = Math.hypot(dir[0], dir[1], dir[2]) || 1;
    const worldDir = [dir[0] / dirLen, dir[1] / dirLen, dir[2] / dirLen];

    let bestFixture = null;
    let bestFixtureDist = Infinity;
    let bestOther = null;
    let bestOtherDist = Infinity;
    this.items.forEach((item) => {
      if (!this._visible(item)) return;
      if (!M.invert(item.model, inv)) return;
      const localO = [0, 0, 0];
      const localD = [0, 0, 0];
      M.transformPoint(inv, origin, localO);
      M.transformVector(inv, dir, localD);
      const t = M.rayAabb(localO, localD);
      if (t == null) return;
      const hitL = [localO[0] + localD[0] * t, localO[1] + localD[1] * t, localO[2] + localD[2] * t];
      const hitW = [0, 0, 0];
      M.transformPoint(item.model, hitL, hitW);
      const delta = [hitW[0] - eye[0], hitW[1] - eye[1], hitW[2] - eye[2]];
      if (delta[0] * worldDir[0] + delta[1] * worldDir[1] + delta[2] * worldDir[2] <= 0) return;
      const dist = Math.hypot(delta[0], delta[1], delta[2]);
      if (item.obj.kind === "fixture") {
        if (dist < bestFixtureDist) {
          bestFixtureDist = dist;
          bestFixture = item.obj;
        }
      } else if (dist < bestOtherDist) {
        bestOtherDist = dist;
        bestOther = item.obj;
      }
    });
    // In plan the pipe is above the fixture, so a click on the symbol should win.
    if (this.ortho && bestFixture) return bestFixture;
    if (bestFixture && bestOther) return bestFixtureDist <= bestOtherDist ? bestFixture : bestOther;
    return bestFixture || bestOther;
  };

  Engine.prototype.ray = function (clientX, clientY) {
    const rect = this.canvas.getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top;
    if (!rect.width || !rect.height) return null;
    this._matrices(rect.width, rect.height);
    const inv = this._scratch.inv;
    if (!M.invert(this._scratch.viewProj, inv)) return null;
    const ndcX = (x / rect.width) * 2 - 1;
    const ndcY = 1 - (y / rect.height) * 2;
    const near = [0, 0, 0];
    const far = [0, 0, 0];
    M.transformPoint(inv, [ndcX, ndcY, -1], near);
    M.transformPoint(inv, [ndcX, ndcY, 1], far);
    const dir = [far[0] - near[0], far[1] - near[1], far[2] - near[2]];
    const len = Math.hypot(dir[0], dir[1], dir[2]) || 1;
    return {
      origin: near,
      dir: [dir[0] / len, dir[1] / len, dir[2] / len],
      x: x,
      y: y,
      width: rect.width,
      height: rect.height,
    };
  };

  Engine.prototype.hitPlane = function (ray, y) {
    if (!ray || Math.abs(ray.dir[1]) < 1e-6) return null;
    const t = (y - ray.origin[1]) / ray.dir[1];
    if (t < 0) return null;
    return [ray.origin[0] + ray.dir[0] * t, y, ray.origin[2] + ray.dir[2] * t];
  };

  Engine.prototype._bindInput = function () {
    const canvas = this.canvas;
    const self = this;
    canvas.addEventListener("contextmenu", function (e) { e.preventDefault(); });
    canvas.addEventListener("wheel", function (e) {
      e.preventDefault();
      const factor = Math.exp(e.deltaY * 0.0011);
      self.distance = Math.min(140, Math.max(3, self.distance * factor));
    }, { passive: false });

    function aimGhost(clientX, clientY) {
      if (self.tool !== "place" || !self.ghost) return;
      const hit = self.hitPlane(self.ray(clientX, clientY), self.placeHeight);
      if (!hit) return;
      self.ghost.obj.position[0] = hit[0];
      self.ghost.obj.position[1] = self.placeHeight;
      self.ghost.obj.position[2] = hit[2];
      self.syncGhost();
    }

    function moveSelected(e) {
      const item = self.items.find(function (entry) { return entry.obj.id === self._drag.id; });
      if (!item) return;
      if (e.shiftKey) {
        const dy = e.clientY - self._drag.y;
        item.obj.position[1] = Math.round(Math.max(0, self._drag.baseY - dy * self.distance * 0.0022) * 100) / 100;
        self._drag.planeY = item.obj.position[1];
      } else {
        const hit = self.hitPlane(self.ray(e.clientX, e.clientY), self._drag.planeY);
        if (!hit) return;
        item.obj.position[0] = Math.round(hit[0] * 100) / 100;
        item.obj.position[1] = Math.round(self._drag.planeY * 100) / 100;
        item.obj.position[2] = Math.round(hit[2] * 100) / 100;
        self._drag.baseY = self._drag.planeY;
        self._drag.y = e.clientY;
      }
      self.refresh(item.obj.id);
      if (self.onTransform) self.onTransform(item.obj);
    }

    canvas.addEventListener("pointerdown", function (e) {
      const drag = { x: e.clientX, y: e.clientY, button: e.button, moved: false, moving: false, id: null, planeY: 0, baseY: 0 };
      if (e.button === 0 && self.tool === "move") {
        const rect = canvas.getBoundingClientRect();
        const hit = self._pick(e.clientX - rect.left, e.clientY - rect.top, rect.width, rect.height);
        if (hit) {
          drag.moving = true;
          drag.id = hit.id;
          drag.planeY = hit.position[1];
          drag.baseY = hit.position[1];
          self.select(hit.id);
        }
      }
      self._drag = drag;
      try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* pointer already gone */ }
    });
    canvas.addEventListener("pointermove", function (e) {
      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      if (!self._drag) {
        aimGhost(e.clientX, e.clientY);
        const hit = self._pick(x, y, rect.width, rect.height);
        self.hoverId = hit ? hit.id : null;
        canvas.style.cursor = self.tool === "place"
          ? "crosshair"
          : self.hoverId ? (self.tool === "move" ? "move" : "pointer") : "grab";
        return;
      }
      if (self._drag.moving) {
        const dx = e.clientX - self._drag.x;
        const dy = e.clientY - self._drag.y;
        if (!self._drag.moved && Math.hypot(dx, dy) < 4) return;
        self._drag.moved = true;
        moveSelected(e);
        return;
      }
      const dx = e.clientX - self._drag.x;
      const dy = e.clientY - self._drag.y;
      if (!self._drag.moved && Math.hypot(dx, dy) < 4) return;
      self._drag.moved = true;
      self._drag.x = e.clientX;
      self._drag.y = e.clientY;
      aimGhost(e.clientX, e.clientY);
      if (self._drag.button === 0) {
        if (self.ortho) {
          self.ortho = false;
          self.elevation = 1.15;
          self.azimuth = 0;
          self.viewName = "orbit";
          if (self.onViewChange) self.onViewChange("orbit");
        }
        self.azimuth -= dx * 0.005;
        self.elevation = Math.min(1.35, Math.max(-0.35, self.elevation + dy * 0.005));
      } else if (self.ortho) {
        const scale = self.distance * 0.0016;
        self.target[0] -= dx * scale;
        self.target[2] += dy * scale;
      } else {
        const eye = self._eye();
        let fx = self.target[0] - eye[0];
        let fy = self.target[1] - eye[1];
        let fz = self.target[2] - eye[2];
        const fl = Math.hypot(fx, fy, fz) || 1;
        fx /= fl; fy /= fl; fz /= fl;
        // right = worldUp × forward, so dragging follows the cursor.
        let rx = fz;
        let ry = 0;
        let rz = -fx;
        const rl = Math.hypot(rx, ry, rz) || 1;
        rx /= rl; ry /= rl; rz /= rl;
        const ux = fy * rz - fz * ry;
        const uy = fz * rx - fx * rz;
        const uz = fx * ry - fy * rx;
        const scale = self.distance * 0.0015;
        self.target[0] += (-dx * rx + dy * ux) * scale;
        self.target[1] += (-dx * ry + dy * uy) * scale;
        self.target[2] += (-dx * rz + dy * uz) * scale;
      }
    });
    function endDrag(e) {
      if (!self._drag) return;
      const drag = self._drag;
      self._drag = null;
      if (drag.button !== 0 || drag.moved || drag.moving) return;
      if (self.tool === "place") {
        const hit = self.hitPlane(self.ray(e.clientX, e.clientY), self.placeHeight);
        if (hit && self.onPlace) self.onPlace(hit);
        return;
      }
      const rect = canvas.getBoundingClientRect();
      const hit = self._pick(e.clientX - rect.left, e.clientY - rect.top, rect.width, rect.height);
      self.select(hit ? hit.id : null);
    }
    canvas.addEventListener("pointerup", endDrag);
    canvas.addEventListener("pointercancel", function () { self._drag = null; });
  };

  return Engine;
})();
