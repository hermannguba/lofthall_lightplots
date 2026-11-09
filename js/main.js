(function () {
  const venueName = document.getElementById("venue-name");
  const venueNote = document.getElementById("venue-note");
  const inspector = document.getElementById("inspector");
  const layersEl = document.getElementById("layers");
  const listEl = document.getElementById("list");
  const countEl = document.getElementById("count");
  const errorEl = document.getElementById("error");
  const hintEl = document.getElementById("hint");
  const canvas = document.getElementById("view");
  const fileInput = document.getElementById("file");
  const mvrInput = document.getElementById("mvr-file");
  const libraryEl = document.getElementById("library");
  const libForm = document.getElementById("lib-form");
  const placeBar = document.getElementById("place-bar");
  const placeLabel = document.getElementById("place-label");
  const placeHeight = document.getElementById("place-height");
  const moveButton = document.getElementById("tool-move");
  const plotSelect = document.getElementById("plot-select");
  const projectNameEl = document.getElementById("project-name");
  const homeEl = document.getElementById("home");
  const homeLead = document.getElementById("home-lead");
  const homeList = document.getElementById("home-list");
  const homeEmpty = document.getElementById("home-empty");
  const homeForm = document.getElementById("home-form");
  const plotScreen = document.getElementById("plot-screen");
  const headerActions = document.getElementById("header-actions");
  const nameForm = document.getElementById("name-form");
  const nameSubmit = document.getElementById("name-submit");
  const saveState = document.getElementById("save-state");
  const modelsEl = document.getElementById("models");
  const modelForm = document.getElementById("model-form");
  const modelFilter = document.getElementById("model-filter");
  const libraryFilter = document.getElementById("library-filter");
  const catalogState = document.getElementById("catalog-state");

  const engine = new PlotEngine(canvas);
  const viewButtons = Array.from(document.querySelectorAll("[data-view]"));
  let placing = null;
  let projects = [];
  let allPlots = [];
  let currentPlots = [];
  let currentProject = null;
  let plotRecord = null;
  let modelRecords = [];
  let naming = null;
  let session = { projectId: "", plotId: "", byProject: {} };
  let saveTimer = null;
  let pendingSave = Promise.resolve();
  let chain = Promise.resolve();

  const HINTS = {
    look: "Тяните левой кнопкой, чтобы крутить вид. Правая — сдвиг, колёсико — масштаб. Щелчок — карточка монтажа. MVR или JSON можно перетащить на страницу.",
    move: "Режим движения: тяните объект левой кнопкой, Shift меняет высоту. Пустое место по-прежнему крутит вид. Esc — выйти.",
    place: "Щёлкните по полу, чтобы поставить объект. Высоту задайте в панели. Esc — отмена.",
  };

  function showError(message) {
    errorEl.hidden = !message;
    errorEl.textContent = message || "";
  }

  function fmt(n) {
    return (Math.round(n * 100) / 100).toFixed(2);
  }

  function snap(n) {
    return Math.round(n * 100) / 100;
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function uid() {
    return "obj-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 6);
  }

  function updateHint() {
    hintEl.textContent = HINTS[engine.tool] || HINTS.look;
  }

  function defaultHeight(type) {
    if (type.kind === "fixture") return 6;
    if (type.kind === "structure") return Math.max(4, type.size[1] / 2);
    return snap(type.size[1] / 2);
  }

  function defaultLayer(type) {
    if (type.layer) return type.layer;
    if (type.kind === "equipment") return "Оборудование";
    if (type.kind === "structure") return "Фермы";
    return "Свет";
  }

  function cancelPlace() {
    placing = null;
    engine.setGhost(null);
    placeBar.hidden = true;
    if (engine.tool === "place") engine.tool = "look";
    renderLibrary();
    renderModels();
    updateHint();
  }

  function setMoveTool(on) {
    if (on) cancelPlace();
    engine.tool = on ? "move" : "look";
    moveButton.classList.toggle("is-on", on);
    updateHint();
  }

  function beginPlace(type) {
    placing = type;
    engine.tool = "place";
    moveButton.classList.remove("is-on");
    engine.placeHeight = defaultHeight(type);
    placeHeight.value = String(engine.placeHeight);
    placeLabel.textContent = "Ставлю «" + type.name + "». Щёлкните по полу.";
    placeBar.hidden = false;
    engine.setGhost({
      id: "__ghost",
      name: type.name,
      kind: type.kind,
      layer: defaultLayer(type),
      position: [snap(engine.target[0]), engine.placeHeight, snap(engine.target[2])],
      size: type.size.slice(),
      rotation: [0, 0, 0],
      color: type.color || "",
      fixtureType: type.fixtureType || "",
      gdtfId: type.gdtfId || "",
      modelId: type.modelId || "",
    });
    renderLibrary();
    renderModels();
    updateHint();
  }

  function nextSerial(label) {
    const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const pattern = new RegExp("^" + escaped + " (\\d+)$");
    let max = 0;
    engine.plot.objects.forEach(function (obj) {
      const match = pattern.exec(obj.name);
      if (match) max = Math.max(max, Number(match[1]));
    });
    return max + 1;
  }

  function placeAt(point) {
    const type = placing;
    if (!type) return;
    const serial = String(nextSerial(type.name)).padStart(2, "0");
    const obj = {
      id: uid(),
      name: type.name + " " + serial,
      kind: type.kind,
      layer: defaultLayer(type),
      position: [snap(point[0]), snap(engine.placeHeight), snap(point[2])],
      size: type.size.slice(),
      rotation: [0, 0, 0],
      color: type.color || "",
      fixtureType: type.kind === "fixture" ? (type.fixtureType || type.name) : "",
      mode: type.kind === "fixture" ? (type.mode || "") : "",
      universe: null,
      address: null,
      circuit: "",
      hang: "",
      notes: type.notes || "",
      gdtfId: type.gdtfId || "",
      modelId: type.modelId || "",
    };
    engine.addObject(obj);
    renderLayers();
    renderList();
    engine.select(obj.id);
    touchPlot();
  }

  function saveTypeFrom(obj) {
    const type = FixtureLibrary.add({
      name: obj.fixtureType || obj.name,
      kind: obj.kind,
      fixtureType: obj.fixtureType || obj.name,
      mode: obj.mode,
      size: obj.size.slice(),
      layer: obj.layer,
      color: obj.color || "",
      notes: "",
      gdtfId: obj.gdtfId || "",
      modelId: obj.modelId || "",
    });
    renderLibrary();
  }

  function numInput(key, index, value, step) {
    return "<input data-k=\"" + key + "\" data-i=\"" + index + "\" type=\"number\" step=\"" + step + "\" value=\"" + value + "\">";
  }

  function textInput(key, value) {
    return "<input data-k=\"" + key + "\" type=\"text\" value=\"" + escapeHtml(value || "") + "\" autocomplete=\"off\">";
  }

  function renderInspector(obj) {
    if (!obj) {
      inspector.innerHTML = "<p class=\"empty\">Щёлкните прибор на схеме или в списке — здесь можно поменять монтаж и положение.</p>";
      return;
    }
    const p = obj.position;
    const s = obj.size;
    const r = obj.rotation || [0, 0, 0];
    const kindOptions = Object.keys(PlotFormat.KINDS).map(function (key) {
      return "<option value=\"" + key + "\"" + (key === obj.kind ? " selected" : "") + ">" + PlotFormat.KINDS[key] + "</option>";
    }).join("");
    inspector.innerHTML = [
      "<form class=\"edit\" data-id=\"" + escapeHtml(obj.id) + "\">",
      "<label class=\"stack\">Имя" + textInput("name", obj.name) + "</label>",
      "<label class=\"stack\">Модель<select data-k=\"modelId\">" + modelOptions(obj) + "</select></label>",
      "<div class=\"xyz\">",
      "<label class=\"stack\">Вид<select data-k=\"kind\">" + kindOptions + "</select></label>",
      "<label class=\"stack\">Слой" + textInput("layer", obj.layer) + "</label>",
      "<label class=\"stack\">Подвес" + textInput("hang", obj.hang) + "</label>",
      "</div>",
      "<div class=\"xyz\">",
      "<label class=\"stack\">Тип" + textInput("fixtureType", obj.fixtureType) + "</label>",
      "<label class=\"stack\">Мод" + textInput("mode", obj.mode) + "</label>",
      "<label class=\"stack\">Линия" + textInput("circuit", obj.circuit) + "</label>",
      "</div>",
      "<div class=\"xyz\">",
      "<label class=\"stack\">Universe<input data-k=\"universe\" type=\"number\" min=\"1\" step=\"1\" value=\"" + (obj.universe == null ? "" : obj.universe) + "\"></label>",
      "<label class=\"stack\">Адрес<input data-k=\"address\" type=\"number\" min=\"1\" step=\"1\" value=\"" + (obj.address == null ? "" : obj.address) + "\"></label>",
      "<label class=\"stack\">Примечание" + textInput("notes", obj.notes) + "</label>",
      "</div>",
      "<div class=\"xyz\">",
      "<label class=\"stack\">X" + numInput("position", 0, fmt(p[0]), "0.01") + "</label>",
      "<label class=\"stack\">Y" + numInput("position", 1, fmt(p[1]), "0.01") + "</label>",
      "<label class=\"stack\">Z" + numInput("position", 2, fmt(p[2]), "0.01") + "</label>",
      "</div>",
      "<div class=\"xyz\">",
      "<label class=\"stack\">Поворот X" + numInput("rotation", 0, fmt(r[0]), "1") + "</label>",
      "<label class=\"stack\">Поворот Y" + numInput("rotation", 1, fmt(r[1]), "1") + "</label>",
      "<label class=\"stack\">Поворот Z" + numInput("rotation", 2, fmt(r[2]), "1") + "</label>",
      "</div>",
      "<div class=\"xyz\">",
      "<label class=\"stack\">Ширина" + numInput("size", 0, fmt(s[0]), "0.01") + "</label>",
      "<label class=\"stack\">Высота" + numInput("size", 1, fmt(s[1]), "0.01") + "</label>",
      "<label class=\"stack\">Глубина" + numInput("size", 2, fmt(s[2]), "0.01") + "</label>",
      "</div>",
      "<div class=\"edit-actions\">",
      "<button type=\"button\" data-act=\"move\">Двигать</button>",
      "<button type=\"button\" data-act=\"library\">В базу</button>",
      "<button type=\"button\" class=\"danger\" data-act=\"delete\">Удалить</button>",
      "</div>",
      "</form>",
    ].join("");
    markList(obj.id);
  }

  function applyControl(input) {
    const obj = engine.selected();
    if (!obj || !input.dataset || !input.dataset.k) return;
    const key = input.dataset.k;
    if (key === "modelId") {
      applyModel(obj, input.value);
      return;
    }
    if (input.dataset.i != null) {
      const index = Number(input.dataset.i);
      const value = Number(input.value);
      if (!Number.isFinite(value)) return;
      if (key === "size" && value <= 0) return;
      obj[key][index] = value;
    } else if (key === "universe" || key === "address") {
      if (input.value.trim() === "") obj[key] = null;
      else {
        const value = Number(input.value);
        if (!Number.isInteger(value)) return;
        obj[key] = value;
      }
    } else {
      obj[key] = input.value;
    }
    engine.refresh(obj.id);
    touchPlot();
    if (key === "name" || key === "universe" || key === "address" || key === "hang" || key === "layer" || key === "kind" || key === "fixtureType") {
      if (key === "layer") renderLayers();
      renderList();
      markList(obj.id);
    }
  }

  function markList(id) {
    listEl.querySelectorAll(".item").forEach(function (button) {
      button.classList.toggle("is-on", button.dataset.id === id);
    });
  }

  function renderLayers() {
    layersEl.innerHTML = engine.layers().map(function (layer) {
      const checked = engine.hidden.has(layer) ? "" : " checked";
      return "<label class=\"check\"><input type=\"checkbox\" data-layer=\"" + escapeHtml(layer) + "\"" + checked + "> " + escapeHtml(layer) + "</label>";
    }).join("");
  }

  function renderList() {
    const groups = new Map();
    engine.plot.objects.forEach(function (obj) {
      const key = obj.hang || obj.layer;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(obj);
    });
    const html = [];
    groups.forEach(function (items, name) {
      html.push("<h3>" + escapeHtml(name) + "</h3>");
      items.forEach(function (obj) {
        const meta = obj.universe != null && obj.address != null
          ? "U" + obj.universe + " · " + obj.address
          : (obj.fixtureType || PlotFormat.KINDS[obj.kind]);
        html.push(
          "<button type=\"button\" class=\"item\" data-id=\"" + escapeHtml(obj.id) + "\">" +
          "<span>" + escapeHtml(obj.name) + "</span><span class=\"meta\">" + escapeHtml(meta) + "</span></button>"
        );
      });
    });
    listEl.innerHTML = html.join("");
    countEl.textContent = String(engine.plot.objects.length);
  }

  function matchesQuery(query, parts) {
    if (!query) return true;
    return parts.some(function (part) { return String(part || "").toLowerCase().indexOf(query) !== -1; });
  }

  function renderLibrary() {
    const query = libraryFilter ? libraryFilter.value.trim().toLowerCase() : "";
    const rows = FixtureLibrary.items().filter(function (type) {
      return matchesQuery(query, [type.name, type.fixtureType, type.mode, type.notes]);
    });
    libraryEl.innerHTML = rows.map(function (type) {
      const on = placing && placing.id === type.id ? " is-on" : "";
      return "<div class=\"lib-row\"><button type=\"button\" class=\"lib-item" + on + "\" data-type=\"" + escapeHtml(type.id) + "\">" +
        "<span>" + escapeHtml(type.name) + "</span><span class=\"meta\">" + escapeHtml(type.modelId ? "3D" : type.gdtfId ? (type.mode || "GDTF") : PlotFormat.KINDS[type.kind]) + "</span></button>" +
        "<button type=\"button\" class=\"lib-x\" data-remove=\"" + escapeHtml(type.id) + "\" aria-label=\"Убрать " + escapeHtml(type.name) + " из базы\">×</button></div>";
    }).join("");
  }

  function renderPlot() {
    const plot = engine.plot;
    venueName.textContent = plot.venue.name;
    venueNote.textContent = plot.venue.note || "Схема площадки";
    document.title = plot.venue.name + " — схема";
    renderLayers();
    renderList();
    renderInspector(engine.selected());
  }

  function sameFixture(a, b) {
    const fold = function (value) { return String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, ""); };
    const x = fold(a);
    const y = fold(b);
    if (!x || !y) return false;
    if (x === y) return true;
    const short = x.length < y.length ? x : y;
    const long = short === x ? y : x;
    return short.length >= 8 && long.indexOf(short) !== -1;
  }

  function attachProfiles(plot) {
    const types = FixtureLibrary.items().filter(function (type) { return type.gdtfId; });
    plot.objects.forEach(function (obj) {
      if (obj.gdtfId && types.some(function (type) { return type.gdtfId === obj.gdtfId; })) return;
      const hit = types.find(function (type) { return sameFixture(type.fixtureType, obj.fixtureType) || sameFixture(type.name, obj.fixtureType); });
      if (hit) obj.gdtfId = hit.gdtfId;
    });
  }

  function usePlot(data, options) {
    const plot = PlotFormat.parsePlot(data);
    function show() {
      attachProfiles(plot);
      cancelPlace();
      engine.load(plot);
      moveButton.classList.remove("is-on");
      renderPlot();
      showError("");
      updateHint();
      if (options && options.keep) return keepImported();
      return Promise.resolve();
    }
    if (options && options.keep) return flushPlot().then(show);
    return show();
  }

  function enqueue(task) {
    const run = chain.then(task, task);
    chain = run.then(function () {}, function () {});
    return run;
  }

  function fail(err) {
    showError(err && err.message ? err.message : "Не удалось записать в базу.");
  }

  function markSaving() { saveState.textContent = "запись…"; }
  function markSaved() { saveState.textContent = "сохранено"; }

  function modelOptions(obj) {
    const current = obj.modelId || "";
    const groups = [
      ["fixture", "Световые приборы"],
      ["stage", "Сценические элементы"],
      ["structure", "Конструктивные элементы"],
    ];
    const html = ["<option value=\"\">Габарит</option>"];
    groups.forEach(function (group) {
      const items = modelRecords.filter(function (model) { return model.category === group[0]; });
      if (!items.length) return;
      html.push("<optgroup label=\"" + escapeHtml(group[1]) + "\">");
      items.forEach(function (model) {
        html.push("<option value=\"" + escapeHtml(model.id) + "\"" + (model.id === current ? " selected" : "") + ">" + escapeHtml(model.name) + "</option>");
      });
      html.push("</optgroup>");
    });
    return html.join("");
  }

  function modelType(model) {
    const cat = ModelMesh.CATEGORIES[model.category] || ModelMesh.CATEGORIES.fixture;
    return {
      id: model.id,
      name: model.name,
      kind: cat.kind,
      size: model.size.slice(),
      layer: cat.layer,
      fixtureType: cat.kind === "fixture" ? model.name : "",
      mode: "",
      color: "",
      notes: "",
      gdtfId: "",
      modelId: model.id,
    };
  }

  function applyModel(obj, id) {
    obj.modelId = id;
    const model = modelRecords.find(function (item) { return item.id === id; });
    if (model) {
      obj.size[0] = model.size[0];
      obj.size[1] = model.size[1];
      obj.size[2] = model.size[2];
    }
    engine.refresh(obj.id);
    renderInspector(obj);
    renderList();
    touchPlot();
  }

  function touchPlot() {
    if (!plotRecord || !engine.plot) return;
    markSaving();
    clearTimeout(saveTimer);
    saveTimer = setTimeout(function () {
      flushPlot().catch(fail);
    }, 400);
  }

  function flushPlot() {
    clearTimeout(saveTimer);
    saveTimer = null;
    if (!plotRecord || !engine.plot) return Promise.resolve();
    plotRecord.venue = {
      name: engine.plot.venue.name,
      note: engine.plot.venue.note || "",
    };
    plotRecord.objects = engine.plot.objects;
    plotRecord.updatedAt = Date.now();
    markSaving();
    const save = PlotDb.savePlot(plotRecord).then(function () { markSaved(); });
    pendingSave = save.then(function () {}, function () {});
    return save;
  }

  function plotsOf(projectId) {
    return allPlots.filter(function (plot) { return plot.projectId === projectId; });
  }

  function fillSelect(select, items, currentId) {
    select.innerHTML = items.map(function (item) {
      return "<option value=\"" + escapeHtml(item.id) + "\">" + escapeHtml(item.name) + "</option>";
    }).join("");
    if (currentId) select.value = currentId;
  }

  function plotCountLabel(count) {
    const n10 = count % 10;
    const n100 = count % 100;
    const word = n10 === 1 && n100 !== 11 ? "схема"
      : n10 >= 2 && n10 <= 4 && (n100 < 12 || n100 > 14) ? "схемы"
      : "схем";
    return count + " " + word;
  }

  function renderSelectors() {
    if (projectNameEl) projectNameEl.textContent = currentProject ? currentProject.name : "";
    fillSelect(plotSelect, currentPlots, plotRecord && plotRecord.id);
  }

  function showHome() {
    homeEl.hidden = false;
    plotScreen.hidden = true;
    headerActions.hidden = true;
    homeLead.textContent = "Сначала выберите проект. Его схемы откроются внутри.";
    venueNote.textContent = "Сначала выберите проект.";
    venueName.textContent = "Проекты";
    document.title = "Проекты — схемы";
    renderHome();
  }

  function showPlot() {
    homeEl.hidden = true;
    plotScreen.hidden = false;
    headerActions.hidden = false;
  }

  function renderHome() {
    const rows = projects.slice().sort(function (a, b) {
      return a.name.localeCompare(b.name, "ru");
    });
    homeEmpty.hidden = rows.length > 0;
    homeList.innerHTML = rows.map(function (project) {
      const count = plotsOf(project.id).length;
      return "<button type=\"button\" class=\"home-card\" data-project=\"" + escapeHtml(project.id) + "\">" +
        "<span class=\"home-card-name\">" + escapeHtml(project.name) + "</span>" +
        "<span class=\"meta\">" + escapeHtml(plotCountLabel(count)) + "</span></button>";
    }).join("");
  }

  function remember() {
    if (!currentProject || !plotRecord) return;
    if (!session.byProject) session.byProject = {};
    session.projectId = currentProject.id;
    session.plotId = plotRecord.id;
    session.byProject[currentProject.id] = plotRecord.id;
    PlotDb.writeSession(currentProject.id, plotRecord.id);
  }

  function openRecord(record) {
    showPlot();
    plotRecord = record;
    usePlot({ venue: record.venue, objects: record.objects });
    remember();
    renderSelectors();
    markSaved();
  }

  function openProject(project) {
    currentProject = project;
    currentPlots = plotsOf(project.id);
    homeForm.hidden = true;
    if (!currentPlots.length) return addPlot("Новая схема");
    const savedId = session.byProject && session.byProject[project.id];
    const remembered = currentPlots.find(function (plot) { return plot.id === savedId; });
    openRecord(remembered || currentPlots[0]);
    return Promise.resolve();
  }

  function keepImported() {
    if (!currentProject || !engine.plot) return Promise.resolve();
    const now = Date.now();
    const record = {
      id: "plt-" + now.toString(36) + "-" + Math.random().toString(36).slice(2, 8),
      projectId: currentProject.id,
      name: engine.plot.venue.name,
      note: engine.plot.venue.note || "",
      venue: { name: engine.plot.venue.name, note: engine.plot.venue.note || "" },
      objects: engine.plot.objects,
      createdAt: now,
      updatedAt: now,
    };
    plotRecord = record;
    allPlots.push(record);
    currentPlots = plotsOf(currentProject.id);
    remember();
    renderSelectors();
    markSaving();
    return PlotDb.savePlot(record).then(function () { markSaved(); });
  }

  function addPlot(name) {
    return flushPlot().then(function () {
      const record = PlotDb.blankPlot(currentProject.id, name);
      return PlotDb.savePlot(record).then(function () {
        allPlots.push(record);
        currentPlots = plotsOf(currentProject.id);
        openRecord(record);
      });
    });
  }

  function addProject(name) {
    return flushPlot().then(function () {
      const project = { name: name, note: "" };
      return PlotDb.saveProject(project).then(function () {
        const record = PlotDb.blankPlot(project.id, name);
        return PlotDb.savePlot(record).then(function () { return record; });
      }).then(function (record) {
        projects.push(project);
        allPlots.push(record);
        currentProject = project;
        currentPlots = plotsOf(project.id);
        openRecord(record);
      });
    });
  }

  function renameProject(name) {
    currentProject.name = name;
    return PlotDb.saveProject(currentProject).then(function () {
      renderSelectors();
      markSaved();
    });
  }

  function renamePlot(name) {
    const previous = plotRecord.name;
    plotRecord.name = name;
    if (engine.plot && engine.plot.venue.name === previous) {
      engine.plot.venue.name = name;
      venueName.textContent = name;
      document.title = name + " — схема";
    }
    return flushPlot().then(renderSelectors);
  }

  function deleteProject() {
    if (projects.length < 2) {
      showError("Нужен хотя бы один проект.");
      return Promise.resolve();
    }
    const project = currentProject;
    if (!window.confirm("Удалить проект «" + project.name + "» и все его схемы?")) return Promise.resolve();
    showError("");
    clearTimeout(saveTimer);
    saveTimer = null;
    return pendingSave.then(function () {
      plotRecord = null;
      return PlotDb.removeProject(project.id);
    }).then(function () {
      projects = projects.filter(function (item) { return item.id !== project.id; });
      allPlots = allPlots.filter(function (item) { return item.projectId !== project.id; });
      currentProject = null;
      currentPlots = [];
      showHome();
      return Promise.resolve();
    });
  }

  function deletePlot() {
    if (!plotRecord) return Promise.resolve();
    const plot = plotRecord;
    const last = currentPlots.length < 2;
    const message = last
      ? "Удалить схему «" + plot.name + "»? Это последняя схема проекта — откроется пустая."
      : "Удалить схему «" + plot.name + "»?";
    if (!window.confirm(message)) return Promise.resolve();
    showError("");
    clearTimeout(saveTimer);
    saveTimer = null;
    return pendingSave.then(function () {
      plotRecord = null;
      return PlotDb.removePlot(plot.id);
    }).then(function () {
      allPlots = allPlots.filter(function (item) { return item.id !== plot.id; });
      currentPlots = plotsOf(currentProject.id);
      if (!currentPlots.length) return addPlot("Новая схема");
      openRecord(currentPlots[0]);
      return Promise.resolve();
    });
  }

  function askName(mode) {
    naming = mode;
    const renaming = mode.indexOf("rename") === 0;
    nameSubmit.textContent = renaming ? "Сохранить" : "Создать";
    nameForm.elements.title.value = renaming
      ? (mode === "rename-project" ? currentProject.name : plotRecord.name)
      : "";
    nameForm.elements.title.placeholder = mode.indexOf("project") !== -1 ? "Название проекта" : "Название схемы";
    nameForm.hidden = false;
    nameForm.elements.title.focus();
    nameForm.elements.title.select();
  }

  function closeNameForm() {
    naming = null;
    nameForm.hidden = true;
    nameForm.reset();
  }

  function renderModels() {
    const query = modelFilter ? modelFilter.value.trim().toLowerCase() : "";
    const rows = modelRecords.filter(function (model) {
      return matchesQuery(query, [model.name, model.fileName]);
    }).slice().sort(function (a, b) {
      return a.name.localeCompare(b.name, "ru");
    });
    modelsEl.innerHTML = rows.map(function (model) {
      const cat = ModelMesh.CATEGORIES[model.category];
      const on = placing && placing.modelId === model.id ? " is-on" : "";
      const size = model.size.map(function (n) { return fmt(n); }).join("×");
      return "<div class=\"lib-row\"><button type=\"button\" class=\"lib-item" + on + "\" data-model=\"" + escapeHtml(model.id) + "\" title=\"" + escapeHtml((cat ? cat.label + " · " : "") + size) + "\">" +
        "<span>" + escapeHtml(model.name) + "</span><span class=\"meta\">" + escapeHtml(size) + "</span></button>" +
        "<button type=\"button\" class=\"lib-x\" data-model-remove=\"" + escapeHtml(model.id) + "\" aria-label=\"Убрать " + escapeHtml(model.name) + " из библиотеки\">×</button></div>";
    }).join("");
  }

  function openModelForm(file) {
    modelForm.hidden = false;
    if (file) {
      try {
        const list = new DataTransfer();
        list.items.add(file);
        modelForm.elements.file.files = list.files;
      } catch (err) { /* the file input stays empty and the form asks again */ }
      if (!modelForm.elements.name.value) {
        modelForm.elements.name.value = file.name.replace(/\.glb$/i, "").replace(/[_-]+/g, " ");
      }
    }
    modelForm.elements.name.focus();
  }

  function forgetModel(id) {
    if (placing && placing.modelId === id) cancelPlace();
    allPlots.forEach(function (plot) {
      (plot.objects || []).forEach(function (obj) {
        if (obj && obj.modelId === id) obj.modelId = "";
      });
    });
    if (engine.plot) {
      engine.plot.objects.forEach(function (obj) {
        if (obj.modelId === id) obj.modelId = "";
      });
    }
    const removed = modelRecords.find(function (model) { return model.id === id; });
    if (removed && (removed.source === "prolyte" || String(removed.id).indexOf("prolyte-") === 0)) Catalog.dismiss(removed.id);
    FixtureLibrary.forgetModel(id);
    engine.dropModel(id);
    modelRecords = modelRecords.filter(function (model) { return model.id !== id; });
    renderModels();
    renderLibrary();
    renderInspector(engine.selected());
    const except = plotRecord && plotRecord.id;
    return flushPlot().then(function () {
      return PlotDb.clearModel(id, except);
    }).then(function () {
      return PlotDb.removeModel(id);
    });
  }

  function boot() {
    venueNote.textContent = "Открываю базу…";
    Promise.all([GdtfStore.all(), PlotDb.bootstrap(demoPlot)]).then(function (parts) {
      parts[0].forEach(function (profile) { engine.uploadProfile(profile); });
      const data = parts[1];
      projects = data.projects;
      allPlots = data.plots;
      modelRecords = data.models;
      data.meshes.forEach(function (mesh) { engine.uploadModel(mesh.id, mesh); });
      session = data.session || { projectId: "", plotId: "", byProject: {} };
      if (!session.byProject) session.byProject = {};
      renderModels();
      showHome();
      Catalog.install({
        models: function () { return modelRecords; },
        addModel: function (record, mesh) {
          engine.uploadModel(record.id, mesh);
          modelRecords.push(record);
          renderModels();
        },
        addFixture: function (type, profile) {
          engine.uploadProfile(profile);
          renderLibrary();
        },
        progress: function (text) {
          catalogState.hidden = !text;
          catalogState.textContent = text || "";
        },
      }).catch(function (err) {
        catalogState.hidden = false;
        catalogState.textContent = err && err.message ? err.message : "Каталог не загрузился.";
      });
    }).catch(function (err) {
      fail(err);
      try { usePlot(demoPlot); } catch (plotErr) { showError(plotErr.message); }
    });
  }

  engine.onSelect = renderInspector;
  engine.onTransform = function (obj) {
    [0, 1, 2].forEach(function (index) {
      const input = inspector.querySelector("[data-k=\"position\"][data-i=\"" + index + "\"]");
      if (input && document.activeElement !== input) input.value = fmt(obj.position[index]);
    });
    touchPlot();
  };
  engine.onPlace = placeAt;
  engine.onViewChange = function (name) {
    viewButtons.forEach(function (button) {
      button.classList.toggle("is-on", button.dataset.view === name);
    });
  };

  viewButtons.forEach(function (button) {
    button.addEventListener("click", function () {
      engine.setView(button.dataset.view);
    });
  });
  document.getElementById("frame").addEventListener("click", function () {
    engine.frame();
  });
  moveButton.addEventListener("click", function () {
    setMoveTool(engine.tool !== "move");
  });
  fileInput.addEventListener("change", function () {
    const file = fileInput.files && fileInput.files[0];
    fileInput.value = "";
    if (file) readIncoming(file);
  });
  mvrInput.addEventListener("change", function () {
    const file = mvrInput.files && mvrInput.files[0];
    mvrInput.value = "";
    if (file) readIncoming(file);
  });
  document.getElementById("save-file").addEventListener("click", function () {
    if (!engine.plot) return;
    const blob = new Blob([JSON.stringify(engine.plot, null, 2)], { type: "application/json" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = "lightplot.json";
    link.click();
    URL.revokeObjectURL(link.href);
  });

  document.addEventListener("dragover", function (e) {
    e.preventDefault();
  });
  document.addEventListener("drop", function (e) {
    e.preventDefault();
    if (plotScreen.hidden) {
      homeLead.textContent = "Сначала откройте проект, потом перетащите файл на схему.";
      return;
    }
    const file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (file) readIncoming(file);
  });

  function readIncoming(file) {
    const name = file.name.toLowerCase();
    if (name.endsWith(".glb")) openModelForm(file);
    else if (name.endsWith(".gdtf")) readGdtf(file);
    else if (name.endsWith(".mvr") || name.endsWith(".zip")) readMvr(file);
    else if (name.endsWith(".json")) readJson(file);
    else {
      file.slice(0, 4).arrayBuffer().then(function (buf) {
        const mark = new Uint8Array(buf);
        if (mark[0] === 0x50 && mark[1] === 0x4b) readMvr(file);
        else readJson(file);
      }).catch(function () {
        showError("Не удалось прочитать файл.");
      });
    }
  }

  function readJson(file) {
    const reader = new FileReader();
    reader.onerror = function () { showError("Не удалось прочитать файл."); };
    reader.onload = function () {
      try {
        usePlot(JSON.parse(String(reader.result)), { keep: true }).catch(function (err) {
          showError(err && err.message ? err.message : "Не удалось открыть JSON.");
        });
      } catch (err) {
        showError(err instanceof SyntaxError ? "Файл не похож на JSON." : err.message);
      }
    };
    reader.readAsText(file);
  }

  function readMvr(file) {
    venueNote.textContent = "Читаю " + file.name + "…";
    showError("");
    const reader = new FileReader();
    reader.onerror = function () { showError("Не удалось прочитать файл."); };
    reader.onload = function () {
      MvrImport.parse(reader.result, file.name).then(function (plot) {
        return usePlot(plot, { keep: true });
      }).catch(function (err) {
        showError(err && err.message ? err.message : "Не удалось прочитать MVR.");
      });
    };
    reader.readAsArrayBuffer(file);
  }

  function readGdtf(file) {
    showError("");
    return new Promise(function (resolve) {
      const reader = new FileReader();
      reader.onerror = function () {
        showError("Не удалось прочитать " + file.name + ".");
        resolve();
      };
      reader.onload = function () {
        GdtfProfile.parse(reader.result).then(function (profile) {
          const type = FixtureLibrary.add({
            name: profile.name,
            kind: "fixture",
            fixtureType: profile.fixtureType,
            mode: profile.mode,
            modes: profile.modes,
            size: profile.size,
            layer: "Свет",
            notes: profile.notes,
            storeMesh: true,
          });
          profile.id = type.id;
          return GdtfStore.put(type.id, profile).then(function () {
            engine.uploadProfile(profile);
            beginPlace(type);
          });
        }).catch(function (err) {
          showError(err && err.message ? err.message : "Не удалось прочитать GDTF.");
        }).then(resolve);
      };
      reader.readAsArrayBuffer(file);
    });
  }

  layersEl.addEventListener("change", function (e) {
    const input = e.target;
    if (!input.dataset || !input.dataset.layer) return;
    engine.setLayerVisible(input.dataset.layer, input.checked);
  });

  listEl.addEventListener("click", function (e) {
    const button = e.target.closest(".item");
    if (!button) return;
    engine.select(button.dataset.id);
    engine.focus(button.dataset.id);
  });

  inspector.addEventListener("submit", function (e) { e.preventDefault(); });
  inspector.addEventListener("input", function (e) { applyControl(e.target); });
  inspector.addEventListener("change", function (e) { applyControl(e.target); });
  inspector.addEventListener("click", function (e) {
    const button = e.target.closest("[data-act]");
    if (!button) return;
    const obj = engine.selected();
    if (!obj) return;
    if (button.dataset.act === "move") setMoveTool(true);
    if (button.dataset.act === "library") saveTypeFrom(obj);
    if (button.dataset.act === "delete") {
      const name = obj.name;
      if (!window.confirm("Удалить «" + name + "» со схемы?")) return;
      engine.removeObject(obj.id);
      renderLayers();
      renderList();
      touchPlot();
    }
  });

  libraryEl.addEventListener("click", function (e) {
    const remove = e.target.closest("[data-remove]");
    if (remove) {
      const type = FixtureLibrary.items().find(function (item) { return item.id === remove.dataset.remove; });
      if (placing && placing.id === remove.dataset.remove) cancelPlace();
      if (type && String(type.id).indexOf("gdtf-") === 0) Catalog.dismiss(type.id);
      FixtureLibrary.remove(remove.dataset.remove);
      if (type && type.gdtfId && !FixtureLibrary.items().some(function (item) { return item.gdtfId === type.gdtfId; })) {
        GdtfStore.remove(type.gdtfId);
        engine.dropProfile(type.gdtfId);
      }
      renderLibrary();
      return;
    }
    const button = e.target.closest("[data-type]");
    if (!button) return;
    const type = FixtureLibrary.items().find(function (item) { return item.id === button.dataset.type; });
    if (type) beginPlace(type);
  });

  const gdtfInput = document.getElementById("gdtf-file");
  gdtfInput.addEventListener("change", function () {
    const files = Array.from(gdtfInput.files || []);
    gdtfInput.value = "";
    files.reduce(function (chain, file) {
      return chain.then(function () { return readGdtf(file); });
    }, Promise.resolve());
  });
  document.getElementById("lib-add").addEventListener("click", function () {
    libForm.hidden = !libForm.hidden;
    if (!libForm.hidden) libForm.elements.name.focus();
  });
  libForm.addEventListener("submit", function (e) {
    e.preventDefault();
    const data = new FormData(libForm);
    const name = String(data.get("name") || "").trim();
    const size = [Number(data.get("sx")), Number(data.get("sy")), Number(data.get("sz"))];
    if (!name) {
      showError("Нужно название типа.");
      return;
    }
    if (size.some(function (n) { return !Number.isFinite(n) || n <= 0; })) {
      showError("Габарит — три числа больше нуля, в метрах.");
      return;
    }
    const kind = String(data.get("kind") || "fixture");
    const type = FixtureLibrary.add({
      name: name,
      kind: kind,
      fixtureType: kind === "fixture" ? name : "",
      mode: String(data.get("mode") || ""),
      size: size,
    });
    libForm.reset();
    libForm.hidden = true;
    showError("");
    beginPlace(type);
  });

  placeHeight.addEventListener("input", function () {
    const value = Number(placeHeight.value);
    if (!Number.isFinite(value)) return;
    engine.placeHeight = value;
    if (engine.ghost) {
      engine.ghost.obj.position[1] = value;
      engine.syncGhost();
    }
  });
  document.getElementById("place-cancel").addEventListener("click", cancelPlace);

  window.addEventListener("keydown", function (e) {
    const tag = e.target && e.target.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
    if (e.key === "1") engine.setView("orbit");
    if (e.key === "2") engine.setView("top");
    if (e.key === "3") engine.setView("front");
    if (e.key === "4") engine.setView("side");
    if (e.key === "f" || e.key === "F" || e.key === "а" || e.key === "А") engine.frame();
    if (e.key === "Escape") {
      if (engine.tool === "place") cancelPlace();
      else if (engine.tool === "move") setMoveTool(false);
      else engine.select(null);
      return;
    }
    const obj = engine.selected();
    if (!obj) return;
    const step = e.shiftKey ? 0.5 : 0.1;
    let axis = -1;
    let sign = 0;
    if (e.key === "ArrowLeft") { axis = 0; sign = -1; }
    if (e.key === "ArrowRight") { axis = 0; sign = 1; }
    if (e.key === "ArrowDown") { axis = 2; sign = -1; }
    if (e.key === "ArrowUp") { axis = 2; sign = 1; }
    if (e.key === "PageDown") { axis = 1; sign = -1; }
    if (e.key === "PageUp") { axis = 1; sign = 1; }
    if (!sign) return;
    e.preventDefault();
    obj.position[axis] = snap(Math.max(axis === 1 ? 0 : -Infinity, obj.position[axis] + sign * step));
    engine.refresh(obj.id);
    [0, 1, 2].forEach(function (index) {
      const input = inspector.querySelector("[data-k=\"position\"][data-i=\"" + index + "\"]");
      if (input && document.activeElement !== input) input.value = fmt(obj.position[index]);
    });
    touchPlot();
  });

  plotSelect.addEventListener("change", function () {
    const next = currentPlots.find(function (plot) { return plot.id === plotSelect.value; });
    if (!next || (plotRecord && next.id === plotRecord.id)) return;
    enqueue(function () {
      return flushPlot().then(function () { openRecord(next); });
    }).catch(function (err) {
      fail(err);
      if (plotRecord) plotSelect.value = plotRecord.id;
    });
  });
  document.getElementById("projects-back").addEventListener("click", function () {
    enqueue(function () {
      return flushPlot().then(function () {
        if (placing) cancelPlace();
        closeNameForm();
        showHome();
      });
    }).catch(fail);
  });
  document.getElementById("home-new").addEventListener("click", function () {
    homeForm.hidden = false;
    homeForm.elements.title.focus();
  });
  document.getElementById("home-cancel").addEventListener("click", function () {
    homeForm.hidden = true;
    homeForm.reset();
  });
  homeForm.addEventListener("submit", function (e) {
    e.preventDefault();
    const title = String(homeForm.elements.title.value || "").trim();
    if (!title) return;
    homeForm.hidden = true;
    homeForm.reset();
    enqueue(function () { return addProject(title); }).catch(fail);
  });
  homeList.addEventListener("click", function (e) {
    const button = e.target.closest("[data-project]");
    if (!button) return;
    const project = projects.find(function (item) { return item.id === button.dataset.project; });
    if (!project) return;
    enqueue(function () { return openProject(project); }).catch(fail);
  });
  document.getElementById("plot-new").addEventListener("click", function () { askName("plot"); });
  document.getElementById("project-rename").addEventListener("click", function () {
    if (currentProject) askName("rename-project");
  });
  document.getElementById("plot-rename").addEventListener("click", function () {
    if (plotRecord) askName("rename-plot");
  });
  document.getElementById("project-delete").addEventListener("click", function () {
    enqueue(deleteProject).catch(fail);
  });
  document.getElementById("plot-delete").addEventListener("click", function () {
    enqueue(deletePlot).catch(fail);
  });
  document.getElementById("name-cancel").addEventListener("click", closeNameForm);
  nameForm.addEventListener("submit", function (e) {
    e.preventDefault();
    const title = String(nameForm.elements.title.value || "").trim();
    const mode = naming;
    if (!title || !mode) return;
    closeNameForm();
    const task = mode === "project" ? function () { return addProject(title); }
      : mode === "plot" ? function () { return addPlot(title); }
      : mode === "rename-project" ? function () { return renameProject(title); }
      : function () { return renamePlot(title); };
    enqueue(task).catch(fail);
  });

  modelFilter.addEventListener("input", renderModels);
  libraryFilter.addEventListener("input", renderLibrary);
  document.getElementById("model-add").addEventListener("click", function () {
    modelForm.hidden = !modelForm.hidden;
    if (!modelForm.hidden) modelForm.elements.name.focus();
  });
  modelForm.addEventListener("submit", function (e) {
    e.preventDefault();
    const name = String(modelForm.elements.name.value || "").trim();
    const category = String(modelForm.elements.category.value || "fixture");
    const file = modelForm.elements.file.files && modelForm.elements.file.files[0];
    if (!name) {
      showError("Нужно название модели.");
      return;
    }
    if (!ModelMesh.CATEGORIES[category]) {
      showError("Неизвестная категория модели.");
      return;
    }
    if (!file) {
      showError("Нужен файл GLB.");
      return;
    }
    if (file.size > 30 * 1024 * 1024) {
      showError("Файл больше 30 МБ.");
      return;
    }
    showError("");
    file.arrayBuffer().then(function (buffer) {
      const mesh = ModelMesh.fromGlb(buffer);
      return PlotDb.addModel({
        name: name,
        category: category,
        size: mesh.size,
        fileName: file.name,
      }, mesh).then(function (record) {
        engine.uploadModel(record.id, mesh);
        modelRecords.push(record);
        modelForm.reset();
        modelForm.hidden = true;
        renderModels();
        showError("");
        beginPlace(modelType(record));
      });
    }).catch(fail);
  });
  modelsEl.addEventListener("click", function (e) {
    const remove = e.target.closest("[data-model-remove]");
    if (remove) {
      const model = modelRecords.find(function (item) { return item.id === remove.dataset.modelRemove; });
      if (!model) return;
      if (!window.confirm("Убрать «" + model.name + "» из библиотеки моделей?")) return;
      enqueue(function () { return forgetModel(model.id); }).catch(fail);
      return;
    }
    const button = e.target.closest("[data-model]");
    if (!button) return;
    const model = modelRecords.find(function (item) { return item.id === button.dataset.model; });
    if (model) beginPlace(modelType(model));
  });

  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState === "hidden") flushPlot().catch(fail);
  });
  window.addEventListener("beforeunload", function () { flushPlot(); });

  renderLibrary();
  updateHint();
  boot();
})();
