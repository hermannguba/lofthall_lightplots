// Plot file: meters, origin at the centre of the downstage edge.
// +X stage right, +Y up, +Z upstage.
var PlotFormat = (function () {
  const KINDS = { fixture: "Прибор", structure: "Конструкция", equipment: "Оборудование" };

  function vec3(value, label) {
    if (!Array.isArray(value) || value.length !== 3 || value.some((n) => typeof n !== "number" || !Number.isFinite(n))) {
      throw new Error(label + " — нужны три числа.");
    }
    return [value[0], value[1], value[2]];
  }

  function text(value) {
    if (value == null || value === "") return "";
    return String(value);
  }

  function parsePlot(data) {
    if (!data || typeof data !== "object" || Array.isArray(data)) {
      throw new Error("Файл схемы должен быть JSON-объектом.");
    }
    const venue = data.venue;
    if (!venue || typeof venue.name !== "string" || !venue.name.trim()) {
      throw new Error("В схеме нужно venue.name — название площадки.");
    }
    if (!Array.isArray(data.objects)) {
      throw new Error("В схеме нужно поле objects — список объектов.");
    }

    const seen = new Set();
    const objects = data.objects.map((raw, index) => {
      if (!raw || typeof raw !== "object") {
        throw new Error("Объект " + (index + 1) + " записан не объектом.");
      }
      const where = raw.name || raw.id || ("№ " + (index + 1));
      const id = text(raw.id).trim();
      if (!id) throw new Error(where + ": нужен id.");
      if (seen.has(id)) throw new Error("Повторяется id «" + id + "».");
      seen.add(id);
      const kind = raw.kind || "fixture";
      if (!KINDS[kind]) throw new Error(where + ": kind должен быть fixture, structure или equipment.");
      const size = vec3(raw.size, where + ": size");
      if (size.some((n) => n <= 0)) throw new Error(where + ": size должен быть больше нуля.");
      const rotation = raw.rotation == null ? [0, 0, 0] : vec3(raw.rotation, where + ": rotation");
      return {
        id,
        name: text(raw.name).trim() || id,
        kind,
        layer: text(raw.layer).trim() || "Общее",
        position: vec3(raw.position, where + ": position"),
        size,
        rotation,
        color: typeof raw.color === "string" ? raw.color : "",
        fixtureType: text(raw.fixtureType),
        mode: text(raw.mode),
        universe: numberOrEmpty(raw.universe, where + ": universe"),
        address: numberOrEmpty(raw.address, where + ": address"),
        circuit: text(raw.circuit),
        hang: text(raw.hang),
        notes: text(raw.notes),
        gdtfId: text(raw.gdtfId),
        modelId: text(raw.modelId),
      };
    });

    return {
      venue: {
        name: venue.name.trim(),
        note: text(venue.note),
      },
      objects,
    };
  }

  function numberOrEmpty(value, label) {
    if (value == null || value === "") return null;
    const n = typeof value === "number" ? value : Number(value);
    if (!Number.isInteger(n)) throw new Error(label + " — нужно целое число.");
    return n;
  }

  function hexColor(hex) {
    const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
    if (!m) return null;
    const n = parseInt(m[1], 16);
    return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255];
  }

  function colorFor(obj) {
    const custom = obj.color ? hexColor(obj.color) : null;
    if (custom) return custom;
    if (obj.kind === "structure") return /планшет|stage/i.test(obj.name) ? [0.23, 0.25, 0.28] : [0.58, 0.62, 0.66];
    if (obj.kind === "equipment") return [0.36, 0.4, 0.38];
    const type = (obj.fixtureType || "").toLowerCase();
    if (type.includes("spot") || type.includes("голов")) return [0.32, 0.56, 0.92];
    if (type.includes("wash")) return [0.45, 0.7, 0.95];
    if (type.includes("проф") || type.includes("profile")) return [0.84, 0.46, 0.28];
    if (type.includes("par") || type.includes("пар")) return [0.86, 0.68, 0.26];
    if (type.includes("led") || type.includes("бар")) return [0.24, 0.68, 0.5];
    return [0.7, 0.72, 0.74];
  }

  return { KINDS, parsePlot, colorFor };
})();
