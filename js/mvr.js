// MVR import: positions, layers and patch. No meshes and no beams.
// MVR is millimetres, right-handed, Z up. The plot is metres, Y up, Z upstage.
var MvrImport = (function () {
  const DRAW = {
    fixture: "fixture",
    truss: "structure",
    sceneobject: "structure",
    support: "structure",
    videoscreen: "equipment",
    projector: "equipment",
  };

  const DEFAULT_SIZE = {
    fixture: [0.32, 0.5, 0.32],
    structure: [2, 0.35, 0.35],
    equipment: [1, 1, 0.2],
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

  function direct(el, name) {
    const wanted = name.toLowerCase();
    for (const child of el.children) {
      if (localName(child) === wanted) return child;
    }
    return null;
  }

  function directText(el, name) {
    const node = direct(el, name);
    return node ? node.textContent.trim() : "";
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
    const root = doc.documentElement;
    if (!root || localName(root) === "parsererror") {
      throw new Error("XML в архиве не читается.");
    }
    return doc;
  }

  function identity() {
    return [
      1, 0, 0, 0,
      0, 1, 0, 0,
      0, 0, 1, 0,
      0, 0, 0, 1,
    ];
  }

  function fromAxes(u, v, w, o) {
    return [
      u[0], v[0], w[0], o[0],
      u[1], v[1], w[1], o[1],
      u[2], v[2], w[2], o[2],
      0, 0, 0, 1,
    ];
  }

  function parseMatrix(text) {
    if (!text) return identity();
    const nums = text.match(/[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g);
    if (!nums || nums.length < 12) return identity();
    const f = nums.map(Number);
    if (f.length >= 16 && Math.abs(f[3]) < 1e-3 && Math.abs(f[7]) < 1e-3 && Math.abs(f[11]) < 1e-3 && Math.abs(f[15] - 1) < 1e-3) {
      return fromAxes(
        [f[0], f[4], f[8]],
        [f[1], f[5], f[9]],
        [f[2], f[6], f[10]],
        [f[12], f[13], f[14]]
      );
    }
    return fromAxes(f.slice(0, 3), f.slice(3, 6), f.slice(6, 9), f.slice(9, 12));
  }

  function multiply(a, b) {
    const out = new Array(16);
    for (let row = 0; row < 4; row++) {
      for (let col = 0; col < 4; col++) {
        let sum = 0;
        for (let k = 0; k < 4; k++) sum += a[row * 4 + k] * b[k * 4 + col];
        out[row * 4 + col] = sum;
      }
    }
    return out;
  }

  function matrixOf(el) {
    return parseMatrix(directText(el, "Matrix") || attr(el, "Matrix"));
  }

  // MVR millimetres, Z up, +Y upstage -> plot metres, Y up, +Z upstage.
  function toPlotPoint(x, y, z) {
    return [x / 1000, z / 1000, y / 1000];
  }

  function toPlotDir(x, y, z) {
    return [x, z, y];
  }

  function length(v) {
    return Math.hypot(v[0], v[1], v[2]) || 1;
  }

  function scale(v, s) {
    return [v[0] * s, v[1] * s, v[2] * s];
  }

  function cross(a, b) {
    return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  }

  function dot(a, b) {
    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  }

  function euler(world) {
    const u = [world[0], world[4], world[8]];
    const v = [world[1], world[5], world[9]];
    const w = [world[2], world[6], world[10]];
    let colX = scale(toPlotDir(u[0], u[1], u[2]), 1 / length(u));
    let colY = scale(toPlotDir(w[0], w[1], w[2]), 1 / length(w));
    const colZ = scale(toPlotDir(v[0], v[1], v[2]), 1 / length(v));
    if (dot(cross(colX, colY), colZ) < 0) colX = scale(colX, -1);
    const m20 = colX[2];
    const m21 = colY[2];
    const m22 = colZ[2];
    const m00 = colX[0];
    const m10 = colX[1];
    const ry = Math.atan2(-m20, Math.hypot(m21, m22));
    const rx = Math.atan2(m21, m22);
    const rz = Math.atan2(m10, m00);
    const deg = 180 / Math.PI;
    return [rx, ry, rz].map(function (n) {
      const d = Math.round(n * deg * 100) / 100;
      return Object.is(d, -0) ? 0 : d;
    });
  }

  function positionOf(world) {
    return toPlotPoint(world[3], world[7], world[11]);
  }

  function parseAddress(text) {
    const value = text.trim();
    if (!value) return { universe: null, address: null };
    const dotted = /^(\d+)\s*[./:]\s*(\d+)$/.exec(value.replace(",", "."));
    if (dotted) {
      return { universe: Number(dotted[1]), address: Number(dotted[2]) };
    }
    const absolute = Number(value);
    if (!Number.isInteger(absolute) || absolute <= 0) return { universe: null, address: null };
    return {
      universe: Math.floor((absolute - 1) / 512) + 1,
      address: ((absolute - 1) % 512) + 1,
    };
  }

  function addressOf(el) {
    const box = direct(el, "Addresses");
    if (box) {
      let chosen = null;
      for (const child of box.children) {
        if (localName(child) !== "address") continue;
        const brk = attr(child, "break");
        if (brk === "" || brk === "0") {
          chosen = child;
          break;
        }
        if (!chosen) chosen = child;
      }
      if (chosen) return parseAddress(chosen.textContent);
    }
    const single = directText(el, "Address") || attr(el, "Address");
    if (single) return parseAddress(single);
    const universe = Number(directText(el, "Universe"));
    const local = Number(directText(el, "DMXAddress") || directText(el, "Patch"));
    if (Number.isInteger(universe) && universe > 0 && Number.isInteger(local) && local > 0) {
      return { universe: universe, address: local };
    }
    return { universe: null, address: null };
  }

  function gdtfInfo(bytes, modeName) {
    if (!bytes) return null;
    return ZipReader.unzip(bytes, function (name) {
      return /description\.xml$/i.test(name);
    }).then(function (files) {
      const description = ZipReader.find(files, "description.xml");
      if (!description) return null;
      const doc = xml(description);
      let lx = 0;
      let ly = 0;
      let lz = 0;
      elements(doc, "Model").forEach(function (model) {
        const lengthM = Number(attr(model, "Length"));
        const width = Number(attr(model, "Width"));
        const height = Number(attr(model, "Height"));
        if (lengthM > lx) lx = lengthM;
        if (width > ly) ly = width;
        if (height > lz) lz = height;
      });
      const size = lx > 0 && ly > 0 && lz > 0 ? [lx, lz, ly] : null;
      let channels = null;
      const modes = elements(doc, "DMXMode");
      const mode = modes.find(function (item) { return attr(item, "Name") === modeName; }) || modes[0];
      if (mode) {
        let max = 0;
        elements(mode, "DMXChannel").forEach(function (channel) {
          attr(channel, "Offset").split(",").forEach(function (part) {
            const n = Number(part.trim());
            if (n > max) max = n;
          });
        });
        if (max > 0) channels = max;
      }
      const typeNode = elements(doc, "FixtureType")[0];
      const typeName = typeNode ? [attr(typeNode, "Manufacturer"), attr(typeNode, "Name")].filter(Boolean).join(" ") : "";
      return { size: size, channels: channels, typeName: typeName };
    }).catch(function () {
      return null;
    });
  }

  function fixtureTypeName(spec, info) {
    if (info && info.typeName) return info.typeName;
    if (!spec) return "";
    const base = spec.split("/").pop().replace(/\.gdtf$/i, "");
    const at = base.indexOf("@");
    if (at >= 0) return (base.slice(0, at) + " " + base.slice(at + 1)).trim();
    return base;
  }

  function clampSize(size) {
    return size.map(function (n) { return Math.min(8, Math.max(0.05, n)); });
  }

  function round3(n) {
    return Math.round(n * 1000) / 1000;
  }

  let prolyteCatalog = null;

  function loadProlyte() {
    if (prolyteCatalog) return prolyteCatalog;
    prolyteCatalog = fetch("samples/models/prolyte/catalog.json").then(function (res) {
      if (!res.ok) return [];
      return res.json();
    }).then(function (rows) {
      return Array.isArray(rows) ? rows : [];
    }).catch(function () {
      return [];
    });
    return prolyteCatalog;
  }

  function prolyteCode(name) {
    return String(name || "")
      .replace(/^Prolyte\s+/i, "")
      .split("·")[0]
      .replace(/\s+/g, "")
      .toUpperCase();
  }

  function fallbackProlyte(text) {
    const src = String(text || "").toUpperCase();
    const straight = /H(30|40)V[\s_-]*L\s*(\d{3})/.exec(src);
    if (!straight) return null;
    const code = "H" + straight[1] + "V-L" + straight[2];
    const section = straight[1] === "30" ? 0.287 : 0.387;
    return {
      id: "prolyte-" + code.toLowerCase(),
      name: "Prolyte " + code,
      size: [Number(straight[2]) / 100, section, section],
    };
  }

  function matchProlyte(text, table) {
    const hay = String(text || "").toUpperCase().replace(/\s+/g, "");
    if (!hay) return null;
    let best = null;
    (table || []).forEach(function (item) {
      const code = prolyteCode(item.name);
      if (code.length < 6 || hay.indexOf(code) === -1) return;
      if (!best || code.length > best.code.length) best = { code: code, item: item };
    });
    if (best) {
      return {
        id: best.item.id,
        name: best.item.name.split("·")[0].trim(),
        size: best.item.size.slice(0, 3).map(Number),
      };
    }
    return fallbackProlyte(text);
  }

  function symbolLabel(el, symdefs) {
    const geos = direct(el, "Geometries");
    if (!geos) return "";
    const names = [];
    for (const child of geos.children) {
      if (localName(child) !== "symbol") continue;
      const id = attr(child, "symdef").toLowerCase();
      if (id && symdefs.has(id)) names.push(symdefs.get(id));
    }
    return names.filter(Boolean).join(" ");
  }

  // world is the MVR matrix: columns are the local axes, translation in millimetres.
  function mvrLocal(world, x, y, z) {
    const dx = x - world[3];
    const dy = y - world[7];
    const dz = z - world[11];
    function axis(i) {
      const ax = world[i];
      const ay = world[4 + i];
      const az = world[8 + i];
      const len = Math.hypot(ax, ay, az) || 1;
      return (dx * ax + dy * ay + dz * az) / len;
    }
    return [axis(0), axis(1), axis(2)];
  }

  async function parse(buffer, fileName) {
    const files = await ZipReader.unzip(buffer, function (name) {
      return /\.(xml|gdtf)$/i.test(name);
    });
    let sceneBytes = null;
    for (const [name, data] of files) {
      if (name.split("/").pop().toLowerCase() === "generalscenedescription.xml") {
        sceneBytes = data;
        break;
      }
    }
    if (!sceneBytes) throw new Error("В архиве нет GeneralSceneDescription.xml.");
    const doc = xml(sceneBytes);
    const root = doc.documentElement;
    const scene = elements(doc, "Scene")[0];
    if (!scene) throw new Error("В MVR нет сцены.");

    const positions = new Map();
    elements(doc, "Position").forEach(function (node) {
      const id = attr(node, "uuid");
      if (id) positions.set(id.toLowerCase(), attr(node, "name"));
    });

    const gdtfCache = new Map();
    async function infoFor(spec, mode) {
      const key = (spec || "") + "\n" + (mode || "");
      if (gdtfCache.has(key)) return gdtfCache.get(key);
      const pending = gdtfInfo(ZipReader.find(files, spec), mode);
      gdtfCache.set(key, pending);
      return pending;
    }

    const symdefs = new Map();
    elements(doc, "Symdef").forEach(function (node) {
      const id = attr(node, "uuid").toLowerCase();
      if (id) symdefs.set(id, attr(node, "name"));
    });
    const prolyte = await loadProlyte();

    const objects = [];
    const seen = new Set();
    const trussSpans = [];

    async function addObject(el, world, layer, kind) {
      const rawId = attr(el, "uuid") || (kind + "-" + (objects.length + 1));
      let id = rawId;
      let n = 2;
      while (seen.has(id)) id = rawId + "-" + n++;
      seen.add(id);
      const mode = directText(el, "GDTFMode") || attr(el, "GDTFMode");
      const spec = directText(el, "GDTFSpec") || attr(el, "GDTFSpec");
      const info = kind === "fixture" ? await infoFor(spec, mode) : null;
      const patch = addressOf(el);
      const positionRef = directText(el, "Position");
      const hang = positions.get(positionRef.toLowerCase()) || (/^[0-9a-f-]{36}$/i.test(positionRef) ? "" : positionRef);
      const notes = [];
      const fixtureId = directText(el, "FixtureID");
      const unit = directText(el, "UnitNumber");
      const purpose = directText(el, "Function");
      if (fixtureId) notes.push("FID " + fixtureId);
      if (unit && unit !== "0") notes.push("Unit " + unit);
      if (purpose) notes.push(purpose);
      if (info && info.channels) notes.push(info.channels + " ch");
      const point = positionOf(world);
      const rotation = euler(world);
      let size = info && info.size ? clampSize(info.size) : (DEFAULT_SIZE[kind] || DEFAULT_SIZE.structure);
      let objectName = attr(el, "name") || fixtureTypeName(spec, info) || id;
      let modelId = "";
      if (kind === "structure") {
        const label = [attr(el, "name"), symbolLabel(el, symdefs)].filter(Boolean).join(" ");
        const piece = matchProlyte(label, prolyte);
        if (piece) {
          modelId = piece.id;
          objectName = piece.name;
          size = piece.size;
          if (label && notes.indexOf(label) === -1) notes.push(label);
          trussSpans.push({ name: piece.name, world: world, size: piece.size });
        }
      }
      objects.push({
        id: id,
        name: objectName,
        kind: kind,
        layer: kind === "structure" && modelId ? "Фермы" : (layer || "Сцена"),
        position: point.map(round3),
        size: size.map(round3),
        rotation: rotation,
        fixtureType: kind === "fixture" ? fixtureTypeName(spec, info) : "",
        mode: kind === "fixture" ? mode : "",
        universe: patch.universe,
        address: patch.address,
        hang: hang,
        notes: notes.join(" · "),
        modelId: modelId,
        mvr: [world[3], world[7], world[11]],
      });
    }

    async function walk(el, parent, layer) {
      const name = localName(el);
      const world = multiply(parent, matrixOf(el));
      const nextLayer = name === "layer" ? (attr(el, "name") || layer) : layer;
      if (DRAW[name]) await addObject(el, world, nextLayer, DRAW[name]);
      const list = direct(el, "ChildList") || direct(el, "Layers");
      if (!list) return;
      for (const child of list.children) await walk(child, world, nextLayer);
    }

    await walk(scene, identity(), "Сцена");
    if (!objects.length) throw new Error("В MVR не нашлось приборов. Нужен файл сцены из Capture, Vectorworks или grandMA.");

    objects.forEach(function (obj) {
      if (obj.kind !== "fixture" || obj.hang || !obj.mvr) return;
      let best = null;
      trussSpans.forEach(function (span) {
        const local = mvrLocal(span.world, obj.mvr[0], obj.mvr[1], obj.mvr[2]);
        const half = span.size.map(function (n) { return n * 500; });
        const onLength = Math.abs(local[0]) <= half[0] + 200;
        const onSection = Math.hypot(local[1], local[2] + half[2]) <= Math.max(half[1], half[2]) + 450;
        const below = local[2] <= half[2] + 50;
        if (!onLength || !onSection || !below) return;
        const rank = Math.abs(local[0]) + Math.abs(local[2]);
        if (!best || rank < best.rank) best = { rank: rank, name: span.name };
      });
      if (best) obj.hang = best.name;
      delete obj.mvr;
    });
    objects.forEach(function (obj) { delete obj.mvr; });

    const fixtures = objects.filter(function (obj) { return obj.kind === "fixture"; }).length;
    const trusses = trussSpans.length;
    const title = (fileName || "MVR").replace(/\.[^.]+$/, "") || "MVR";
    const provider = [attr(root, "provider"), attr(root, "providerVersion")].filter(Boolean).join(" ");
    return {
      venue: {
        name: title,
        note: "Импорт MVR" + (provider ? " · " + provider : "")
          + " · приборов " + fixtures
          + (trusses ? " · ферм Prolyte " + trusses : "")
          + ". Миллиметры и Z вверх переведены в метры.",
      },
      objects: objects,
    };
  }

  return { parse: parse };
})();
