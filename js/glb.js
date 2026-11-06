// Reads a binary glTF mesh. No materials and no Draco.
var GlbMesh = (function () {
  const TYPE = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };

  function parse(bytes) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (bytes.length < 20 || view.getUint32(0, true) !== 0x46546c67) {
      throw new Error("Модель в GDTF не в формате glb.");
    }
    let offset = 12;
    let json = null;
    let bin = null;
    while (offset + 8 <= bytes.length) {
      const chunkLength = view.getUint32(offset, true);
      const chunkType = view.getUint32(offset + 4, true);
      const start = offset + 8;
      const chunk = bytes.subarray(start, start + chunkLength);
      if (chunkType === 0x4e4f534a) json = JSON.parse(new TextDecoder("utf-8").decode(chunk));
      else if (chunkType === 0x004e4942) bin = chunk;
      offset = start + chunkLength;
    }
    if (!json || !bin) throw new Error("В glb нет сетки.");
    const binView = new DataView(bin.buffer, bin.byteOffset, bin.byteLength);
    if (JSON.stringify(json).indexOf("KHR_draco_mesh_compression") !== -1) {
      throw new Error("Сетка сжата Draco.");
    }
    const positions = [];
    const nodes = json.nodes || [];
    const meshes = json.meshes || [];
    const scene = (json.scenes && json.scenes[json.scene || 0]) || { nodes: meshes.map(function (_, i) { return i; }) };

    function componentSize(type) {
      if (type === 5126 || type === 5125) return 4;
      if (type === 5123 || type === 5122) return 2;
      return 1;
    }

    function readAccessor(index) {
      const accessor = json.accessors[index];
      const viewIndex = accessor.bufferView;
      if (viewIndex == null) return null;
      const bufferView = json.bufferViews[viewIndex];
      const size = TYPE[accessor.type] || 1;
      const stride = bufferView.byteStride || size * componentSize(accessor.componentType);
      const start = (bufferView.byteOffset || 0) + (accessor.byteOffset || 0);
      const out = new Float32Array(accessor.count * size);
      for (let i = 0; i < accessor.count; i++) {
        const at = start + i * stride;
        for (let c = 0; c < size; c++) {
          const byte = at + c * componentSize(accessor.componentType);
          let value = 0;
          if (accessor.componentType === 5126) value = binView.getFloat32(byte, true);
          else if (accessor.componentType === 5125) value = binView.getUint32(byte, true);
          else if (accessor.componentType === 5123) value = binView.getUint16(byte, true);
          else if (accessor.componentType === 5121) value = bin[byte];
          else if (accessor.componentType === 5122) value = binView.getInt16(byte, true);
          else value = binView.getInt8(byte);
          out[i * size + c] = value;
        }
      }
      return out;
    }

    function nodeMatrix(node) {
      const out = new Float32Array(16);
      if (node.matrix && node.matrix.length >= 16) {
        out.set(node.matrix);
        return out;
      }
      PlotMath.identity(out);
      const t = node.translation || [0, 0, 0];
      const r = node.rotation || [0, 0, 0, 1];
      const s = node.scale || [1, 1, 1];
      const x = r[0], y = r[1], z = r[2], w = r[3];
      const x2 = x + x, y2 = y + y, z2 = z + z;
      const xx = x * x2, xy = x * y2, xz = x * z2;
      const yy = y * y2, yz = y * z2, zz = z * z2;
      const wx = w * x2, wy = w * y2, wz = w * z2;
      out[0] = (1 - (yy + zz)) * s[0];
      out[1] = (xy + wz) * s[0];
      out[2] = (xz - wy) * s[0];
      out[4] = (xy - wz) * s[1];
      out[5] = (1 - (xx + zz)) * s[1];
      out[6] = (yz + wx) * s[1];
      out[8] = (xz + wy) * s[2];
      out[9] = (yz - wx) * s[2];
      out[10] = (1 - (xx + yy)) * s[2];
      out[12] = t[0];
      out[13] = t[1];
      out[14] = t[2];
      out[15] = 1;
      return out;
    }

    function append(meshIndex, world) {
      const mesh = meshes[meshIndex];
      if (!mesh) return;
      (mesh.primitives || []).forEach(function (prim) {
        if (prim.mode != null && prim.mode !== 4) return;
        if (!prim.attributes || prim.attributes.POSITION == null) return;
        const pos = readAccessor(prim.attributes.POSITION);
        if (!pos) return;
        const index = prim.indices != null ? readAccessor(prim.indices) : null;
        const count = index ? index.length : pos.length / 3;
        const point = [0, 0, 0];
        const out = [0, 0, 0];
        for (let i = 0; i < count; i++) {
          const v = index ? index[i] : i;
          point[0] = pos[v * 3];
          point[1] = pos[v * 3 + 1];
          point[2] = pos[v * 3 + 2];
          PlotMath.transformPoint(world, point, out);
          positions.push(out[0], out[1], out[2]);
        }
      });
    }

    function walk(index, parent) {
      const node = nodes[index];
      if (!node) return;
      const world = new Float32Array(16);
      PlotMath.multiply(parent, nodeMatrix(node), world);
      if (node.mesh != null) append(node.mesh, world);
      (node.children || []).forEach(function (child) { walk(child, world); });
    }

    const root = new Float32Array(16);
    PlotMath.identity(root);
    (scene.nodes || []).forEach(function (index) { walk(index, root); });
    if (!positions.length && meshes[0]) append(0, root);
    if (positions.length < 9) throw new Error("В модели нет треугольников.");
    return new Float32Array(positions);
  }

  return { parse: parse };
})();
