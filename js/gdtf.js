// GDTF profile: fixture identity, DMX modes, and a schematic mesh. No beams.
var GdtfProfile = (function () {
  const GEOM = {
    geometry: 1, axis: 1, beam: 1, filterbeam: 1, filtercolor: 1, filtergobo: 1,
    filtershaper: 1, display: 1, laser: 1, structure: 1, support: 1, magnet: 1,
  };

  function localName(el) {
    return (el.localName || el.tagName || "").toLowerCase();
  }

  function attr(el, name) {
    if (!el || !el.attributes) return "";
    const wanted = name.toLowerCase();
    for (let i = 0; i < el.attributes.length; i++) {
      if (el.attributes[i].name.toLowerCase() === wanted) return el.attributes[i].value.trim();
    }
    return "";
  }

  function elements(root, name) {
    const wanted = name.toLowerCase();
    const out = [];
    const all = root.getElementsByTagName("*");
    for (let i = 0; i < all.length; i++) {
      if (localName(all[i]) === wanted) out.push(all[i]);
    }
    return out;
  }

  function xml(bytes) {
    const text = new TextDecoder("utf-8").decode(bytes).replace(/^\uFEFF/, "");
    const doc = new DOMParser().parseFromString(text, "application/xml");
    if (!doc.documentElement || localName(doc.documentElement) === "parsererror") {
      throw new Error("description.xml в GDTF не читается.");
    }
    return doc;
  }

  function ident() {
    const m = new Float32Array(16);
    PlotMath.identity(m);
    return m;
  }

  function mul(a, b) {
    const out = new Float32Array(16);
    PlotMath.multiply(a, b, out);
    return out;
  }

  function gdtfMatrix(text) {
    const nums = String(text || "").match(/[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g);
    if (!nums || nums.length < 16) return ident();
    const out = new Float32Array(16);
    for (let row = 0; row < 4; row++) {
      for (let col = 0; col < 4; col++) out[col * 4 + row] = Number(nums[row * 4 + col]);
    }
    return out;
  }

  // GDTF Z-up to the plot's Y-up. X stays to the right.
  const TO_PLOT = new Float32Array([
    1, 0, 0, 0,
    0, 0, 1, 0,
    0, 1, 0, 0,
    0, 0, 0, 1,
  ]);

  function extents(pos) {
    const min = [Infinity, Infinity, Infinity];
    const max = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < pos.length; i += 3) {
      for (let k = 0; k < 3; k++) {
        min[k] = Math.min(min[k], pos[i + k]);
        max[k] = Math.max(max[k], pos[i + k]);
      }
    }
    return { min: min, max: max, d: [max[0] - min[0], max[1] - min[1], max[2] - min[2]] };
  }

  function close(value, target) {
    if (!(target > 0)) return true;
    return Math.abs(value - target) / target < 0.25;
  }

  function fit(pos, length, width, height) {
    const box = extents(pos);
    const out = new Float32Array(pos.length);
    const size = [length, width, height];
    for (let i = 0; i < pos.length; i += 3) {
      for (let k = 0; k < 3; k++) {
        const span = box.d[k] || 1;
        const center = (box.min[k] + box.max[k]) / 2;
        out[i + k] = size[k] > 0 ? (pos[i + k] - center) / span * size[k] : 0;
      }
    }
    return out;
  }

  function toGdtf(pos, model) {
    const box = extents(pos);
    const asYUp = close(box.d[0], model.length) && close(box.d[1], model.height) && close(box.d[2], model.width);
    const asZUp = close(box.d[0], model.length) && close(box.d[1], model.width) && close(box.d[2], model.height);
    const yUp = asYUp || !asZUp;
    const swapped = new Float32Array(pos.length);
    for (let i = 0; i < pos.length; i += 3) {
      const x = pos[i], y = pos[i + 1], z = pos[i + 2];
      swapped[i] = x;
      swapped[i + 1] = yUp ? z : y;
      swapped[i + 2] = yUp ? y : z;
    }
    const got = extents(swapped);
    const ready = close(got.d[0], model.length) && close(got.d[1], model.width) && close(got.d[2], model.height);
    return ready ? swapped : fit(swapped, model.length, model.width, model.height);
  }

  function primitive(model) {
    const x = model.length / 2 || 0.05;
    const y = model.width / 2 || 0.02;
    const z = model.height / 2 || 0.02;
    const kind = model.primitive;
    if (kind === "cylinder" || kind === "pigtail") {
      const radius = Math.max(0.005, Math.min(y, z));
      const pos = [];
      const sides = 8;
      for (let i = 0; i < sides; i++) {
        const a0 = i / sides * Math.PI * 2;
        const a1 = (i + 1) / sides * Math.PI * 2;
        const y0 = Math.cos(a0) * radius, z0 = Math.sin(a0) * radius;
        const y1 = Math.cos(a1) * radius, z1 = Math.sin(a1) * radius;
        pos.push(-x, y0, z0, x, y0, z0, x, y1, z1, -x, y0, z0, x, y1, z1, -x, y1, z1);
      }
      return new Float32Array(pos);
    }
    const p = [];
    function face(a, b, c, d) { p.push(...a, ...b, ...c, ...a, ...c, ...d); }
    face([-x, -y, z], [x, -y, z], [x, y, z], [-x, y, z]);
    face([x, -y, -z], [-x, -y, -z], [-x, y, -z], [x, y, -z]);
    face([-x, y, -z], [-x, y, z], [x, y, z], [x, y, -z]);
    face([-x, -y, z], [-x, -y, -z], [x, -y, -z], [x, -y, z]);
    face([x, -y, z], [x, -y, -z], [x, y, -z], [x, y, z]);
    face([-x, -y, -z], [-x, -y, z], [-x, y, z], [-x, y, -z]);
    return new Float32Array(p);
  }

  function findModelFile(files, file) {
    const wanted = file.toLowerCase();
    for (const [name, data] of files) {
      const base = name.split("/").pop().toLowerCase();
      if (base === wanted + ".glb" || base === wanted + ".gltf") return data;
    }
    return null;
  }

  function modelPositions(files, model) {
    if (model.file) {
      const bytes = findModelFile(files, model.file);
      if (bytes) {
        try { return toGdtf(GlbMesh.parse(bytes), model); } catch (err) { /* primitive below */ }
      }
    }
    return primitive(model);
  }

  function lensName(modelName, nodeName) {
    const text = (modelName + " " + nodeName).toLowerCase();
    return text.includes("lens") || text.includes("pixel");
  }

  function pushTransformed(bucket, pos, world) {
    const point = [0, 0, 0];
    const out = [0, 0, 0];
    const placed = mul(TO_PLOT, world);
    for (let i = 0; i < pos.length; i += 3) {
      point[0] = pos[i];
      point[1] = pos[i + 1];
      point[2] = pos[i + 2];
      PlotMath.transformPoint(placed, point, out);
      bucket.push(out[0], out[1], out[2]);
    }
  }

  function normalsOf(pos) {
    const out = new Float32Array(pos.length);
    for (let i = 0; i < pos.length; i += 9) {
      const ax = pos[i + 3] - pos[i], ay = pos[i + 4] - pos[i + 1], az = pos[i + 5] - pos[i + 2];
      const bx = pos[i + 6] - pos[i], by = pos[i + 7] - pos[i + 1], bz = pos[i + 8] - pos[i + 2];
      let nx = ay * bz - az * by;
      let ny = az * bx - ax * bz;
      let nz = ax * by - ay * bx;
      const len = Math.hypot(nx, ny, nz) || 1;
      nx /= len; ny /= len; nz /= len;
      for (let k = 0; k < 3; k++) {
        out[i + k * 3] = nx;
        out[i + k * 3 + 1] = ny;
        out[i + k * 3 + 2] = nz;
      }
    }
    return out;
  }

  function pack(body, lens) {
    const clouds = [body, lens].filter(function (list) { return list.length; });
    const box = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
    clouds.forEach(function (list) {
      for (let i = 0; i < list.length; i += 3) {
        for (let k = 0; k < 3; k++) {
          box.min[k] = Math.min(box.min[k], list[i + k]);
          box.max[k] = Math.max(box.max[k], list[i + k]);
        }
      }
    });
    const size = [0, 1, 2].map(function (k) { return Math.max(0.05, box.max[k] - box.min[k]); });
    const center = size.map(function (_, k) { return (box.min[k] + box.max[k]) / 2; });
    function norm(list) {
      const out = new Float32Array(list.length);
      for (let i = 0; i < list.length; i += 3) {
        for (let k = 0; k < 3; k++) out[i + k] = (list[i + k] - center[k]) / size[k];
      }
      return out;
    }
    const positions = norm(body);
    const lensPositions = lens.length ? norm(lens) : null;
    return {
      positions: positions,
      normals: normalsOf(positions),
      lensPositions: lensPositions,
      lensNormals: lensPositions ? normalsOf(lensPositions) : null,
      size: size.map(function (n) { return Math.round(n * 1000) / 1000; }),
    };
  }

  function modesOf(doc) {
    return elements(doc, "DMXMode").map(function (mode) {
      let max = 0;
      elements(mode, "DMXChannel").forEach(function (channel) {
        attr(channel, "Offset").split(",").forEach(function (part) {
          const n = Number(part.trim());
          if (n > max) max = n;
        });
      });
      return { name: attr(mode, "Name") || "Mode", channels: max, geometry: attr(mode, "Geometry") };
    }).filter(function (mode) { return mode.name; });
  }

  async function parse(buffer) {
    const files = await ZipReader.unzip(buffer, function (name) {
      return /\.(xml|glb|gltf)$/i.test(name);
    });
    let description = null;
    for (const [name, data] of files) {
      if (name.split("/").pop().toLowerCase() === "description.xml") description = data;
    }
    if (!description) throw new Error("В GDTF нет description.xml.");
    const doc = xml(description);
    const type = elements(doc, "FixtureType")[0];
    if (!type) throw new Error("В GDTF нет типа прибора.");
    const manufacturer = attr(type, "Manufacturer");
    const modelName = attr(type, "Name") || attr(type, "LongName") || "Прибор";
    const fixtureType = [manufacturer, modelName].filter(Boolean).join(" ");
    const modes = modesOf(doc);
    const models = new Map();
    elements(doc, "Model").forEach(function (node) {
      const name = attr(node, "Name");
      if (!name) return;
      models.set(name, {
        file: attr(node, "File"),
        length: Number(attr(node, "Length")) || 0,
        width: Number(attr(node, "Width")) || 0,
        height: Number(attr(node, "Height")) || 0,
        primitive: attr(node, "PrimitiveType").toLowerCase(),
      });
    });
    const prepared = new Map();
    function positionsFor(name) {
      if (prepared.has(name)) return prepared.get(name);
      const model = models.get(name);
      const pos = model ? modelPositions(files, model) : null;
      prepared.set(name, pos);
      return pos;
    }

    const byName = new Map();
    const geometries = elements(doc, "Geometries")[0];
    if (!geometries) throw new Error("В GDTF нет геометрии.");
    elements(geometries, "*").forEach(function (el) {
      const name = attr(el, "Name");
      if (name && GEOM[localName(el)] && !byName.has(name)) byName.set(name, el);
    });

    const body = [];
    const lens = [];
    function drawNode(el, parent, modelOverride, skipMatrix, depth) {
      if (!el || depth > 16) return;
      const here = skipMatrix ? parent : mul(parent, gdtfMatrix(attr(el, "Position")));
      const modelName = modelOverride || attr(el, "Model");
      if (modelName) {
        const pos = positionsFor(modelName);
        if (pos) pushTransformed(lensName(modelName, attr(el, "Name")) ? lens : body, pos, here);
      }
      for (const child of el.children) {
        const name = localName(child);
        if (name === "geometryreference") {
          const target = byName.get(attr(child, "Geometry"));
          if (!target || target === el) continue;
          drawNode(target, mul(here, gdtfMatrix(attr(child, "Position"))), attr(child, "Model"), true, depth + 1);
        } else if (GEOM[name]) {
          drawNode(child, here, "", false, depth + 1);
        }
      }
    }

    const rootName = (modes[0] && modes[0].geometry) || attr(geometries.children[0], "Name");
    const root = byName.get(rootName) || geometries.children[0];
    drawNode(root, ident(), "", false, 0);
    if (!body.length && !lens.length) throw new Error("В GDTF нет сетки прибора.");
    const mesh = body.length ? pack(body, lens) : pack(lens, []);
    const modeNames = modes.map(function (mode) { return mode.name; });
    return {
      name: modelName,
      manufacturer: manufacturer,
      fixtureType: fixtureType,
      mode: modeNames[0] || "",
      modes: modeNames,
      notes: modeNames.length ? "GDTF · моды: " + modeNames.join(", ") : "GDTF",
      size: mesh.size,
      positions: mesh.positions,
      normals: mesh.normals,
      lensPositions: mesh.lensPositions,
      lensNormals: mesh.lensNormals,
    };
  }

  return { parse: parse };
})();

var GdtfStore = {
  put: function (id, profile) { return PlotDb.putProfile(id, profile); },
  remove: function (id) { return PlotDb.removeProfile(id); },
  all: function () { return PlotDb.allProfiles(); },
};
