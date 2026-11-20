const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");

// Exercise the plain browser script without starting the app or fetching data.
const source = fs
  .readFileSync(path.join(__dirname, "../app.js"), "utf8")
  .replace(/\nbindEvents\(\);\ninit\(\);\s*$/, "");
function loadApp() {
  const elements = new Map();
  const getElement = (id) => {
    if (!elements.has(id))
      elements.set(id, {
        innerHTML: "",
        textContent: "",
        value: "",
        dataset: {},
        attributes: {},
        events: {},
        open: true,
        classList: {
          values: new Map(),
          toggle(name, enabled) {
            this.values.set(name, enabled);
          },
        },
        addEventListener(name, handler) {
          this.events[name] = handler;
        },
        close() {
          this.open = false;
          this.events.close?.();
        },
        setAttribute(name, value) {
          this.attributes[name] = value;
        },
        getBoundingClientRect() {
          return { left: 0, top: 0, right: 850, bottom: 600, width: 850 };
        },
        focus() {},
        querySelector() {
          return getElement("cursor-child");
        },
      });
    return elements.get(id);
  };
  const context = vm.createContext({
    document: {
      getElementById: getElement,
      querySelector: () => ({ value: "" }),
    },
    window: {
      events: {},
      addEventListener(name, handler) { this.events[name] = handler; },
    },
    location: { hash: "#catalogue", pathname: "/", search: "" },
    history: {
      replaceState(_state, _title, url) {
        context.location.hash = url.slice(url.indexOf("#"));
      },
    },
    console,
  });
  getElement("sort").value = "km-asc";
  vm.runInContext(source, context);
  return { context, getElement };
}
const filters = {
  sport: "",
  relief: "",
  wind: "",
  minKm: "",
  maxKm: "",
  minGain: "",
  maxGain: "",
};
const routes = [
  { id: "road", sport: "route", km: 80, gain: 700, relief: "rolling" },
  { id: "gravel", sport: "gravel", km: 40, gain: 200, relief: "flat" },
  { id: "missing", sport: "route", km: 60, gain: null, relief: null },
  { id: "missing2", sport: "route", km: 70, gain: null, relief: null },
];
test("combined filters, inclusive limits and no mutation of the catalogue", () => {
  const { context } = loadApp();
  const result = context.selectRoutes(
    routes,
    { ...filters, sport: "route", relief: "rolling", minKm: "80", maxGain: "700" },
    "km-asc",
  );
  assert.deepEqual(
    Array.from(result, (route) => route.id),
    ["road"],
  );
  assert.equal(routes[0].id, "road");
});

test("relief options and card badges share a pictogram for each available category", () => {
  const { context } = loadApp();
  const options = context.reliefOptions(routes);
  assert.match(options, /name="relief" value="flat"/);
  assert.match(options, /name="relief" value="rolling"/);
  assert(!options.includes('value="mountainous"'));
  assert.match(context.reliefOptions([{ relief: "mountainous" }]), /Montagneux/);
  const route = {
    ...routes[0],
    name: "Essai",
    file: "data/gpx/essai.gpx",
    segments: [[[44, 0], [45, 1]]],
  };
  const card = context.renderCard(route);
  assert.match(card, /class="preview-badges"/);
  for (const [sport, label] of [["route", "Route"], ["gravel", "Gravel"], ["vtt", "VTT"]]) {
    const markup = context.renderCard({ ...route, sport });
    assert(markup.includes(`class="badge activity-badge">${label}</span>`));
  }
  assert(card.includes(context.reliefMarkup("rolling")));
  assert(options.includes(context.reliefMarkup("rolling")));
  assert(!context.renderCard({ ...route, relief: null }).includes("relief-badge"));
});
test("missing elevation stays last in both sort directions and is excluded by a limit", () => {
  const { context } = loadApp();
  for (const order of ["asc", "desc"]) {
    const result = context.selectRoutes(routes, filters, `gain-${order}`);
    assert.deepEqual(
      Array.from(result.slice(-2), (route) => route.id),
      ["missing", "missing2"],
    );
  }
  assert.equal(
    context.selectRoutes(routes, { ...filters, minGain: "0" }, "km-asc").length,
    2,
  );
});
test("profile interpolation respects altitude gaps and track segment boundaries", () => {
  const { context } = loadApp();
  const point = context.pointAtDistance(
    [
      [0, 10, 44, 0, 0],
      [2, 30, 46, 2, 0],
    ],
    1,
  );
  assert.deepEqual(Array.from(point), [1, 20, 45, 1, 0]);
  assert.equal(
    context.pointAtDistance(
      [
        [0, null, 44, 0, 0],
        [2, 30, 46, 2, 0],
      ],
      1,
    )[1],
    null,
  );
  assert.equal(
    context.pointAtDistance(
      [
        [0, 10, 44, 0, 0],
        [2, 30, 46, 2, 1],
      ],
      1,
    )[4],
    1,
  );
});
test("climbs are default and profile pills expose local slopes and surfaces", () => {
  const { context, getElement } = loadApp();
  context.renderProfile({
    sport: "route",
    detailLoaded: true,
    slopeBins: [[5, 5.1, 6, 0], [5.1, 5.2, 8, 0]],
    climbs: [[5, 6, 5, "3", 0]],
    profile: [
      [0, 10, 44, 0, 0],
      [10, 30, 46, 2, 0],
    ],
  });
  const host = getElement("elevationProfile");
  const selectMode = (mode) => getElement("profileMode").onclick({
    target: { closest: () => ({ dataset: { mode } }) },
  });
  assert(!host.innerHTML.includes('class="surface-legend"'));
  assert.match(host.innerHTML, /data-mode="climbs" aria-pressed="true"/);
  assert.match(host.innerHTML, /class="profile-climb-band"[^>]*fill="#EBD038"/);
  selectMode("slopes");
  assert.match(host.innerHTML, /data-mode="slopes" aria-pressed="true"/);
  assert.match(host.innerHTML, /class="profile-slope"[^>]*fill="#EBD038"/);
  assert.match(host.innerHTML, /class="profile-slope"[^>]*fill="#EB793F"/);
  assert.match(host.innerHTML, /6 à &lt;8 %/);
  const chart = getElement("profileChart");
  chart.onpointermove({ clientX: 445 });
  assert.match(chart.attributes["aria-valuetext"], /km 5–5,1.*6 %/);
  assert.equal(getElement("profileBin").attributes.visibility, "visible");
  chart.onpointerleave({ pointerType: "touch" });
  assert.equal(getElement("profileBin").attributes.visibility, "visible");
  chart.onkeydown({ key: "ArrowRight", preventDefault() {} });
  assert.match(chart.attributes["aria-valuetext"], /km 5,1–5,2.*8 %/);
  chart.onpointerleave({ pointerType: "mouse" });
  assert.equal(getElement("profileBin").attributes.visibility, "hidden");
  chart.onkeydown({ key: "End", preventDefault() {} });
  assert.equal(chart.attributes["aria-valuenow"], "10.0");
  assert.equal(getElement("profileBin").attributes.visibility, "hidden");
  selectMode("climbs");
  assert.match(host.innerHTML, /class="profile-climb-band"[^>]*fill="#EBD038"/);
  assert.match(host.innerHTML, /Catégorie 3 \(1\)/);
  chart.onpointermove({ clientX: 445 });
  assert.match(chart.attributes["aria-valuetext"], /km 5–5,1.*6 %.*Catégorie 3/);
  selectMode("surfaces");
  assert(host.innerHTML.includes('class="surface-legend"'));
  assert(host.innerHTML.includes("Non renseigné"));
  assert(!host.innerHTML.includes('class="profile-climb"'));
  assert(!host.innerHTML.includes('class="profile-slope"'));
});

test("the map bearing rotates clockwise and weak routes show only the label", () => {
  const { context, getElement } = loadApp();
  context.renderOutboundIndicator([-0.7, 0.7]);
  assert.match(getElement("outboundDirection").innerHTML, /rotate\(135 12 12\).*Aller sud-est/);
  context.renderOutboundIndicator([0.1, 0]);
  assert.equal(getElement("outboundDirection").innerHTML, "Direction variable");
  context.renderOutboundIndicator(null);
  assert.equal(getElement("outboundDirection").innerHTML, "Direction indisponible");
});

test("slope colors use fixed boundaries and never merge across a gap or a GPX segment", () => {
  const { context } = loadApp();
  assert.equal(context.slopeColor(12), "#822C5F");
  assert.equal(context.slopeColor(10), "#D4353D");
  assert.equal(context.slopeColor(8), "#EB793F");
  assert.equal(context.slopeColor(6), "#EBD038");
  assert.equal(context.slopeColor(4), "#5CC17C");
  assert.equal(context.slopeColor(2), "#21C7E8");
  assert.equal(context.slopeColor(1.99), undefined);
  const spans = context.slopeSpans([
    [0, 0.1, 2, 0], [0.1, 0.2, 3, 0], [0.2, 0.3, -2, 0],
    [0.3, 0.4, 2, 0], [0.4, 0.5, 3, 0], [0.5, 0.6, 2, 1],
    [0.7, 0.8, 2, 1],
  ]);
  assert.deepEqual(Array.from(spans, ({ startKm, endKm, segment }) => [startKm, endKm, segment]),
    [[0, 0.2, 0], [0.3, 0.5, 0], [0.5, 0.6, 1], [0.7, 0.8, 1]]);
});

test("west wind sorts by projection, then distance, with weak or absent caps last", () => {
  const { context } = loadApp();
  const routes = [
    { id: "unknown", km: 5, outbound: null },
    { id: "weak", km: 8, outbound: [0, -0.1] },
    { id: "late", km: 30, outbound: [0, -1] },
    { id: "east", km: 10, outbound: [0, 1] },
    { id: "west", km: 20, outbound: [0, -1] },
    { id: "northwest", km: 10, outbound: [0.6, -0.7] },
  ];
  const result = context.selectRoutes(routes, { ...filters, wind: "O" }, "wind-desc");
  assert.deepEqual(Array.from(result, ({ id }) => id),
    ["west", "late", "northwest", "east", "unknown", "weak"]);
  assert.equal(context.outboundLabel([0, -1]), "Ouest");
  assert.equal(context.outboundLabel([0.01, -0.1]), "Direction variable");
  assert.equal(context.outboundLabel(null), "Direction indisponible");
});

test("wind direction activates the sort, and clearing or resetting restores distance", () => {
  const { context, getElement } = loadApp();
  context.bindEvents();
  const form = getElement("filters");
  const wind = getElement("wind");
  const sort = getElement("sort");
  wind.value = "O";
  form.events.input({ target: wind });
  assert.equal(sort.value, "wind-desc");
  assert.equal(getElement("windSort").disabled, false);
  wind.value = "";
  form.events.input({ target: wind });
  assert.equal(sort.value, "km-asc");
  assert.equal(getElement("windSort").disabled, true);
  wind.value = "N";
  form.events.input({ target: wind });
  form.reset = () => { wind.value = ""; };
  getElement("reset").onclick();
  assert.equal(wind.value, "");
  assert.equal(sort.value, "km-asc");
  assert.equal(getElement("windSort").disabled, true);
});
test("route names are escaped in download and detail links", () => {
  const { context } = loadApp();
  const html = context.renderCard({
    id: "test",
    name: '<img onerror="bad">',
    sport: "route",
    km: 20,
    gain: 30,
    file: "data/gpx/test.gpx",
    segments: [
      [
        [44, 0],
        [45, 1],
      ],
    ],
  });
  assert(!html.includes("<img"));
  assert(html.includes("&lt;img"));
  assert.equal((html.match(/class="gpx-link"/g) || []).length, 1);
});

test("view switch preserves filters and sort and updates accessible state", () => {
  const { context, getElement } = loadApp();
  context.bindEvents();
  getElement("minKm").value = "50";
  getElement("sort").value = "gain-desc";
  getElement("viewList").onclick();
  assert.equal(getElement("grid").hidden, true);
  assert.equal(getElement("viewList").attributes["aria-pressed"], "true");
  getElement("viewGrid").onclick();
  assert.equal(getElement("grid").hidden, false);
  assert.equal(getElement("viewGrid").attributes["aria-pressed"], "true");
  assert.equal(getElement("minKm").value, "50");
  assert.equal(getElement("sort").value, "gain-desc");
});

test("only a click starting and ending outside closes the preview", () => {
  const { context, getElement } = loadApp();
  context.bindEvents();
  const dialog = getElement("detail");
  const outside = { target: dialog, clientX: -10, clientY: 10, button: 0 };
  const inside = { ...outside, clientX: 20 };
  dialog.events.pointerdown(inside);
  dialog.events.click(outside);
  assert.equal(dialog.open, true, "dragging the map outside must not close it");
  dialog.events.pointerdown(outside);
  dialog.events.pointercancel();
  dialog.events.click(outside);
  assert.equal(dialog.open, true);
  dialog.events.pointerdown(outside);
  dialog.events.click(outside);
  assert.equal(dialog.open, false);
});

test("closing restores catalogue URL and keyboard focus", () => {
  const { context, getElement } = loadApp();
  context.bindEvents();
  context.location.hash = "#parcours/test";
  vm.runInContext('lastFocus = byId("routeLink")', context);
  let focused = false;
  getElement("routeLink").focus = () => {
    focused = true;
  };
  getElement("close").onclick();
  assert.equal(context.location.hash, "#catalogue");
  assert.equal(focused, true);
});

test("basemap control applies each available mode", () => {
  const { context, getElement } = loadApp();
  context.bindEvents();
  for (const mode of ["light", "color", "satellite"]) {
    getElement("basemap").value = mode;
    getElement("basemap").events.change();
    assert.equal(getElement("map").dataset.basemap, mode);
  }
});

test("late detail response does not replace a different or closed preview", async () => {
  const { context, getElement } = loadApp();
  const route = { id: "old", detail: "old.json" };
  context.fetch = async () => ({
    ok: true,
    json: async () => ({ points: [] }),
  });
  getElement("elevationProfile").innerHTML = "current profile";
  context.location.hash = "#parcours/new";
  await context.loadRouteDetail(route);
  assert.equal(getElement("elevationProfile").innerHTML, "current profile");
  context.location.hash = "#parcours/old";
  getElement("detail").open = false;
  await context.loadRouteDetail(route);
  assert.equal(getElement("elevationProfile").innerHTML, "current profile");
});

test('table column sort toggles and stays synchronized with the sort menu', () => {
  const { context, getElement } = loadApp();
  context.bindEvents();
  getElement('sortKm').onclick();
  assert.equal(getElement('sort').value, 'km-desc');
  assert.equal(getElement('kmHeading').attributes['aria-sort'], 'descending');
  getElement('sortGain').onclick();
  assert.equal(getElement('sort').value, 'gain-asc');
  assert.equal(getElement('gainHeading').attributes['aria-sort'], 'ascending');
  assert.equal(getElement('kmHeading').attributes['aria-sort'], 'none');
  getElement('sort').value = 'gain-desc';
  getElement('sort').events.change();
  assert.equal(getElement('gainOrder').textContent, '↓');
});


test("GPX downloads point to the published file in every view", () => {
  const { context, getElement } = loadApp();
  const route = {
    id: "download-test", name: "Original", sport: "gravel",
    km: 41.2, gain: 203.8, file: "data/gpx/09012026_gravel_41km_204d.gpx",
    segments: [[[44, 0], [45, 1]]], profile: [],
  };
  for (const html of [context.renderCard(route), context.renderListRow(route)]) {
    assert(/\sdownload\s/.test(html));
    assert(html.includes(`href="${route.file}"`));
  }
  context.testRoute = route;
  vm.runInContext("routes = [testRoute]; renderProfile = () => {}; loadRouteDetail = () => {};", context);
  context.location.hash = "#parcours/download-test";
  context.openRoute();
  assert.equal(getElement("download").href, route.file);
  assert.equal(getElement("detailSport").textContent, "Gravel");
});
