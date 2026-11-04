(function () {
  const venueName = document.getElementById("venue-name");
  const venueNote = document.getElementById("venue-note");
  const inspector = document.getElementById("inspector");
  const layersEl = document.getElementById("layers");
  const listEl = document.getElementById("list");
  const countEl = document.getElementById("count");
  const errorEl = document.getElementById("error");
  const canvas = document.getElementById("view");
  const fileInput = document.getElementById("file");
  const mvrInput = document.getElementById("mvr-file");

  const engine = new PlotEngine(canvas);
  const viewButtons = Array.from(document.querySelectorAll("[data-view]"));

  function showError(message) {
    errorEl.hidden = !message;
    errorEl.textContent = message || "";
  }

  function fmt(n) {
    return (Math.round(n * 100) / 100).toFixed(2);
  }

  function row(label, value) {
    if (value == null || value === "") return "";
    return "<div class=\"field\"><dt>" + label + "</dt><dd>" + value + "</dd></div>";
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function renderInspector(obj) {
    if (!obj) {
      inspector.innerHTML = "<p class=\"empty\">Щёлкните прибор на схеме или в списке — здесь будут данные монтажа.</p>";
      return;
    }
    const p = obj.position;
    const s = obj.size;
    const r = obj.rotation;
    const patch = obj.universe != null && obj.address != null
      ? "U" + obj.universe + " · " + obj.address
      : "";
    inspector.innerHTML = [
      "<p class=\"kind\">" + escapeHtml(PlotFormat.KINDS[obj.kind] || obj.kind) + "</p>",
      "<h3>" + escapeHtml(obj.name) + "</h3>",
      "<dl>",
      row("Тип", escapeHtml(obj.fixtureType)),
      row("Мод", escapeHtml(obj.mode)),
      row("Universe", obj.universe == null ? "" : escapeHtml(obj.universe)),
      row("Адрес", obj.address == null ? "" : escapeHtml(obj.address)),
      row("Патч", patch),
      row("Линия", escapeHtml(obj.circuit)),
      row("Подвес", escapeHtml(obj.hang)),
      row("Слой", escapeHtml(obj.layer)),
      row("X / Y / Z", fmt(p[0]) + " / " + fmt(p[1]) + " / " + fmt(p[2]) + " м"),
      row("Габарит", fmt(s[0]) + " × " + fmt(s[1]) + " × " + fmt(s[2]) + " м"),
      row("Поворот", r && (r[0] || r[1] || r[2]) ? fmt(r[0]) + "° · " + fmt(r[1]) + "° · " + fmt(r[2]) + "°" : ""),
      row("Примечание", escapeHtml(obj.notes)),
      "</dl>",
    ].join("");
    markList(obj.id);
  }

  function markList(id) {
    listEl.querySelectorAll(".item").forEach(function (button) {
      button.classList.toggle("is-on", button.dataset.id === id);
    });
  }

  function renderLayers() {
    layersEl.innerHTML = engine.layers().map(function (layer) {
      return "<label class=\"check\"><input type=\"checkbox\" data-layer=\"" + escapeHtml(layer) + "\" checked> " + escapeHtml(layer) + "</label>";
    }).join("");
  }

  function renderList() {
    const groups = new Map();
    engine.plot.objects.forEach(function (obj) {
      if (obj.kind === "structure") return;
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
    const listed = engine.plot.objects.filter(function (obj) { return obj.kind !== "structure"; }).length;
    countEl.textContent = String(listed);
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

  function usePlot(data) {
    const plot = PlotFormat.parsePlot(data);
    engine.load(plot);
    renderPlot();
    showError("");
  }

  engine.onSelect = renderInspector;
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
  document.getElementById("open-file").addEventListener("click", function () {
    fileInput.click();
  });
  document.getElementById("open-mvr").addEventListener("click", function () {
    mvrInput.click();
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

  const stage = document.querySelector(".stage");
  stage.addEventListener("dragover", function (e) {
    e.preventDefault();
  });
  stage.addEventListener("drop", function (e) {
    e.preventDefault();
    const file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (file) readIncoming(file);
  });

  function readIncoming(file) {
    const name = file.name.toLowerCase();
    if (name.endsWith(".mvr")) readMvr(file);
    else readJson(file);
  }

  function readJson(file) {
    const reader = new FileReader();
    reader.onload = function () {
      try {
        usePlot(JSON.parse(String(reader.result)));
      } catch (err) {
        showError(err instanceof SyntaxError ? "Файл не похож на JSON." : err.message);
      }
    };
    reader.readAsText(file);
  }

  function readMvr(file) {
    const reader = new FileReader();
    reader.onload = function () {
      venueNote.textContent = "Читаю MVR…";
      showError("");
      MvrImport.parse(reader.result, file.name).then(function (plot) {
        usePlot(plot);
      }).catch(function (err) {
        showError(err && err.message ? err.message : "Не удалось прочитать MVR.");
      });
    };
    reader.readAsArrayBuffer(file);
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

  window.addEventListener("keydown", function (e) {
    if (e.target && (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA")) return;
    if (e.key === "1") engine.setView("orbit");
    if (e.key === "2") engine.setView("top");
    if (e.key === "3") engine.setView("front");
    if (e.key === "4") engine.setView("side");
    if (e.key === "f" || e.key === "F" || e.key === "а" || e.key === "А") engine.frame();
    if (e.key === "Escape") engine.select(null);
  });

  try {
    usePlot(demoPlot);
  } catch (err) {
    showError(err.message);
  }
})();
