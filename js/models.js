// User GLB models for the plot. glTF is Y-up, same as the plot, so axes stay.
// The mesh is centred in a unit box; the plot scales it by the object's size.
var ModelMesh = (function () {
  const CATEGORIES = {
    fixture: { label: "Световой прибор", short: "Прибор", kind: "fixture", layer: "Свет" },
    stage: { label: "Сценический элемент", short: "Сцена", kind: "equipment", layer: "Сцена" },
    structure: { label: "Конструктивный элемент", short: "Конструкция", kind: "structure", layer: "Фермы" },
  };

  function normalsOf(pos) {
    const out = new Float32Array(pos.length);
    for (let i = 0; i < pos.length; i += 9) {
      const ax = pos[i + 3] - pos[i];
      const ay = pos[i + 4] - pos[i + 1];
      const az = pos[i + 5] - pos[i + 2];
      const bx = pos[i + 6] - pos[i];
      const by = pos[i + 7] - pos[i + 1];
      const bz = pos[i + 8] - pos[i + 2];
      let nx = ay * bz - az * by;
      let ny = az * bx - ax * bz;
      let nz = ax * by - ay * bx;
      const len = Math.hypot(nx, ny, nz) || 1;
      nx /= len;
      ny /= len;
      nz /= len;
      for (let k = 0; k < 3; k++) {
        out[i + k * 3] = nx;
        out[i + k * 3 + 1] = ny;
        out[i + k * 3 + 2] = nz;
      }
    }
    return out;
  }

  function prepare(raw) {
    const src = raw instanceof Float32Array ? raw : Float32Array.from(raw);
    if (src.length < 9 || src.length % 3 !== 0) throw new Error("В модели нет треугольников.");
    if (src.length / 3 > 300000) throw new Error("В модели больше 100 тысяч треугольников.");
    let maxAbs = 0;
    for (let i = 0; i < src.length; i++) {
      const value = Math.abs(src[i]);
      if (value > maxAbs) maxAbs = value;
    }
    // A lighting model is not 80 m across. Larger numbers are millimetres.
    const scale = maxAbs > 80 ? 0.001 : 1;
    const min = [Infinity, Infinity, Infinity];
    const max = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < src.length; i += 3) {
      for (let k = 0; k < 3; k++) {
        const value = src[i + k] * scale;
        if (value < min[k]) min[k] = value;
        if (value > max[k]) max[k] = value;
      }
    }
    const size = [0, 1, 2].map(function (k) {
      return Math.max(0.05, Math.round((max[k] - min[k]) * 1000) / 1000);
    });
    const center = [0, 1, 2].map(function (k) { return (min[k] + max[k]) / 2; });
    const positions = new Float32Array(src.length);
    for (let i = 0; i < src.length; i += 3) {
      for (let k = 0; k < 3; k++) {
        positions[i + k] = (src[i + k] * scale - center[k]) / size[k];
      }
    }
    return {
      positions: positions,
      normals: normalsOf(positions),
      size: size,
      millimeters: scale !== 1,
    };
  }

  function fromGlb(buffer) {
    const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
    return prepare(GlbMesh.parse(bytes));
  }

  return { CATEGORIES: CATEGORIES, prepare: prepare, fromGlb: fromGlb };
})();
