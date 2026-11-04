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

  function u64(view, offset) {
    const lo = view.getUint32(offset, true);
    const hi = view.getUint32(offset + 4, true);
    if (hi > 0x1fffff) throw new Error("Файл внутри архива слишком большой.");
    return hi * 0x100000000 + lo;
  }

  function zip64Catalog(view, eocd) {
    const loc = eocd - 20;
    if (loc < 0 || view.getUint32(loc, true) !== 0x07064b50) return null;
    const offset = u64(view, loc + 8);
    if (view.getUint32(offset, true) !== 0x06064b50) return null;
    return { count: u64(view, offset + 32), cdOffset: u64(view, offset + 48) };
  }

  function zip64Extra(view, start, length, need) {
    let cursor = start;
    const end = start + length;
    while (cursor + 4 <= end) {
      const id = view.getUint16(cursor, true);
      const size = view.getUint16(cursor + 2, true);
      if (id === 1) {
        let at = cursor + 4;
        const read = function () {
          const value = u64(view, at);
          at += 8;
          return value;
        };
        return {
          uncomp: need.uncomp ? read() : null,
          comp: need.comp ? read() : null,
          offset: need.offset ? read() : null,
        };
      }
      cursor += 4 + size;
    }
    return null;
  }

  async function unzip(buffer, keep) {
    const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const eocd = findEocd(bytes);
    if (eocd < 0) throw new Error("Файл не похож на архив MVR.");
    let count = view.getUint16(eocd + 10, true);
    let cdOffset = view.getUint32(eocd + 16, true);
    if (count === 0xffff || cdOffset === 0xffffffff) {
      const zip64 = zip64Catalog(view, eocd);
      if (!zip64) throw new Error("Архив ZIP64 без оглавления.");
      count = zip64.count;
      cdOffset = zip64.cdOffset;
    }
    const files = new Map();
    let cursor = cdOffset;
    for (let i = 0; i < count; i++) {
      if (cursor + 46 > bytes.length || view.getUint32(cursor, true) !== 0x02014b50) {
        throw new Error("Каталог архива повреждён.");
      }
      const method = view.getUint16(cursor + 10, true);
      let compSize = view.getUint32(cursor + 20, true);
      const nameLen = view.getUint16(cursor + 28, true);
      const extraLen = view.getUint16(cursor + 30, true);
      const commentLen = view.getUint16(cursor + 32, true);
      let localOffset = view.getUint32(cursor + 42, true);
      const nameStart = cursor + 46;
      const name = new TextDecoder("utf-8").decode(bytes.subarray(nameStart, nameStart + nameLen)).replace(/\\/g, "/");
      const extraStart = nameStart + nameLen;
      if (compSize === 0xffffffff || localOffset === 0xffffffff) {
        const extra = zip64Extra(view, extraStart, extraLen, {
          uncomp: view.getUint32(cursor + 24, true) === 0xffffffff,
          comp: compSize === 0xffffffff,
          offset: localOffset === 0xffffffff,
        });
        if (!extra) throw new Error("Архив ZIP64 без размеров файла.");
        if (extra.comp != null) compSize = extra.comp;
        if (extra.offset != null) localOffset = extra.offset;
      }
      cursor = extraStart + extraLen + commentLen;
      if (!name || name.endsWith("/")) continue;
      if (keep && !keep(name)) continue;
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
