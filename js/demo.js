// Sample rig so the engine opens on a readable plot.
// Dimensions are illustrative — this is not a survey of the room.
var demoPlot = (function () {
  const objects = [];

  function add(obj) {
    objects.push(obj);
  }

  function alongX(spec) {
    const count = spec.count;
    for (let i = 0; i < count; i++) {
      const t = count === 1 ? 0 : i / (count - 1);
      const x = spec.x0 + (spec.x1 - spec.x0) * t;
      const n = String(i + 1).padStart(2, "0");
      objects.push({
        id: spec.id + "-" + (i + 1),
        name: spec.name + " " + n,
        kind: "fixture",
        layer: "Свет",
        position: [Math.round(x * 100) / 100, spec.y, spec.z],
        size: spec.size,
        rotation: spec.rotation || [0, 0, 0],
        fixtureType: spec.fixtureType,
        mode: spec.mode,
        universe: spec.universe,
        address: spec.address + i * spec.footprint,
        circuit: spec.circuit,
        hang: spec.hang,
        notes: spec.notes || "",
      });
    }
  }

  add({
    id: "stage",
    name: "Планшет",
    kind: "structure",
    layer: "Зал",
    position: [0, 0.3, 4],
    size: [12, 0.6, 8],
    hang: "",
    notes: "Ноль: центр авансцены, уровень пола зала.",
  });
  add({
    id: "truss-foh",
    name: "Ферма FOH",
    kind: "structure",
    layer: "Фермы",
    position: [0, 7.4, -4],
    size: [14, 0.35, 0.35],
    notes: "Трим 7.4 м до оси.",
  });
  add({
    id: "truss-lx",
    name: "Ферма портал",
    kind: "structure",
    layer: "Фермы",
    position: [0, 7.4, 2.2],
    size: [12, 0.35, 0.35],
    notes: "Трим 7.4 м до оси.",
  });
  add({
    id: "truss-us",
    name: "Ферма задник",
    kind: "structure",
    layer: "Фермы",
    position: [0, 7.4, 7.2],
    size: [12, 0.35, 0.35],
    notes: "Трим 7.4 м до оси.",
  });
  add({
    id: "boom-sl",
    name: "Боковая стойка SL",
    kind: "structure",
    layer: "Фермы",
    position: [-6.8, 3.25, 4],
    size: [0.3, 6.5, 0.3],
  });
  add({
    id: "boom-sr",
    name: "Боковая стойка SR",
    kind: "structure",
    layer: "Фермы",
    position: [6.8, 3.25, 4],
    size: [0.3, 6.5, 0.3],
  });

  alongX({
    id: "spot",
    name: "SPOT",
    count: 8,
    x0: -5.25,
    x1: 5.25,
    y: 6.95,
    z: -4,
    size: [0.36, 0.5, 0.36],
    fixtureType: "Голова spot",
    mode: "16 ch",
    universe: 1,
    address: 1,
    footprint: 16,
    circuit: "Non-dim A",
    hang: "FOH",
    notes: "Clamp + страховка.",
  });

  alongX({
    id: "prof",
    name: "PROF",
    count: 6,
    x0: -4.2,
    x1: 4.2,
    y: 7.05,
    z: 2.2,
    size: [0.28, 0.32, 0.7],
    rotation: [50, 0, 0],
    fixtureType: "Профильный",
    mode: "1 ch",
    universe: 2,
    address: 1,
    footprint: 1,
    circuit: "Dim",
    hang: "Портал",
  });

  alongX({
    id: "par",
    name: "PAR",
    count: 6,
    x0: -4.2,
    x1: 4.2,
    y: 7.05,
    z: 7.2,
    size: [0.28, 0.32, 0.28],
    rotation: [45, 180, 0],
    fixtureType: "PAR",
    mode: "4 ch",
    universe: 3,
    address: 1,
    footprint: 4,
    circuit: "Non-dim B",
    hang: "Задник",
  });

  alongX({
    id: "bar",
    name: "BAR",
    count: 4,
    x0: -3.3,
    x1: 3.3,
    y: 0.74,
    z: 6.5,
    size: [1.15, 0.16, 0.22],
    rotation: [70, 0, 0],
    fixtureType: "LED-бар",
    mode: "12 ch",
    universe: 4,
    address: 1,
    footprint: 12,
    circuit: "LED power",
    hang: "Пол",
    notes: "На планшете, перед экраном.",
  });

  // Boom profiles are listed by hand: two heights, aimed into the stage.
  [
    ["L", -6.45, 11],
    ["R", 6.45, 13],
  ].forEach(function (side) {
    [2.4, 4.6].forEach(function (y, index) {
      const letter = side[0];
      objects.push({
        id: "boom-" + letter.toLowerCase() + "-" + (index + 1),
        name: "BOOM " + letter + " 0" + (index + 1),
        kind: "fixture",
        layer: "Свет",
        position: [side[1], y, 4],
        size: [0.28, 0.32, 0.7],
        rotation: [18, letter === "L" ? 90 : -90, 0],
        fixtureType: "Профильный",
        mode: "1 ch",
        universe: 2,
        address: side[2] + index,
        circuit: "Dim",
        hang: letter === "L" ? "Бок SL" : "Бок SR",
        notes: "",
      });
    });
  });

  add({
    id: "screen",
    name: "Экран",
    kind: "equipment",
    layer: "Видео",
    position: [0, 2.3, 7.75],
    size: [6, 3.4, 0.12],
    circuit: "Video power",
    hang: "Задник",
    notes: "Опора на планшет. Нижний край на отметке 0.6 м.",
  });
  add({
    id: "pa-l",
    name: "Портал L",
    kind: "equipment",
    layer: "Звук",
    position: [-5.3, 1.15, 0.45],
    size: [0.55, 1.1, 0.5],
    circuit: "Audio L",
    hang: "Авансцена",
    notes: "Напольная установка.",
  });
  add({
    id: "pa-r",
    name: "Портал R",
    kind: "equipment",
    layer: "Звук",
    position: [5.3, 1.15, 0.45],
    size: [0.55, 1.1, 0.5],
    circuit: "Audio R",
    hang: "Авансцена",
    notes: "Напольная установка.",
  });

  // Conventional dimmer numbers follow the profile address on universe 2.
  objects.forEach(function (obj) {
    if (obj.fixtureType === "Профильный" && obj.circuit === "Dim") {
      obj.circuit = "Dim " + obj.address;
    }
  });

  return {
    venue: {
      name: "Loft Hall",
      note: "Учебная схема для движка. Это не обмер зала.",
    },
    objects: objects,
  };
})();
