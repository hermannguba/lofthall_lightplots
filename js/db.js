// Projects, lightplots, model library and GDTF profiles.
// One IndexedDB database, "lightplot" — the store the page already used for profiles.
var PlotDb = (function () {
  const VERSION = 2;
  const SESSION_KEY = "lightplot.session.v1";

  let opening = null;

  function uid(prefix) {
    return prefix + "-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8);
  }

  function fail(error, fallback) {
    if (error && error.name === "QuotaExceededError") {
      return new Error("Не хватает места в базе браузера.");
    }
    return error || new Error(fallback);
  }

  function open() {
    if (opening) return opening;
    opening = new Promise(function (resolve, reject) {
      let request;
      try {
        request = indexedDB.open("lightplot", VERSION);
      } catch (err) {
        opening = null;
        reject(err);
        return;
      }
      request.onupgradeneeded = function () {
        const db = request.result;
        if (!db.objectStoreNames.contains("profiles")) db.createObjectStore("profiles");
        if (!db.objectStoreNames.contains("projects")) db.createObjectStore("projects", { keyPath: "id" });
        if (!db.objectStoreNames.contains("plots")) db.createObjectStore("plots", { keyPath: "id" });
        if (!db.objectStoreNames.contains("models")) db.createObjectStore("models", { keyPath: "id" });
        if (!db.objectStoreNames.contains("meshes")) db.createObjectStore("meshes");
      };
      request.onsuccess = function () { resolve(request.result); };
      request.onerror = function () {
        opening = null;
        reject(fail(request.error, "База недоступна."));
      };
      request.onblocked = function () {
        opening = null;
        reject(new Error("База открыта в другой вкладке. Закройте её и обновите страницу."));
      };
    });
    return opening;
  }

  function requestDone(request, fallback) {
    return new Promise(function (resolve, reject) {
      request.onsuccess = function () { resolve(request.result); };
      request.onerror = function () { reject(fail(request.error, fallback)); };
    });
  }

  function transaction(names, mode) {
    return open().then(function (db) {
      return db.transaction(names, mode);
    });
  }

  function finish(tx, value, fallback) {
    return new Promise(function (resolve, reject) {
      tx.oncomplete = function () { resolve(value); };
      tx.onerror = function () { reject(fail(tx.error, fallback)); };
      tx.onabort = function () { reject(fail(tx.error, fallback)); };
    });
  }

  function put(storeName, value, key) {
    return transaction(storeName, "readwrite").then(function (tx) {
      const store = tx.objectStore(storeName);
      if (key === undefined) store.put(value);
      else store.put(value, key);
      return finish(tx, value, "Не удалось записать в базу.");
    });
  }

  function getAll(storeName) {
    return transaction(storeName, "readonly").then(function (tx) {
      return requestDone(tx.objectStore(storeName).getAll(), "Не удалось прочитать базу.");
    }).then(function (rows) { return rows || []; });
  }

  function get(storeName, key) {
    return transaction(storeName, "readonly").then(function (tx) {
      return requestDone(tx.objectStore(storeName).get(key), "Не удалось прочитать базу.");
    });
  }

  function remove(storeName, key) {
    return transaction(storeName, "readwrite").then(function (tx) {
      tx.objectStore(storeName).delete(key);
      return finish(tx, undefined, "Не удалось удалить запись.");
    });
  }

  function byCreated(a, b) {
    return (a.createdAt || 0) - (b.createdAt || 0);
  }

  function blankPlot(projectId, name) {
    const title = String(name || "Новая схема").trim() || "Новая схема";
    const now = Date.now();
    return {
      id: uid("plt"),
      projectId: projectId,
      name: title,
      note: "",
      venue: { name: title, note: "" },
      objects: [],
      createdAt: now,
      updatedAt: now,
    };
  }

  function saveProject(project) {
    if (!project.id) project.id = uid("prj");
    if (!project.createdAt) project.createdAt = Date.now();
    project.updatedAt = Date.now();
    project.name = String(project.name || "Проект").trim() || "Проект";
    project.note = String(project.note || "");
    return put("projects", project);
  }

  function savePlot(plot) {
    if (!plot.id) plot.id = uid("plt");
    if (!plot.createdAt) plot.createdAt = Date.now();
    plot.updatedAt = Date.now();
    plot.name = String(plot.name || "Схема").trim() || "Схема";
    plot.note = String(plot.note || "");
    return put("plots", plot);
  }

  function removeProject(id) {
    return getAll("plots").then(function (plots) {
      return transaction(["projects", "plots"], "readwrite").then(function (tx) {
        tx.objectStore("projects").delete(id);
        plots.forEach(function (plot) {
          if (plot.projectId === id) tx.objectStore("plots").delete(plot.id);
        });
        return finish(tx, undefined, "Не удалось удалить проект.");
      });
    });
  }

  function addModel(meta, mesh) {
    const now = Date.now();
    const record = {
      id: meta.id ? String(meta.id) : uid("mdl"),
      name: String(meta.name || "Модель").trim() || "Модель",
      category: meta.category,
      size: [Number(meta.size[0]), Number(meta.size[1]), Number(meta.size[2])],
      fileName: String(meta.fileName || ""),
      source: String(meta.source || ""),
      createdAt: now,
    };
    return put("models", record).then(function () {
      return put("meshes", {
        positions: mesh.positions,
        normals: mesh.normals,
      }, record.id);
    }).then(function () { return record; });
  }

  function removeModel(id) {
    return remove("models", id).then(function () { return remove("meshes", id); });
  }

  function clearModel(modelId, exceptPlotId) {
    return getAll("plots").then(function (plots) {
      const dirty = [];
      plots.forEach(function (plot) {
        if (plot.id === exceptPlotId) return;
        let changed = false;
        (plot.objects || []).forEach(function (obj) {
          if (obj && obj.modelId === modelId) {
            obj.modelId = "";
            changed = true;
          }
        });
        if (changed) dirty.push(plot);
      });
      return dirty.reduce(function (chain, plot) {
        return chain.then(function () { return savePlot(plot); });
      }, Promise.resolve());
    });
  }

  function loadMeshes(models) {
    return Promise.all(models.map(function (model) {
      return get("meshes", model.id).then(function (mesh) {
        if (!mesh || !mesh.positions) return null;
        return { id: model.id, positions: mesh.positions, normals: mesh.normals };
      });
    })).then(function (rows) {
      return rows.filter(Boolean);
    });
  }

  function readSession() {
    const empty = { projectId: "", plotId: "", byProject: {} };
    try {
      const raw = JSON.parse(localStorage.getItem(SESSION_KEY) || "null");
      if (!raw || typeof raw !== "object") return empty;
      const byProject = {};
      if (raw.byProject && typeof raw.byProject === "object") {
        Object.keys(raw.byProject).forEach(function (key) {
          byProject[String(key)] = String(raw.byProject[key] || "");
        });
      }
      return {
        projectId: String(raw.projectId || ""),
        plotId: String(raw.plotId || ""),
        byProject: byProject,
      };
    } catch (err) { /* a blocked store just opens the first plot */ }
    return empty;
  }

  function writeSession(projectId, plotId) {
    try {
      const session = readSession();
      session.projectId = String(projectId || "");
      session.plotId = String(plotId || "");
      session.byProject[session.projectId] = session.plotId;
      localStorage.setItem(SESSION_KEY, JSON.stringify(session));
    } catch (err) { /* private mode */ }
  }

  function seed(demo) {
    const parsed = PlotFormat.parsePlot(demo);
    const now = Date.now();
    const project = {
      id: uid("prj"),
      name: parsed.venue.name,
      note: "",
      createdAt: now,
      updatedAt: now,
    };
    const plot = {
      id: uid("plt"),
      projectId: project.id,
      name: "Учебная схема",
      note: parsed.venue.note,
      venue: parsed.venue,
      objects: parsed.objects,
      createdAt: now,
      updatedAt: now,
    };
    return saveProject(project).then(function () {
      return savePlot(plot);
    }).then(function () {
      return { projects: [project], plots: [plot] };
    });
  }

  function ensurePlots(projects, plots) {
    const missing = projects.filter(function (project) {
      return !plots.some(function (plot) { return plot.projectId === project.id; });
    });
    return missing.reduce(function (chain, project) {
      return chain.then(function () {
        const plot = blankPlot(project.id, "Новая схема");
        plots.push(plot);
        return savePlot(plot);
      });
    }, Promise.resolve());
  }

  function bootstrap(demo) {
    return Promise.all([getAll("projects"), getAll("plots"), getAll("models")]).then(function (rows) {
      let projects = rows[0].slice().sort(byCreated);
      let plots = rows[1].slice().sort(byCreated);
      const models = rows[2].slice().sort(byCreated);
      let chain = Promise.resolve();
      if (!projects.length) {
        chain = seed(demo).then(function (created) {
          projects = created.projects;
          plots = created.plots;
        });
      }
      return chain.then(function () {
        return ensurePlots(projects, plots);
      }).then(function () {
        return loadMeshes(models);
      }).then(function (meshes) {
        return {
          projects: projects,
          plots: plots,
          models: models,
          meshes: meshes,
          session: readSession(),
        };
      });
    });
  }

  return {
    bootstrap: bootstrap,
    blankPlot: blankPlot,
    saveProject: saveProject,
    savePlot: savePlot,
    removeProject: removeProject,
    removePlot: function (id) { return remove("plots", id); },
    addModel: addModel,
    removeModel: removeModel,
    clearModel: clearModel,
    writeSession: writeSession,
    putProfile: function (id, profile) {
      profile.id = id;
      return put("profiles", profile, id);
    },
    removeProfile: function (id) {
      return remove("profiles", id).catch(function () {});
    },
    allProfiles: function () {
      return getAll("profiles").catch(function () { return []; });
    },
  };
})();
