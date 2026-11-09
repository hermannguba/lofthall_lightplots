// Fixture and equipment types the user can place. Stored in this browser.
var FixtureLibrary = (function () {
  const KEY = "lightplot.fixtureLibrary.v1";
  const SEED = [
    { id: "spot", name: "Голова spot", kind: "fixture", fixtureType: "Голова spot", mode: "16 ch", size: [0.36, 0.5, 0.36], layer: "Свет" },
    { id: "profile", name: "Профильный", kind: "fixture", fixtureType: "Профильный", mode: "1 ch", size: [0.28, 0.32, 0.7], layer: "Свет" },
    { id: "par", name: "PAR", kind: "fixture", fixtureType: "PAR", mode: "4 ch", size: [0.28, 0.32, 0.28], layer: "Свет" },
    { id: "wash", name: "Голова wash", kind: "fixture", fixtureType: "Голова wash", mode: "16 ch", size: [0.38, 0.48, 0.38], layer: "Свет" },
    { id: "bar", name: "LED-бар", kind: "fixture", fixtureType: "LED-бар", mode: "12 ch", size: [1.15, 0.16, 0.22], layer: "Свет" },
    { id: "truss", name: "Ферма 2 м", kind: "structure", fixtureType: "", mode: "", size: [2, 0.3, 0.3], layer: "Фермы" },
    { id: "screen", name: "Экран", kind: "equipment", fixtureType: "", mode: "", size: [4, 2.25, 0.12], layer: "Видео" },
    { id: "speaker", name: "Портал", kind: "equipment", fixtureType: "", mode: "", size: [0.55, 1.1, 0.5], layer: "Звук" },
  ];

  function num(value, fallback) {
    const n = Number(value);
    return Number.isFinite(n) && n > 0 ? n : fallback;
  }

  function normalize(raw) {
    const kind = raw && PlotFormat.KINDS[raw.kind] ? raw.kind : "fixture";
    const name = String(raw && raw.name || "Прибор").trim() || "Прибор";
    return {
      id: String(raw && raw.id || ("t-" + Math.random().toString(36).slice(2, 8))),
      name: name,
      kind: kind,
      fixtureType: kind === "fixture" ? String(raw.fixtureType || name) : "",
      mode: kind === "fixture" ? String(raw.mode || "") : "",
      size: [num(raw.size && raw.size[0], 0.4), num(raw.size && raw.size[1], 0.5), num(raw.size && raw.size[2], 0.4)],
      layer: String(raw.layer || ""),
      color: typeof raw.color === "string" ? raw.color : "",
      notes: String(raw.notes || ""),
      gdtfId: String(raw && raw.gdtfId || ""),
      modelId: String(raw && raw.modelId || ""),
      modes: Array.isArray(raw && raw.modes) ? raw.modes.map(String) : [],
    };
  }

  function read() {
    try {
      const raw = JSON.parse(localStorage.getItem(KEY) || "null");
      if (Array.isArray(raw) && raw.length) return raw.map(normalize);
    } catch (err) { /* a blocked store just uses the seed */ }
    return SEED.map(normalize);
  }

  let items = read();

  function persist() {
    try { localStorage.setItem(KEY, JSON.stringify(items)); } catch (err) { /* private mode */ }
  }

  return {
    items: function () { return items; },
    add: function (raw) {
      const type = normalize(raw);
      type.id = "t-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 6);
      if (raw && raw.storeMesh) type.gdtfId = type.id;
      items.push(type);
      persist();
      return type;
    },
    ensure: function (raw) {
      const type = normalize(raw);
      if (raw && raw.storeMesh) type.gdtfId = type.id;
      const found = items.find(function (item) { return item.id === type.id; });
      if (found) return found;
      items.push(type);
      persist();
      return type;
    },
    remove: function (id) {
      items = items.filter(function (type) { return type.id !== id; });
      persist();
    },
    forgetModel: function (modelId) {
      let changed = false;
      items.forEach(function (type) {
        if (type.modelId === modelId) {
          type.modelId = "";
          changed = true;
        }
      });
      if (changed) persist();
    },
  };
})();
