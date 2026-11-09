// Ships the Prolyte truss meshes and the Light Sky / ACME / iLighting GDTF set.
// Files stay on the site. The browser copies a mesh into its own database once.
var Catalog = (function () {
  const KEY = "lightplot.catalogDismissed.v1";

  function readDismissed() {
    try {
      const raw = JSON.parse(localStorage.getItem(KEY) || "[]");
      if (Array.isArray(raw)) return new Set(raw.map(String));
    } catch (err) { /* an empty set just imports again */ }
    return new Set();
  }

  function dismiss(id) {
    const set = readDismissed();
    set.add(String(id));
    try { localStorage.setItem(KEY, JSON.stringify(Array.from(set))); } catch (err) { /* private mode */ }
  }

  function fetchJson(url) {
    return fetch(url).then(function (res) {
      if (!res.ok) throw new Error("Нет каталога.");
      return res.json();
    });
  }

  function fetchBuffer(url) {
    return fetch(url).then(function (res) {
      if (!res.ok) throw new Error(url);
      return res.arrayBuffer();
    });
  }

  function each(items, run) {
    let index = 0;
    function step() {
      if (index >= items.length) return Promise.resolve();
      const item = items[index];
      index += 1;
      return Promise.resolve().then(function () { return run(item, index, items.length); }).then(step, step);
    }
    return step();
  }

  function installModels(ctx, skipped) {
    return fetchJson("samples/models/prolyte/catalog.json").then(function (rows) {
      const have = new Set(ctx.models().map(function (model) { return model.id; }));
      const pending = (Array.isArray(rows) ? rows : []).filter(function (item) {
        return item && item.id && item.file && !have.has(item.id) && !skipped.has(item.id);
      });
      if (!pending.length) return;
      return each(pending, function (item, index, total) {
        ctx.progress("Фермы Prolyte " + index + " из " + total);
        return fetchBuffer(item.file).then(function (buffer) {
          const mesh = ModelMesh.fromGlb(buffer);
          return PlotDb.addModel({
            id: item.id,
            name: item.name,
            category: "structure",
            size: mesh.size,
            fileName: item.file.split("/").pop(),
            source: "prolyte",
          }, mesh).then(function (record) {
            ctx.addModel(record, mesh);
          });
        });
      });
    });
  }

  function installFixtures(ctx, skipped) {
    return fetch("library/gdtf/catalog.json").then(function (res) {
      if (res.status === 404) return [];
      if (!res.ok) throw new Error("Нет каталога приборов.");
      return res.json();
    }).then(function (rows) {
      const have = new Set(FixtureLibrary.items().map(function (type) { return type.id; }));
      const pending = (Array.isArray(rows) ? rows : []).filter(function (item) {
        return item && item.id && item.file && !have.has(item.id) && !skipped.has(item.id);
      });
      if (!pending.length) return;
      return each(pending, function (item, index, total) {
        const brand = item.brand ? item.brand + " · " : "";
        ctx.progress(brand + index + " из " + total);
        return fetchBuffer(item.file).then(function (buffer) {
          return GdtfProfile.parse(buffer);
        }).then(function (profile) {
          const type = FixtureLibrary.ensure({
            id: item.id,
            name: profile.fixtureType || profile.name,
            kind: "fixture",
            fixtureType: profile.fixtureType || profile.name,
            mode: profile.mode,
            modes: profile.modes,
            size: profile.size,
            layer: "Свет",
            notes: profile.notes,
            storeMesh: true,
          });
          profile.id = type.id;
          return GdtfStore.put(type.id, profile).then(function () {
            ctx.addFixture(type, profile);
          });
        });
      });
    });
  }

  function install(ctx) {
    const skipped = readDismissed();
    ctx.progress("Открываю каталог…");
    return installModels(ctx, skipped).then(function () {
      return installFixtures(ctx, skipped);
    }).then(function () {
      ctx.progress("");
    });
  }

  return { install: install, dismiss: dismiss };
})();
