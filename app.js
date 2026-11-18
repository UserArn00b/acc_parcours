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
function selectRoutes(items, filters, sort) {
  const limits = [
    ["minKm", "km", true],
    ["maxKm", "km", false],
    ["minGain", "gain", true],
    ["maxGain", "gain", false],
  ];
  const filtered = items.filter((route) => {
    if (filters.sport && route.sport !== filters.sport) return false;
    if (filters.direction && route.direction !== filters.direction)
      return false;
    return limits.every(([field, key, minimum]) => {
      if (filters[field] === "") return true;
      if (route[key] === null) return false;
      return minimum
        ? route[key] >= Number(filters[field])
        : route[key] <= Number(filters[field]);
    });
  });
  const [key, order] = sort.split("-");
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
function icon(name) {
  return `<svg class="${name}-icon" viewBox="0 0 24 24" aria-hidden="true">${icons[name]}</svg>`;
}
function downloadLink(route) {
  return `<a class="gpx-link" data-tooltip="Télécharger le GPX" download
    href="${escapeHtml(encodeURI(route.file))}" aria-label="Télécharger ${escapeHtml(route.name)} en GPX">
    ${icon("download")}
  </a>`;
}

function renderCard(route) {
  const name = escapeHtml(route.name);
  const gain = route.gain === null ? "—" : formatNumber(route.gain);
  return `
    <article class="card" data-sport="${route.sport}">
      <div class="preview" data-route="${route.id}">
        ${preview(route)}
        <span class="badge">${sports[route.sport]}</span>
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
function renderListRow(route) {
  const name = escapeHtml(route.name);
  const url = `#parcours/${route.id}`;
  return `<tr data-sport="${route.sport}" data-route="${route.id}">
    <td class="trace-column"><a class="table-preview" href="${url}" aria-label="Ouvrir la carte de ${name}">${preview(route)}</a></td>
    <td><a class="table-sport" href="${url}" aria-label="Voir ${name}">${sports[route.sport]}</a></td>
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

function render() {
  previewObserver?.disconnect();
  previewMaps.forEach((previewMap) => previewMap.remove());
  previewMaps = [];
  const filters = {
    sport: document.querySelector('input[name="sport"]:checked').value,
  };
  for (const field of ["direction", "minKm", "maxKm", "minGain", "maxGain"]) {
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
  byId("basemap").value = "color";
  setDetailBasemap();
  byId("detailTitle").textContent = "Le parcours";
  byId("detail").dataset.sport = r.sport;
  byId("detailSport").textContent = sports[r.sport];
  byId("detailStats").innerHTML = `
    <span class="detail-metric" aria-label="Distance">
      ${icon("distance")}<span>${formatNumber(r.km)}<small>km</small></span>
    </span>
    <span class="detail-metric" aria-label="Dénivelé positif">
      ${icon("elevation")}<span>${r.gain === null ? "—" : formatNumber(r.gain)}<small>m</small></span>
    </span>
    ${r.direction ? `<span>Aller : ${escapeHtml(r.direction)}</span>` : ""}`;
  byId("download").href = r.file;
  renderProfile(r);
  if (!byId("detail").open) byId("detail").showModal();
  if (!window.L) {
    byId("map").textContent =
      "La carte nécessite une connexion Internet. Le téléchargement GPX reste disponible.";
    loadRouteDetail(r);
    return;
  }
  if (!map) {
    map = L.map("map");
    map.on("mousemove", followMapPointer);
    map.on("mouseout", hideProfileCursor);
    setDetailBasemap();
    new ResizeObserver(() => map.invalidateSize({ pan: false })).observe(
      byId("map"),
    );
  }
  if (layer) map.removeLayer(layer);
  layer = L.featureGroup(
    [
      L.polyline(r.segments, {
        color: "#fff",
        weight: 7,
        opacity: 0.85,
        interactive: false,
      }),
      L.polyline(r.segments, { color: routeColor(r), weight: 4 }),
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
    map.invalidateSize();
    map.fitBounds(layer.getBounds(), { padding: [28, 28], animate: false });
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
let activeProfile = null,
  hoverMarker = null;
let showSurfaces = false;
const detailCache = new Map();
async function loadRouteDetail(r) {
  try {
    if (!detailCache.has(r.id)) {
      const response = await fetch(r.detail, { cache: "no-cache" });
      if (!response.ok) throw Error("detail");
      detailCache.set(r.id, await response.json());
    }
    if (location.hash !== `#parcours/${r.id}` || !byId("detail").open) return;
    const data = detailCache.get(r.id);
    if (layer && window.L) {
      const segments = [];
      for (const p of data.points) {
        if (!segments.length || segments.at(-1).segment !== p[4])
          segments.push({ segment: p[4], points: [] });
        segments.at(-1).points.push([p[2], p[3]]);
      }
      layer.eachLayer((l) => {
        if (l instanceof L.Polyline)
          l.setLatLngs(segments.map((s) => s.points));
      });
    }
    renderProfile({
      ...r,
      profile: data.points,
      surfaces: data.surfaces,
      surfaceDate: data.surfaceDate,
      detailLoaded: true,
    });
  } catch (error) {
    if (location.hash === `#parcours/${r.id}`)
      renderProfile({ ...r, detailFailed: true });
  }
}
function hideProfileCursor() {
  if (hoverMarker && map) {
    map.removeLayer(hoverMarker);
    hoverMarker = null;
  }
  const cursor = byId("profileCursor");
  if (cursor) cursor.setAttribute("visibility", "hidden");
  const info = byId("profileReadout");
  if (info) info.textContent = "Survolez la trace ou le profil";
}
// Profile point: [distanceKm, altitudeM, latitude, longitude, segmentIndex].
function pointAtDistance(points, distance) {
  let lo = 0,
    hi = points.length - 1;
  while (lo < hi) {
    const m = Math.floor((lo + hi) / 2);
    if (points[m][0] < distance) lo = m + 1;
    else hi = m;
  }
  const b = points[lo],
    a = points[Math.max(0, lo - 1)];
  if (a[4] !== b[4] || b[0] === a[0]) return b;
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
  const kind =
    (r.surfaces || []).find((s) => p[0] >= s[0] && p[0] <= s[1])?.[2] ||
    "unknown";
  byId("profileReadout").textContent =
    `${formatNumber(Math.round(p[0] * 10) / 10)} km · ${Number.isFinite(p[1]) ? formatNumber(Math.round(p[1])) + " m" : "Altitude inconnue"}${showSurfaces ? " · " + (surfaceTypes[kind]?.[0] || surfaceTypes.unknown[0]) : ""}`;
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
      best = { distance, km };
  }
  if (best) showProfilePoint(pointAtDistance(points, best.km));
  else hideProfileCursor();
}
function surfaceMarkup(route, total, x) {
  if (!showSurfaces) return { band: "", footer: "" };
  const spans = route.surfaces || [[0, total, "unknown"]];
  const band = spans
    .map(
      ([a, b, c]) =>
        `<rect x="${x(a)}" y="105" width="${Math.max(0, x(b) - x(a))}" height="9" fill="${(surfaceTypes[c] || surfaceTypes.unknown)[1]}"/>`,
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

function renderProfile(r) {
  hideProfileCursor();
  activeProfile = null;
  const host = byId("elevationProfile"),
    points = r.profile || [],
    valid = points.filter((p) => Number.isFinite(p[1]));
  if (valid.length < 2) {
    host.innerHTML =
      '<p class="profile-unavailable">Profil altimétrique indisponible pour ce GPX.</p>';
    return;
  }
  host.classList.toggle("has-surfaces", showSurfaces);
  const W = 850,
    H = showSurfaces ? 140 : 112,
    left = 48,
    right = 16,
    top = 10,
    base = showSurfaces ? 94 : 86,
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
  const ticks = [0, 0.25, 0.5, 0.75, 1]
    .map(
      (f) =>
        `<text x="${x(total * f)}" y="${H - 6}" text-anchor="${f === 1 ? "end" : f === 0 ? "start" : "middle"}">${formatNumber(Math.round(total * f * 10) / 10)} km</text>`,
    )
    .join("");
  const paths = lines
    .map((ps) => {
      const d = ps
        .map(
          (p, i) =>
            `${i ? "L" : "M"}${x(p[0]).toFixed(2)},${y(p[1]).toFixed(2)}`,
        )
        .join(" ");
      return `<path d="${d} L${x(ps.at(-1)[0])},${base} L${x(ps[0][0])},${base} Z" fill="${routeColor(r)}" opacity=".12"/><path d="${d}" fill="none" stroke="${routeColor(r)}" stroke-width="2" stroke-linejoin="round"/>`;
    })
    .join("");
  const surfaces = surfaceMarkup(r, total, x);
  host.innerHTML = `
    <div class="profile-label">
      <div class="profile-tools">
        Profil altimétrique
        <label class="surface-toggle">
          <input id="showSurfaces" type="checkbox" ${showSurfaces ? "checked" : ""}>
          Revêtements
        </label>
      </div>
      <span id="profileReadout">Survolez la trace ou le profil</span>
    </div>
    <svg id="profileChart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none"
         role="slider" tabindex="0" aria-label="Position sur le parcours : utilisez les flèches gauche et droite"
         aria-valuemin="0" aria-valuemax="${total.toFixed(2)}" aria-valuenow="0">
      ${grid}${paths}${surfaces.band}${ticks}
      <g id="profileCursor" visibility="hidden" pointer-events="none">
        <line y1="8" y2="${showSurfaces ? 117 : base}" stroke="${routeColor(r)}" stroke-width="1" stroke-dasharray="3 3"/>
        <circle r="4" fill="${routeColor(r)}" stroke="white" stroke-width="2"/>
      </g>
    </svg>
    ${surfaces.footer}`;
  byId("showSurfaces").onchange = (event) => {
    showSurfaces = event.target.checked;
    renderProfile(r);
    byId("showSurfaces").focus({ preventScroll: true });
  };
  activeProfile = { r, x, y, total, lastDistance: 0 };
  const svg = byId("profileChart");
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
  svg.onpointerleave = hideProfileCursor;
  svg.onblur = hideProfileCursor;
  svg.onkeydown = (e) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) return;
    e.preventDefault();
    showDistance(
      e.key === "Home"
        ? 0
        : e.key === "End"
          ? total
          : activeProfile.lastDistance +
            ((e.key === "ArrowLeft" ? -1 : 1) * total) / 200,
    );
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

// Events are registered once.
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
  byId("filters").addEventListener("input", render);
  byId("sort").addEventListener("change", render);
  byId("reset").onclick = () => {
    byId("filters").reset();
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

async function init() {
  try {
    const response = await fetch("data/routes.json", { cache: "no-cache" });
    if (!response.ok) throw new Error("Catalogue indisponible");
    routes = await response.json();
    byId("total").textContent = routes.length;
    byId("directionLabel").hidden = !routes.some((route) => route.direction);
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
