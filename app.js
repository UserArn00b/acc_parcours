const byId = (id) => document.getElementById(id);
let routes = [],
  map,
  layer,
  lastFocus,
  detailBase;
let previewMaps = [];
let previewObserver;
let catalogueView = "grid";
const numberFormat = new Intl.NumberFormat("fr-FR");
const formatNumber = (n) => numberFormat.format(n);
const escapeHtml = (s) =>
  String(s).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const sports = { route: "Route", gravel: "Gravel", vtt: "VTT" };
const sportColors = { route: "#102E59", gravel: "#594910", vtt: "#594910" };
const routeColor = (r) => sportColors[r.sport] || sportColors.route;
const reliefTypes = {
  flat: ["Plat", '<path d="M4 12h16"/>'],
  rolling: ["Vallonné", '<path d="M2 13c3 0 3-5 6-5s3 5 6 5 3-5 8-5M2 18c3 0 3-3 6-3s3 3 6 3 3-3 8-3"/>'],
  mountainous: ["Montagneux", '<path d="m3 19 7-14 5 10 2-4 4 8H3Zm5-10 2 2 2-2"/>'],
};
const directions = ["N", "NE", "E", "SE", "S", "SO", "O", "NO"];
const directionLabels = ["Nord", "Nord-est", "Est", "Sud-est", "Sud", "Sud-ouest", "Ouest", "Nord-ouest"];
const minimumOutboundStrength = 0.25;

/** Return the outbound bearing in degrees clockwise from north, or null for a weak cap. */
function outboundBearing(outbound) {
  if (!outbound) return null;
  const [north, east] = outbound;
  if (Math.hypot(north, east) < minimumOutboundStrength) return null;
  return Math.atan2(east, north) * 180 / Math.PI;
}

/** Return the nearest compass direction, or an explicit label for a weak or absent cap. */
function outboundLabel(outbound) {
  const bearing = outboundBearing(outbound);
  if (bearing === null) return outbound ? "Direction variable" : "Direction indisponible";
  const sector = Math.round(bearing / 45);
  return directionLabels[(sector + directions.length) % directions.length];
}

/** Project the normalized outbound vector toward the wind's origin; weak caps sort last. */
function windScore(outbound, wind) {
  if (!outbound || Math.hypot(...outbound) < minimumOutboundStrength)
    return -Infinity;
  const angle = directions.indexOf(wind) * Math.PI / 4;
  return Math.round((outbound[0] * Math.cos(angle) + outbound[1] * Math.sin(angle)) * 1e9);
}
// Chevrons follow the GPX point order on the first segment.
function directionArrow(r, fraction = 0.25) {
  const pts = r.segments[0];
  if (pts.length < 2) return null;
  const project = (p) => [
    (p[1] * Math.PI) / 180,
    Math.log(Math.tan(Math.PI / 4 + (p[0] * Math.PI) / 360)),
  ];
  const distances = [0];
  for (let i = 1; i < pts.length; i++) {
    const a = project(pts[i - 1]),
      b = project(pts[i]);
    distances.push(distances[i - 1] + Math.hypot(b[0] - a[0], b[1] - a[1]));
  }
  const target = distances.at(-1) * fraction;
  let i = distances.findIndex((d) => d >= target);
  i = Math.max(1, i);
  const a = project(pts[i - 1]),
    b = project(pts[i]);
  const angle = (Math.atan2(b[0] - a[0], b[1] - a[1]) * 180) / Math.PI;
  return { point: pts[i], angle };
}
function arrowMarker(r) {
  const markers = [0.18, 0.48, 0.78]
    .map((f) => {
      const a = directionArrow(r, f);
      if (!a) return null;
      return L.marker(a.point, {
        interactive: false,
        keyboard: false,
        icon: L.divIcon({
          className: "route-arrow",
          iconSize: [16, 16],
          iconAnchor: [8, 8],
          html: `<svg viewBox="0 0 16 16" style="transform:rotate(${a.angle}deg)" aria-hidden="true"><path d="M4 10 L8 6 L12 10" fill="none" stroke="white" stroke-width="4.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M4 10 L8 6 L12 10" fill="none" stroke="${routeColor(r)}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
        }),
      });
    })
    .filter(Boolean);
  return markers.length ? L.featureGroup(markers) : null;
}
function preview(r) {
  const pts = r.segments.flat(),
    xs = pts.map((p) => p[1] * Math.cos((pts[0][0] * Math.PI) / 180)),
    ys = pts.map((p) => -p[0]);
  const x = Math.min(...xs),
    y = Math.min(...ys),
    w = Math.max(...xs) - x,
    h = Math.max(...ys) - y,
    scale = Math.min(310 / (w || 1), 155 / (h || 1));
  const xy = (p) => [
    (p[1] * Math.cos((pts[0][0] * Math.PI) / 180) - x) * scale +
      (350 - w * scale) / 2,
    (-p[0] - y) * scale + (190 - h * scale) / 2,
  ];
  return `<svg viewBox="0 0 350 190" role="img" aria-label="Aperçu du tracé"><g fill="none" stroke="${routeColor(r)}" stroke-width="2.5" stroke-linejoin="round">${r.segments
    .map(
      (s) =>
        `<polyline points="${s
          .map((p) =>
            xy(p)
              .map((n) => n.toFixed(1))
              .join(","),
          )
          .join(" ")}"/>`,
    )
    .join(
      "",
    )}</g><circle cx="${xy(pts[0])[0]}" cy="${xy(pts[0])[1]}" r="5" fill="#bad3de" stroke="${routeColor(r)}" stroke-width="2"/></svg>`;
}
function mountPreviews() {
  if (!window.L) return;
  previewObserver = new IntersectionObserver(
    (entries) =>
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        previewObserver.unobserve(entry.target);
        const r = routes.find((r) => r.id === entry.target.dataset.route);
        const el = document.createElement("div");
        el.className = "tile-map";
        entry.target.prepend(el);
        const m = L.map(el, {
          zoomControl: false,
          attributionControl: true,
          dragging: false,
          scrollWheelZoom: false,
          doubleClickZoom: false,
          touchZoom: false,
          boxZoom: false,
          keyboard: false,
        });
        m.attributionControl.setPrefix(false);
        L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
          maxZoom: 19,
          attribution:
            '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
          updateWhenIdle: true,
          keepBuffer: 0,
        }).addTo(m);
        const line = L.polyline(r.segments, {
          color: routeColor(r),
          weight: 3,
          opacity: 1,
        }).addTo(m);
        L.circleMarker(r.segments[0][0], {
          radius: 4,
          color: routeColor(r),
          fillColor: routeColor(r),
          fillOpacity: 1,
          weight: 2,
        }).addTo(m);
        const arrow = arrowMarker(r);
        if (arrow) arrow.addTo(m);
        m.fitBounds(line.getBounds(), { padding: [22, 22] });
        previewMaps.push(m);
        entry.target.classList.add("has-map");
      }),
    { rootMargin: "0px" },
  );
  document
    .querySelectorAll(".preview")
    .forEach((el) => previewObserver.observe(el));
}
// Catalogue
/** Filter routes without changing the source catalogue, then apply the selected sort. */
function selectRoutes(items, filters, sort) {
  const limits = [
    ["minKm", "km", true],
    ["maxKm", "km", false],
    ["minGain", "gain", true],
    ["maxGain", "gain", false],
  ];
  const filtered = items.filter((route) => {
    if (filters.sport && route.sport !== filters.sport) return false;
    if (filters.relief && route.relief !== filters.relief) return false;
    return limits.every(([field, key, minimum]) => {
      if (filters[field] === "") return true;
      if (route[key] === null) return false;
      return minimum
        ? route[key] >= Number(filters[field])
        : route[key] <= Number(filters[field]);
    });
  });
  const [key, order] = sort.split("-");
  if (key === "wind" && directions.includes(filters.wind)) {
    const scores = new Map(filtered.map((route) => [route, windScore(route.outbound, filters.wind)]));
    return filtered.sort((a, b) => scores.get(b) - scores.get(a) || a.km - b.km);
  }
  return filtered.sort((a, b) => {
    if (a[key] === null && b[key] === null) return 0;
    if (a[key] === null) return 1;
    if (b[key] === null) return -1;
    return (a[key] - b[key]) * (order === "asc" ? 1 : -1);
  });
}

const icons = {
  distance:
    '<circle cx="5" cy="6" r="2"/><circle cx="19" cy="18" r="2"/><path d="M7 6h9a4 4 0 0 1 0 8H8a2 2 0 0 0 0 4h9"/>',
  elevation: '<path d="m3 19 8-14 10 14H3Zm5-9 3 3 3-3"/>',
  download: '<path d="M12 3v12m-4-4 4 4 4-4M5 16v5h14v-5"/>',
};
/** Render a decorative catalogue pictogram beside its visible label. */
function icon(name) {
  return `<svg class="${name}-icon" viewBox="0 0 24 24" aria-hidden="true">${icons[name]}</svg>`;
}
function downloadLink(route) {
  return `<a class="gpx-link" data-tooltip="Télécharger le GPX" download
    href="${escapeHtml(encodeURI(route.file))}" aria-label="Télécharger ${escapeHtml(route.name)} en GPX">
    ${icon("download")}
  </a>`;
}

/** Build the same accessible relief label and pictogram for filters and map previews. */
function reliefMarkup(key) {
  const relief = Object.hasOwn(reliefTypes, key) ? reliefTypes[key] : null;
  if (!relief) return "";
  const [label, path] = relief;
  return `<svg class="relief-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">${path}</svg>${label}`;
}

/** Render native relief radios for the relief categories present in the catalogue. */
function reliefOptions(items) {
  const available = new Set(items.map((route) => route.relief));
  return Object.keys(reliefTypes).filter((key) => available.has(key)).map((key) =>
    `<label><input type="radio" name="relief" value="${key}"><span data-relief="${key}">${reliefMarkup(key)}</span></label>`,
  ).join("");
}

/** Render a catalogue card with its metrics, optional relief and GPX link. */
function renderCard(route) {
  const name = escapeHtml(route.name);
  const gain = route.gain === null ? "—" : formatNumber(route.gain);
  const relief = reliefMarkup(route.relief);
  return `
    <article class="card" data-sport="${route.sport}">
      <div class="preview" data-route="${route.id}">
        ${preview(route)}
        <div class="preview-badges">
          <span class="badge activity-badge">${sports[route.sport]}</span>
          ${relief ? `<span class="badge relief-badge" data-relief="${route.relief}">${relief}</span>` : ""}
        </div>
        <a class="map-open" href="#parcours/${route.id}" aria-label="Ouvrir la carte de ${name}"></a>
      </div>
      ${downloadLink(route)}
      <div class="card-summary">
        <a class="card-link" href="#parcours/${route.id}" aria-label="Voir ${name}">
          <span class="metrics">
            <span class="distance" aria-label="Distance : ${formatNumber(route.km)} kilomètres">
              ${icon("distance")}<strong>${formatNumber(route.km)}</strong><small>km</small>
            </span>
            <span class="elevation" aria-label="Dénivelé positif : ${route.gain === null ? "indisponible" : gain + " mètres"}">
              ${icon("elevation")}<strong>${gain}</strong><small>m</small>
            </span>
          </span>
        </a>
      </div>
    </article>`;
}
/** Render a list entry with the same relief and metrics as the card. */
function renderListRow(route) {
  const name = escapeHtml(route.name);
  const url = `#parcours/${route.id}`;
  const relief = reliefTypes[route.relief]?.[0];
  return `<tr data-sport="${route.sport}" data-route="${route.id}">
    <td class="trace-column"><a class="table-preview" href="${url}" aria-label="Ouvrir la carte de ${name}">${preview(route)}</a></td>
    <td><a class="table-sport" href="${url}" aria-label="Voir ${name}">${sports[route.sport]}</a>${relief ? `<span class="route-relief">${relief}</span>` : ""}</td>
    <td class="number-column">${formatNumber(route.km)}<small>km</small></td>
    <td class="number-column">${route.gain === null ? "—" : formatNumber(route.gain)}<small>m</small></td>
    <td class="download-column">${downloadLink(route)}</td>
  </tr>`;
}

function updateSortHeadings() {
  const [key, order] = byId("sort").value.split("-");
  for (const field of ["km", "gain"]) {
    const active = key === field;
    byId(`${field}Heading`).setAttribute(
      "aria-sort",
      active ? (order === "asc" ? "ascending" : "descending") : "none",
    );
    byId(`${field}Order`).textContent = active
      ? order === "asc"
        ? "↑"
        : "↓"
      : "↕";
  }
}

function sortByColumn(field) {
  byId("sort").value =
    `${field}-${byId("sort").value === `${field}-asc` ? "desc" : "asc"}`;
  render();
}

/** Render the catalogue in the current view using the selected filters and sort. */
function render() {
  previewObserver?.disconnect();
  previewMaps.forEach((previewMap) => previewMap.remove());
  previewMaps = [];
  const filters = {
    sport: document.querySelector('input[name="sport"]:checked').value,
    relief: document.querySelector('input[name="relief"]:checked').value,
  };
  for (const field of ["wind", "minKm", "maxKm", "minGain", "maxGain"]) {
    filters[field] = byId(field).value;
  }
  const visible = selectRoutes(routes, filters, byId("sort").value);
  byId("count").textContent =
    `${visible.length} parcours${visible.length !== routes.length ? " sur " + routes.length : ""}`;
  byId("empty").hidden = visible.length > 0;
  byId("grid").hidden = catalogueView === "list";
  byId("routeTable").hidden = catalogueView !== "list" || visible.length === 0;
  byId("grid").innerHTML =
    catalogueView === "grid" ? visible.map(renderCard).join("") : "";
  byId("routeRows").innerHTML =
    catalogueView === "list" ? visible.map(renderListRow).join("") : "";
  updateSortHeadings();
  if (catalogueView === "grid") mountPreviews();
}

function setCatalogueView(view) {
  catalogueView = view === "list" ? "list" : "grid";
  byId("viewGrid").setAttribute(
    "aria-pressed",
    String(catalogueView === "grid"),
  );
  byId("viewList").setAttribute(
    "aria-pressed",
    String(catalogueView === "list"),
  );
  render();
}

// Detailed map
/** Show the outbound bearing on the map, suppressing the arrow when no direction is reliable. */
function renderOutboundIndicator(outbound) {
  const bearing = outboundBearing(outbound);
  const label = outboundLabel(outbound);
  byId("outboundDirection").innerHTML = bearing === null ? label :
    `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="m12 3 6 16-6-4-6 4 6-16Z" transform="rotate(${bearing} 12 12)"/></svg>Aller ${label.toLowerCase()}`;
}

/** Open the route identified by the URL with the climb mode and a lightweight preview. */
function openRoute() {
  const id = location.hash.startsWith("#parcours/")
      ? location.hash.slice(10)
      : null,
    r = routes.find((r) => r.id === id || r.aliases?.includes(id));
  if (!r) {
    if (byId("detail").open) byId("detail").close();
    return;
  }
  if (r.id !== id) history.replaceState(null, "", `#parcours/${r.id}`);
  lastFocus = document.activeElement;
  profileMode = defaultProfileMode;
  byId("basemap").value = "color";
  setDetailBasemap();
  byId("detailTitle").textContent = "Le parcours";
  byId("detail").dataset.sport = r.sport;
  byId("detailSport").textContent = sports[r.sport];
  const relief = reliefMarkup(r.relief);
  byId("detailRelief").innerHTML = relief;
  byId("detailRelief").hidden = !relief;
  renderOutboundIndicator(r.outbound);
  byId("detailStats").innerHTML = `
    <span class="detail-metric" aria-label="Distance">
      ${icon("distance")}<span>${formatNumber(r.km)}<small>km</small></span>
    </span>
    <span class="detail-metric" aria-label="Dénivelé positif">
      ${icon("elevation")}<span>${r.gain === null ? "—" : formatNumber(r.gain)}<small>m</small></span>
    </span>`;
  byId("download").href = r.file;
  byId("download").innerHTML = `${icon("download")}GPX`;
  renderProfile(r);
  if (!byId("detail").open) byId("detail").showModal();
  if (!window.L) {
    byId("map").textContent =
      "La carte nécessite une connexion Internet. Le téléchargement GPX reste disponible.";
    loadRouteDetail(r);
    return;
  }
  if (!map) {
    map = L.map("map", { zoomControl: false });
    L.control.zoom({ position: "bottomright" }).addTo(map);
    map.on("mousemove", followMapPointer);
    map.on("click", followMapPointer);
    map.on("mouseout", hideProfileCursor);
    setDetailBasemap();
    new ResizeObserver(() => map.invalidateSize({ pan: false })).observe(
      byId("map"),
    );
  }
  if (layer) map.removeLayer(layer);
  traceHalo = L.polyline(r.segments, {
    color: "#fff", weight: 7, opacity: 0.85, interactive: false,
  });
  traceLine = L.polyline(r.segments, { color: sportColors.route, weight: 4 });
  climbLayer = L.layerGroup();
  layer = L.featureGroup(
    [
      traceHalo,
      traceLine,
      climbLayer,
      L.circleMarker(r.segments[0][0], {
        radius: 7,
        color: routeColor(r),
        fillColor: routeColor(r),
        fillOpacity: 1,
      }).bindPopup("Départ"),
      arrowMarker(r),
    ].filter(Boolean),
  ).addTo(map);
  requestAnimationFrame(() => {
    if (!isRouteOpen(r)) return;
    map.invalidateSize();
    map.fitBounds(traceLine.getBounds(), { padding: [28, 28], animate: false });
    renderProfile(r);
    loadRouteDetail(r);
  });
}
function setDetailBasemap() {
  const mode = byId("basemap").value;
  byId("map").dataset.basemap = mode;
  if (!map) return;
  const satellite = mode === "satellite";
  if (detailBase && detailBase.isSatellite === satellite) return;
  if (detailBase) map.removeLayer(detailBase);
  detailBase = L.tileLayer(
    satellite
      ? "https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
      : "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
    {
      maxZoom: 19,
      attribution: satellite
        ? 'Source: <a href="https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer">Esri</a>, Vantor, Earthstar Geographics, GIS User Community'
        : '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    },
  );
  detailBase.isSatellite = satellite;
  detailBase.addTo(map);
}

const surfaceTypes = {
  paved: ["Revêtu", "#71849a"],
  gravel: ["Gravier / compacté", "#bd944b"],
  earth: ["Terre / herbe", "#78854c"],
  sand: ["Sable", "#dfbe77"],
  rock: ["Roche", "#88796d"],
  cobbles: ["Pavés", "#9b8aa3"],
  unpaved: ["Non revêtu", "#ad8061"],
  other: ["Autre", "#b6888f"],
  unknown: ["Non renseigné", "#d8dde3"],
};
const climbTypes = {
  uncategorized: ["Montée sans catégorie", "#21C7E8"],
  "4": ["Catégorie 4", "#5CC17C"],
  "3": ["Catégorie 3", "#EBD038"],
  "2": ["Catégorie 2", "#EB793F"],
  "1": ["Catégorie 1", "#D4353D"],
  hc: ["Hors catégorie", "#822C5F"],
};
const climbOrder = ["uncategorized", "4", "3", "2", "1", "hc"];
const climbOutline = "#263446";
const slopeStyles = [
  { minimum: 12, label: "12 % et plus", color: climbTypes.hc[1] },
  { minimum: 10, label: "10 à <12 %", color: climbTypes["1"][1] },
  { minimum: 8, label: "8 à <10 %", color: climbTypes["2"][1] },
  { minimum: 6, label: "6 à <8 %", color: climbTypes["3"][1] },
  { minimum: 4, label: "4 à <6 %", color: climbTypes["4"][1] },
  { minimum: 2, label: "2 à <4 %", color: climbTypes.uncategorized[1] },
];
let activeProfile = null,
  hoverMarker = null,
  hoverSpan = null,
  traceHalo,
  traceLine,
  climbLayer;
const profileModes = { slopes: "Pentes", climbs: "Montées", surfaces: "Revêtements" };
const defaultProfileMode = "climbs";
let profileMode = defaultProfileMode;
const detailCache = new Map();

/** Return the accent color for an uphill grade in percent, if it reaches 2%. */
function slopeColor(grade) {
  return slopeStyles.find(({ minimum }) => grade >= minimum)?.color;
}

/** Merge adjacent 100 m bins with the same color inside each continuous GPX portion. */
function slopeSpans(bins) {
  const spans = [];
  for (const [startKm, endKm, grade, segment] of bins || []) {
    const color = slopeColor(grade);
    if (!color) continue;
    const previous = spans.at(-1);
    if (previous?.color === color && previous.segment === segment && previous.endKm === startKm)
      previous.endKm = endKm;
    else
      spans.push({ startKm, endKm, color, segment });
  }
  return spans;
}

/** Check whether an asynchronous update still belongs to the visible route. */
function isRouteOpen(route) {
  return location.hash === `#parcours/${route.id}` && byId("detail").open;
}

/** Group ordered profile points by GPX segment for drawing without artificial joins. */
function trackSegments(points) {
  const segments = new Map();
  for (const point of points) {
    if (!segments.has(point[4])) segments.set(point[4], []);
    segments.get(point[4]).push(point);
  }
  return segments;
}

/** Extract a distance interval in km, interpolating both ends within its GPX segment. */
function intervalPoints(points, startKm, endKm) {
  if (!points?.length) return [];
  const first = pointIndexAtDistance(points, startKm);
  const last = pointIndexAtDistance(points, endKm);
  return [
    pointAtDistance(points, startKm),
    ...points.slice(points[first][0] === startKm ? first + 1 : first, last),
    pointAtDistance(points, endKm),
  ];
}

/** Draw slope spans as colored multi-polylines above a shared contrast outline. */
function renderMapSlopes(spans, segments) {
  const pathsByColor = new Map();
  for (const { startKm, endKm, color, segment } of spans) {
    const coordinates = intervalPoints(segments.get(segment), startKm, endKm)
      .map((point) => [point[2], point[3]]);
    if (coordinates.length < 2) continue;
    if (!pathsByColor.has(color)) pathsByColor.set(color, []);
    pathsByColor.get(color).push(coordinates);
  }
  if (!pathsByColor.size) return;
  L.polyline(Array.from(pathsByColor.values()).flat(), {
    color: climbOutline, weight: 8, lineCap: "butt", interactive: false,
  }).addTo(climbLayer);
  for (const { color } of slopeStyles.slice().reverse()) {
    const paths = pathsByColor.get(color);
    if (paths) L.polyline(paths, { color, weight: 5, lineCap: "butt", interactive: false }).addTo(climbLayer);
  }
}

/** Update the map annotations for the active detail mode without moving the map. */
function renderMapAnnotations(route, segments, spans) {
  if (!climbLayer) return;
  climbLayer.clearLayers();
  const annotated = profileMode === "slopes" ? spans.length > 0
    : profileMode === "climbs" && route.climbs?.length > 0;
  traceHalo.setStyle({ weight: annotated ? 5 : 7 });
  traceLine.setStyle({
    color: profileMode === "surfaces" ? routeColor(route) : sportColors.route,
    weight: annotated ? 3 : 4,
  });
  if (profileMode === "slopes") return renderMapSlopes(spans, segments);
  if (profileMode !== "climbs") return;
  for (const [startKm, endKm, , category, segment] of route.climbs || []) {
    const coordinates = intervalPoints(segments.get(segment), startKm, endKm)
      .map((point) => [point[2], point[3]]);
    if (coordinates.length < 2) continue;
    const color = climbTypes[category][1];
    L.polyline(coordinates, { color: climbOutline, weight: 8, interactive: false }).addTo(climbLayer);
    L.polyline(coordinates, { color, weight: 5, interactive: false }).addTo(climbLayer);
    L.circleMarker(coordinates.at(-1), {
      radius: 4.5, color: climbOutline, weight: 2, fillColor: color,
      fillOpacity: 1, interactive: false,
    }).addTo(climbLayer);
  }
}

/** Load the full profile and annotations, keeping the lightweight preview on failure. */
async function loadRouteDetail(r) {
  try {
    if (!detailCache.has(r.id)) {
      const response = await fetch(r.detail, { cache: "no-cache" });
      if (!response.ok) throw Error("detail");
      detailCache.set(r.id, await response.json());
    }
    if (!isRouteOpen(r)) return;
    const data = detailCache.get(r.id);
    const segments = trackSegments(data.points);
    if (traceLine) {
      const coordinates = Array.from(segments.values(), (points) =>
        points.map((point) => [point[2], point[3]]),
      );
      traceHalo.setLatLngs(coordinates);
      traceLine.setLatLngs(coordinates);
    }
    const detail = {
      ...r,
      profile: data.points,
      slopeBins: data.slopeBins,
      climbs: data.climbs,
      surfaces: data.surfaces,
      surfaceDate: data.surfaceDate,
      detailLoaded: true,
    };
    renderRouteAnnotations(detail);
  } catch (error) {
    if (isRouteOpen(r))
      renderProfile({ ...r, detailFailed: true });
  }
}

/** Clear the transient selection and its linked map and profile markers. */
function hideProfileCursor() {
  if (hoverMarker && map) {
    map.removeLayer(hoverMarker);
    hoverMarker = null;
  }
  if (hoverSpan && map) {
    map.removeLayer(hoverSpan);
    hoverSpan = null;
  }
  if (activeProfile) activeProfile.selectedBin = null;
  byId("profileBin")?.setAttribute("visibility", "hidden");
  const cursor = byId("profileCursor");
  if (cursor) cursor.setAttribute("visibility", "hidden");
  const info = byId("profileReadout");
  if (info) info.textContent = profilePrompt();
}

/** Explain how to select a position with the device's primary pointing input. */
function profilePrompt() {
  return window.matchMedia?.("(hover: none)").matches
    ? "Touchez la carte ou le profil"
    : "Survolez la trace ou le profil";
}
/** Find the first profile point at or after a distance in km, clamped to the last index. */
function pointIndexAtDistance(points, distance) {
  let lo = 0,
    hi = points.length - 1;
  while (lo < hi) {
    const m = Math.floor((lo + hi) / 2);
    if (points[m][0] < distance) lo = m + 1;
    else hi = m;
  }
  return lo;
}

/** Interpolate a [km, altitude m, lat, lon, segment] point without crossing gaps. */
function pointAtDistance(points, distance) {
  const index = pointIndexAtDistance(points, distance);
  const b = points[index],
    a = points[Math.max(0, index - 1)];
  if (distance === b[0] || a[4] !== b[4] || b[0] === a[0]) return b;
  const t = Math.max(0, Math.min(1, (distance - a[0]) / (b[0] - a[0])));
  return [
    a[0] + t * (b[0] - a[0]),
    Number.isFinite(a[1]) && Number.isFinite(b[1])
      ? a[1] + t * (b[1] - a[1])
      : null,
    a[2] + t * (b[2] - a[2]),
    a[3] + t * (b[3] - a[3]),
    a[4],
  ];
}

/** Find a distance interval in one GPX segment, preferring the next bin at an interior boundary. */
function intervalAtDistance(intervals, point, segmentIndex) {
  const distanceKm = Math.round(point[0] * 1e6) / 1e6;
  let match;
  for (const interval of intervals || []) {
    if (interval[0] > distanceKm) break;
    if (interval[segmentIndex] === point[4] && distanceKm <= interval[1]) match = interval;
  }
  return match;
}

/** Highlight a slope bin with a shaded profile band and a matching map line. */
function showSlopeBin(bin, color) {
  const { x, segments, selectedBin } = activeProfile;
  if (selectedBin === bin) return;
  activeProfile.selectedBin = bin;
  if (hoverSpan && map) {
    map.removeLayer(hoverSpan);
    hoverSpan = null;
  }
  const band = byId("profileBin");
  band.setAttribute("visibility", bin ? "visible" : "hidden");
  if (!bin) return;
  const [startKm, endKm, , segment] = bin;
  band.setAttribute("x", x(startKm));
  band.setAttribute("width", x(endKm) - x(startKm));
  if (!map) return;
  const coordinates = intervalPoints(segments.get(segment), startKm, endKm)
    .map((point) => [point[2], point[3]]);
  if (coordinates.length < 2) return;
  hoverSpan = L.layerGroup([
    L.polyline(coordinates, { color: climbOutline, weight: 12, interactive: false }),
    L.polyline(coordinates, { color: "#fff", weight: 8, interactive: false }),
    L.polyline(coordinates, { color, weight: 4, interactive: false }),
  ]).addTo(map);
}

/** Update the readout and map marker for one selected route position. */
function showProfilePoint(p) {
  if (!activeProfile || !p) return;
  if (p[0] < 0 || p[0] > activeProfile.total) {
    hideProfileCursor();
    return;
  }
  const { r, x, y } = activeProfile;
  activeProfile.lastDistance = p[0];
  const cursor = byId("profileCursor");
  cursor.setAttribute("visibility", "visible");
  const cx = x(p[0]),
    cy = Number.isFinite(p[1]) ? y(p[1]) : 94;
  cursor.querySelector("line").setAttribute("x1", cx);
  cursor.querySelector("line").setAttribute("x2", cx);
  const dot = cursor.querySelector("circle");
  dot.setAttribute("cx", cx);
  dot.setAttribute("cy", cy);
  dot.setAttribute("visibility", Number.isFinite(p[1]) ? "visible" : "hidden");
  const altitude = Number.isFinite(p[1]) ? `${formatNumber(Math.round(p[1]))} m` : "Altitude inconnue";
  const position = `${formatNumber(Math.round(p[0] * 10) / 10)} km · ${altitude}`;
  let readout = position;
  if (profileMode === "surfaces") {
    const kind = (r.surfaces || []).find((s) => p[0] >= s[0] && p[0] <= s[1])?.[2];
    readout += ` · ${(surfaceTypes[kind] || surfaceTypes.unknown)[0]}`;
  } else {
    const bin = intervalAtDistance(r.slopeBins, p, 3);
    const climb = profileMode === "climbs" && bin && intervalAtDistance(r.climbs, p, 4);
    const color = profileMode === "slopes" ? slopeColor(bin?.[2]) : climb && climbTypes[climb[3]][1];
    showSlopeBin(bin, color || sportColors.route);
    if (bin) {
      const [startKm, endKm, grade] = bin;
      readout = `km ${formatNumber(startKm)}–${formatNumber(endKm)} · ${altitude} · ${formatNumber(Math.round(grade * 10) / 10)} %`;
      if (climb) {
        const [start, end, average, category] = climb;
        const lengthM = (end - start) * 1000;
        const gainM = Math.round(lengthM * average / 100);
        readout += ` · ${climbTypes[category][0]}, ${formatNumber(Math.round(lengthM))} m à ${formatNumber(Math.round(average * 10) / 10)} % (+${formatNumber(gainM)} m)`;
      }
    } else {
      readout += " · Pente indisponible";
    }
  }
  byId("profileReadout").textContent = readout;
  const chart = byId("profileChart");
  chart.setAttribute("aria-valuenow", p[0].toFixed(1));
  chart.setAttribute("aria-valuetext", byId("profileReadout").textContent);
  if (map && Number.isFinite(p[2]) && Number.isFinite(p[3])) {
    if (!hoverMarker)
      hoverMarker = L.circleMarker([p[2], p[3]], {
        radius: 6,
        color: "#fff",
        weight: 3,
        fillColor: routeColor(r),
        fillOpacity: 1,
        interactive: false,
      }).addTo(map);
    else hoverMarker.setLatLng([p[2], p[3]]);
    hoverMarker.bringToFront();
  }
}
/** Select the closest position on the map, retaining its GPX segment at joins. */
function followMapPointer(event) {
  if (!activeProfile || !byId("detail").open) return;
  const { r } = activeProfile,
    points = r.profile,
    target = map.latLngToLayerPoint(event.latlng);
  let best = null;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1],
      b = points[i];
    if (a[4] !== b[4] || !Number.isFinite(a[2]) || !Number.isFinite(b[2]))
      continue;
    const pa = map.latLngToLayerPoint([a[2], a[3]]),
      pb = map.latLngToLayerPoint([b[2], b[3]]),
      dx = pb.x - pa.x,
      dy = pb.y - pa.y;
    const t = Math.max(
      0,
      Math.min(
        1,
        ((target.x - pa.x) * dx + (target.y - pa.y) * dy) /
          (dx * dx + dy * dy || 1),
      ),
    );
    const distance = Math.hypot(
        target.x - pa.x - t * dx,
        target.y - pa.y - t * dy,
      ),
      km = a[0] + t * (b[0] - a[0]);
    // At overlapping outbound/return sections retain the closest position in route order.
    if (
      distance <= 18 &&
      (!best ||
        distance < best.distance - 1 ||
        (Math.abs(distance - best.distance) <= 1 &&
          Math.abs(km - (activeProfile.lastDistance || 0)) <
            Math.abs(best.km - (activeProfile.lastDistance || 0))))
    )
      best = { distance, km, segment: a[4] };
  }
  if (best)
    showProfilePoint(pointAtDistance(activeProfile.segments.get(best.segment), best.km));
  else hideProfileCursor();
}
/** Render surface bands at the given SVG ordinate, plus the legend and attribution. */
function surfaceMarkup(route, total, x, bandY = 105) {
  const spans = route.surfaces || [[0, total, "unknown"]];
  const band = spans
    .map(
      ([a, b, c]) =>
        `<rect x="${x(a)}" y="${bandY}" width="${Math.max(0, x(b) - x(a))}" height="9" fill="${(surfaceTypes[c] || surfaceTypes.unknown)[1]}"/>`,
    )
    .join("");
  const totals = {};
  spans.forEach(([a, b, c]) => (totals[c] = (totals[c] || 0) + b - a));
  const legend = Object.entries(surfaceTypes)
    .filter(([c]) => totals[c] > 0)
    .map(
      ([c, [label, color]]) =>
        `<span><i style="background:${color}"></i>${label} ${totals[c] / total < 0.005 ? "&lt;1" : Math.round((totals[c] / total) * 100)} %</span>`,
    )
    .join("");
  const note = route.surfaceDate
    ? 'Revêtements estimés · <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">© OpenStreetMap</a>'
    : route.detailFailed
      ? "Données détaillées non chargées. Rouvrez le parcours pour réessayer."
      : route.detailLoaded
        ? "Données de revêtement pas encore importées."
        : "Chargement des revêtements…";
  return {
    band,
    footer: `<div class="surface-legend">${legend}</div><div class="surface-note">${note}</div>`,
  };
}

/** Draw climbs on the elevation line and in a distance band; count them by category. */
function climbMarkup(route, segments, profilePath, x, bandY) {
  const counts = new Map();
  const paths = (route.climbs || []).map(([startKm, endKm, , category, segment]) => {
    counts.set(category, (counts.get(category) || 0) + 1);
    const d = profilePath(intervalPoints(segments.get(segment), startKm, endKm));
    const color = climbTypes[category][1];
    return `<rect class="profile-climb-band" x="${x(startKm)}" y="${bandY}" width="${x(endKm) - x(startKm)}" height="6" fill="${color}" stroke="${climbOutline}" stroke-width="1"/>
      <path class="profile-climb" d="${d}" stroke="${climbOutline}" stroke-width="6"/>
      <path class="profile-climb" d="${d}" stroke="${color}" stroke-width="4"/>`;
  }).join("");
  const entries = [["Hors montée", sportColors.route], ...climbOrder
    .filter((category) => counts.has(category))
    .map((category) => [...climbTypes[category], counts.get(category)])];
  const legend = entries.map(([label, color, count]) =>
    `<span><i style="background:${color};border:1px solid ${climbOutline}"></i>${label}${count ? ` (${count})` : ""}</span>`,
  ).join("");
  let status = "";
  if (route.detailFailed)
    status = "Données détaillées non chargées. Rouvrez le parcours pour réessayer.";
  else if (!route.detailLoaded) status = "Chargement des montées…";
  else if (!route.slopeBins?.length) status = "Données d’altitude insuffisantes pour calculer les pentes.";
  else if (!counts.size) status = "Aucune montée de 500 m ou plus à 3 % de moyenne.";
  else if (counts.size === 1 && counts.has("uncategorized"))
    status = "La catégorie 4 commence au-delà de 80 m de gain d’altitude net par montée.";
  return {
    paths,
    footer: `<div class="climb-legend">${legend}</div>${status ? `<div class="surface-note" role="status">${status}</div>` : ""}`,
  };
}

/** Fill each uphill portion of the profile to the baseline with its local grade color. */
function slopeMarkup(route, spans, segments, profilePath, x, base) {
  const paths = spans.map(({ startKm, endKm, color, segment }) => {
    const line = profilePath(intervalPoints(segments.get(segment), startKm, endKm));
    if (!line) return "";
    const area = `${line} L${x(endKm)},${base} L${x(startKm)},${base} Z`;
    return `<path class="profile-slope" d="${area}" fill="${color}" fill-opacity=".82"/>
      <path class="profile-slope-line" d="${line}" stroke="${color}" stroke-width="2.5"/>`;
  }).join("");
  const entries = [
    { color: sportColors.route, label: "<2 % et descentes" },
    ...slopeStyles.slice().reverse(),
  ];
  const legend = entries.map(({ color, label }) =>
    `<span><i style="background:${color};border:1px solid ${climbOutline}"></i>${escapeHtml(label)}</span>`,
  ).join("");
  const status = route.detailFailed
    ? "Données détaillées non chargées. Rouvrez le parcours pour réessayer."
    : !route.detailLoaded
      ? "Chargement des pentes…"
      : !route.slopeBins?.length ? "Données d’altitude insuffisantes pour calculer les pentes." : "";
  return {
    paths,
    footer: `<div class="slope-legend" aria-label="Pente moyenne par tronçon de 100 m">${legend}</div>${status ? `<div class="surface-note" role="status">${status}</div>` : ""}`,
  };
}

/** Reuse the same computed slope spans for both views of the current route. */
function renderRouteAnnotations(route) {
  const { segments, spans } = renderProfile(route);
  renderMapAnnotations(route, segments, spans);
}

/** Render the profile and its synchronized controls for the active display mode. */
function renderProfile(r) {
  hideProfileCursor();
  activeProfile = null;
  const host = byId("elevationProfile"),
    points = r.profile || [],
    valid = points.filter((p) => Number.isFinite(p[1])),
    showSurfaces = profileMode === "surfaces",
    showSlopes = profileMode === "slopes",
    segments = trackSegments(points),
    spans = showSlopes ? slopeSpans(r.slopeBins) : [];
  const focusedControl = document.activeElement?.id;
  const W = Math.min(850, host.clientWidth || 850);
  const left = 48, right = 16;
  const compact = W < 345;
  const modeButtons = Object.entries(profileModes).map(([mode, label]) =>
    `<button type="button" id="profileMode-${mode}" data-mode="${mode}" aria-pressed="${mode === profileMode}">${label}</button>`,
  ).join("");
  const controls = `<div class="profile-label">
    <div class="profile-tools">
      <h3>Profil altimétrique</h3>
      <div class="profile-pills" id="profileMode" role="group" aria-label="Affichage du profil">
        ${modeButtons}
      </div>
    </div>
    <span id="profileReadout">${profilePrompt()}</span>
  </div>`;
  if (valid.length < 2) {
    const total = points.at(-1)?.[0] || r.km || 0;
    const surfaces = showSurfaces && total > 0
      ? surfaceMarkup(r, total, (d) => left + (d / total) * (W - left - right))
      : null;
    host.innerHTML = `${controls}<p class="profile-unavailable">Profil altimétrique indisponible pour ce GPX.</p>
      ${surfaces ? `<svg class="surface-only" viewBox="0 100 ${W} 18" preserveAspectRatio="none" aria-hidden="true">${surfaces.band}</svg>${surfaces.footer}` : ""}`;
    bindProfileMode(r);
    if (focusedControl?.startsWith("profileMode-")) byId(focusedControl).focus({ preventScroll: true });
    return { segments, spans };
  }
  const H = showSurfaces ? (compact ? 108 : 140) : (compact ? 96 : 112),
    top = 10,
    base = H - (showSurfaces ? 46 : 26),
    surfaceBandY = base + 11,
    total = Math.max(points.at(-1)[0], 0.01);
  let minimum = Infinity,
    maximum = -Infinity;
  for (const point of valid) {
    minimum = Math.min(minimum, point[1]);
    maximum = Math.max(maximum, point[1]);
  }
  const lo = Math.floor(minimum / 10) * 10;
  const hi = Math.max(lo + 10, Math.ceil(maximum / 10) * 10);
  const x = (d) => left + (d / total) * (W - left - right),
    y = (e) => base - ((e - lo) / (hi - lo)) * (base - top);
  const lines = [];
  let current = [];
  points.forEach((p) => {
    if (current.length && current.at(-1)[4] !== p[4]) {
      lines.push(current);
      current = [];
    }
    if (Number.isFinite(p[1])) current.push(p);
    else if (current.length) {
      lines.push(current);
      current = [];
    }
  });
  if (current.length) lines.push(current);
  const grid = [lo, (lo + hi) / 2, hi]
    .map(
      (e) =>
        `<line x1="${left}" y1="${y(e)}" x2="${W - right}" y2="${y(e)}" stroke="#dfe5e9"/><text x="${left - 8}" y="${y(e) + 3}" text-anchor="end">${Math.round(e)} m</text>`,
    )
    .join("");
  const tickPositions = compact ? [0, 0.5, 1] : [0, 0.25, 0.5, 0.75, 1];
  const ticks = tickPositions
    .map(
      (f) =>
        `<text x="${x(total * f)}" y="${H - 6}" text-anchor="${f === 1 ? "end" : f === 0 ? "start" : "middle"}">${formatNumber(Math.round(total * f * 10) / 10)} km</text>`,
    )
    .join("");
  /** Convert known-altitude profile points to an SVG path. */
  const profilePath = (ps) => ps.map((p, i) =>
    `${i ? "L" : "M"}${x(p[0]).toFixed(2)},${y(p[1]).toFixed(2)}`,
  ).join("");
  const color = showSurfaces ? routeColor(r) : sportColors.route;
  const fillOpacity = showSlopes ? 0.28 : 0.12;
  const paths = lines
    .map((ps) => {
      const d = profilePath(ps);
      return `<path d="${d} L${x(ps.at(-1)[0])},${base} L${x(ps[0][0])},${base} Z" fill="${color}" opacity="${fillOpacity}"/><path d="${d}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round"/>`;
    })
    .join("");
  const surfaces = showSurfaces ? surfaceMarkup(r, total, x, surfaceBandY) : null;
  const overlay = showSlopes ? slopeMarkup(r, spans, segments, profilePath, x, base)
    : showSurfaces ? null : climbMarkup(r, segments, profilePath, x, base + 3);
  host.innerHTML = `
    ${controls}
    <svg id="profileChart" height="${H}" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none"
         role="slider" tabindex="0" aria-label="Position sur le parcours : utilisez les flèches gauche et droite"
         aria-valuemin="0" aria-valuemax="${total.toFixed(2)}" aria-valuenow="0">
      ${grid}${paths}${overlay?.paths || ""}${surfaces?.band || ""}
      <rect id="profileBin" y="${top}" height="${base - top}" fill="${sportColors.route}" opacity=".24" visibility="hidden" pointer-events="none"/>
      ${ticks}
      <g id="profileCursor" visibility="hidden" pointer-events="none">
        <line y1="8" y2="${showSurfaces ? surfaceBandY + 12 : base}" stroke="${routeColor(r)}" stroke-width="1" stroke-dasharray="3 3"/>
        <circle r="4" fill="${routeColor(r)}" stroke="white" stroke-width="2"/>
      </g>
    </svg>
    ${surfaces?.footer || overlay?.footer || ""}`;
  bindProfileMode(r);
  activeProfile = { r, x, y, total, segments, selectedBin: null, lastDistance: 0, width: W };
  const svg = byId("profileChart");
  /** Move the cursor to a distance in km within the route. */
  const showDistance = (d) => {
    const p = pointAtDistance(points, Math.max(0, Math.min(total, d)));
    showProfilePoint(p);
  };
  svg.onpointermove = (e) => {
    const rect = svg.getBoundingClientRect();
    showDistance(
      ((((e.clientX - rect.left) / rect.width) * W - left) /
        (W - left - right)) *
        total,
    );
  };
  svg.onpointerleave = (event) => {
    if (event.pointerType !== "touch") hideProfileCursor();
  };
  svg.onpointercancel = hideProfileCursor;
  svg.onpointerdown = svg.onpointermove;
  svg.onblur = hideProfileCursor;
  svg.onkeydown = (e) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) return;
    e.preventDefault();
    const step = e.key === "ArrowLeft" ? -1 : 1;
    const bins = showSurfaces ? [] : r.slopeBins || [];
    const index = bins.indexOf(activeProfile.selectedBin);
    const nextBin = index >= 0 ? bins[index + step] : null;
    const keyboardDistance = nextBin
      ? (nextBin[0] + nextBin[1]) / 2
      : activeProfile.lastDistance + step * (showSurfaces ? total / 200 : 0.1);
    showDistance(
      e.key === "Home"
        ? 0
        : e.key === "End"
          ? total
          : keyboardDistance,
    );
  };
  if (focusedControl?.startsWith("profileMode-") || focusedControl === "profileChart")
    byId(focusedControl).focus({ preventScroll: true });
  return { segments, spans };
}

/** Switch the map and profile to the same display mode. */
function bindProfileMode(route) {
  byId("profileMode").onclick = (event) => {
    const mode = event.target.closest("button[data-mode]")?.dataset.mode;
    if (!mode || mode === profileMode) return;
    profileMode = mode;
    renderRouteAnnotations(route);
  };
}

// Close only a deliberate click on the backdrop, not a drag out of the map.
let backdropPress = false;
function outsideDetail(event) {
  const bounds = byId("detail").getBoundingClientRect();
  return (
    event.target === byId("detail") &&
    (event.clientX < bounds.left ||
      event.clientX > bounds.right ||
      event.clientY < bounds.top ||
      event.clientY > bounds.bottom)
  );
}

/** Bind catalogue controls and the detail dialog lifecycle once. */
function bindEvents() {
  byId("sortKm").onclick = () => sortByColumn("km");
  byId("sortGain").onclick = () => sortByColumn("gain");
  byId("routeRows").addEventListener("click", (event) => {
    if (
      event.target.closest("a") ||
      event.ctrlKey ||
      event.metaKey ||
      event.shiftKey ||
      event.altKey
    )
      return;
    const row = event.target.closest("tr[data-route]");
    if (row) location.hash = `#parcours/${row.dataset.route}`;
  });
  byId("viewGrid").onclick = () => setCatalogueView("grid");
  byId("viewList").onclick = () => setCatalogueView("list");
  byId("filters").addEventListener("submit", (e) => e.preventDefault());
  byId("filters").addEventListener("input", (event) => {
    if (event.target === byId("wind")) {
      const hasWind = Boolean(event.target.value);
      byId("windSort").disabled = !hasWind;
      if (hasWind) byId("sort").value = "wind-desc";
      else if (byId("sort").value === "wind-desc") byId("sort").value = "km-asc";
    }
    render();
  });
  byId("sort").addEventListener("change", render);
  byId("reset").onclick = () => {
    byId("filters").reset();
    byId("windSort").disabled = true;
    byId("sort").value = "km-asc";
    render();
  };
  byId("close").onclick = () => byId("detail").close();
  byId("detail").addEventListener("close", () => {
    hideProfileCursor();
    activeProfile = null;
    if (location.hash.startsWith("#parcours/"))
      history.replaceState(
        null,
        "",
        location.pathname + location.search + "#catalogue",
      );
    lastFocus?.focus();
  });
  window.addEventListener("hashchange", openRoute);
  window.addEventListener("resize", () => {
    if (activeProfile && activeProfile.width !== Math.min(850, byId("elevationProfile").clientWidth))
      renderProfile(activeProfile.r);
  });

  byId("basemap").addEventListener("change", setDetailBasemap);
  byId("detail").addEventListener("pointerdown", (event) => {
    backdropPress = event.button === 0 && outsideDetail(event);
  });
  byId("detail").addEventListener("pointercancel", () => {
    backdropPress = false;
  });
  byId("detail").addEventListener("click", (event) => {
    if (backdropPress && outsideDetail(event)) byId("detail").close();
    backdropPress = false;
  });
}

/** Load the site catalogue and only offer relief values represented in it. */
async function init() {
  try {
    const response = await fetch("data/routes.json", { cache: "no-cache" });
    if (!response.ok) throw new Error("Catalogue indisponible");
    routes = await response.json();
    byId("total").textContent = routes.length;
    byId("reliefOptions").insertAdjacentHTML("beforeend", reliefOptions(routes));
    render();
    openRoute();
  } catch (error) {
    console.error(error);
    byId("count").textContent =
      "Impossible de charger les parcours. Rechargez la page depuis le site ou un serveur local.";
  }
}

bindEvents();
init();
