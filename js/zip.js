// Minimal ZIP reader for MVR and GDTF. Store and deflate only.
var ZipReader = (function () {
  function findEocd(bytes) {
    const min = Math.max(0, bytes.length - 22 - 65535);
    for (let i = bytes.length - 22; i >= min; i--) {
      if (bytes[i] === 0x50 && bytes[i + 1] === 0x4b && bytes[i + 2] === 0x05 && bytes[i + 3] === 0x06) {
        return i;
      }
    }
    return -1;
  }

  async function inflateRaw(data) {
    if (typeof DecompressionStream !== "function") {
      throw new Error("Этот браузер не распаковывает ZIP. Откройте схему в текущем Edge или Chrome.");
    }
    const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }

  async function readEntry(view, bytes, localOffset, method, compSize) {
    if (localOffset + 30 > bytes.length || view.getUint32(localOffset, true) !== 0x04034b50) {
      throw new Error("Архив повреждён: не найден заголовок файла.");
    }
    const flags = view.getUint16(localOffset + 6, true);
    if (flags & 0x1) throw new Error("Зашифрованный архив не читается.");
    const nameLen = view.getUint16(localOffset + 26, true);
    const extraLen = view.getUint16(localOffset + 28, true);
    const start = localOffset + 30 + nameLen + extraLen;
    const end = start + compSize;
    if (end > bytes.length) throw new Error("Архив повреждён: файл обрезан.");
    const compressed = bytes.subarray(start, end);
    if (method === 0) return compressed;
    if (method === 8) return inflateRaw(compressed);
    throw new Error("Сжатие ZIP № " + method + " не поддерживается.");
  }

  async function unzip(buffer) {
    const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const eocd = findEocd(bytes);
    if (eocd < 0) throw new Error("Файл не похож на архив MVR.");
    const count = view.getUint16(eocd + 10, true);
    const cdOffset = view.getUint32(eocd + 16, true);
    if (count === 0xffff || cdOffset === 0xffffffff) {
      throw new Error("Архив ZIP64 пока не читается.");
    }
    const files = new Map();
    let cursor = cdOffset;
    for (let i = 0; i < count; i++) {
      if (cursor + 46 > bytes.length || view.getUint32(cursor, true) !== 0x02014b50) {
        throw new Error("Каталог архива повреждён.");
      }
      const method = view.getUint16(cursor + 10, true);
      const compSize = view.getUint32(cursor + 20, true);
      const nameLen = view.getUint16(cursor + 28, true);
      const extraLen = view.getUint16(cursor + 30, true);
      const commentLen = view.getUint16(cursor + 32, true);
      const localOffset = view.getUint32(cursor + 42, true);
      const name = new TextDecoder("utf-8").decode(bytes.subarray(cursor + 46, cursor + 46 + nameLen)).replace(/\\/g, "/");
      cursor += 46 + nameLen + extraLen + commentLen;
      if (!name || name.endsWith("/")) continue;
      if (compSize === 0xffffffff || localOffset === 0xffffffff) {
        throw new Error("Архив ZIP64 пока не читается.");
      }
      files.set(name, await readEntry(view, bytes, localOffset, method, compSize));
    }
    return files;
  }

  function find(files, fileName) {
    if (!fileName) return null;
    const wanted = fileName.replace(/\\/g, "/").split("/").pop().toLowerCase();
    const withExt = wanted.includes(".") ? wanted : wanted + ".gdtf";
    for (const [name, data] of files) {
      const base = name.split("/").pop().toLowerCase();
      if (base === wanted || base === withExt) return data;
    }
    return null;
  }

  return { unzip, find };
})();
