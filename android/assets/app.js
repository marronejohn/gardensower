/* GardenSower: offline garden log. Bundled crop database, local storage only. */
"use strict";

var $ = function (id) { return document.getElementById(id); };
var esc = function (s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
  });
};

/* ---------- store ---------- */
var DKEY = "gs_data";
var D = null;
function defState() {
  return { v: 1, settings: { hemisphere: null, lat: null, lng: null, weather: false },
    beds: [], plants: [], entries: [], photos: {} };
}
function load() {
  try { D = JSON.parse(localStorage.getItem(DKEY)) || defState(); }
  catch (e) { D = defState(); }
  if (!D.settings) D = defState();
}
function save() { localStorage.setItem(DKEY, JSON.stringify(D)); }
var uid = function () { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); };

/* ---------- dates ---------- */
function todayISO() {
  var d = new Date();
  return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
}
function pad(n) { return (n < 10 ? "0" : "") + n; }
function parseISO(s) {
  var p = String(s).split("-");
  return new Date(+p[0], +p[1] - 1, +p[2]);
}
function addDays(iso, n) {
  var d = parseISO(iso);
  d.setDate(d.getDate() + n);
  return todayFmt(d);
}
function todayFmt(d) { return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()); }
function daysBetween(isoA, isoB) {
  return Math.round((parseISO(isoB) - parseISO(isoA)) / 86400000);
}
function fmtDate(iso) {
  if (!iso) return "";
  var d = parseISO(iso);
  var M = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  return d.getDate() + " " + M[d.getMonth()];
}
function fmtDateY(iso) {
  var d = parseISO(iso);
  return fmtDate(iso) + (d.getFullYear() === new Date().getFullYear() ? "" : " " + d.getFullYear());
}

/* ---------- hemisphere / climate ---------- */
function hemisphere() {
  if (D.settings.hemisphere) return D.settings.hemisphere;
  if (D.settings.lat != null) return D.settings.lat < 0 ? "S" : "N";
  return "S";
}
/* Southern-hemisphere sow months shifted 6 months for the northern side. */
function sowMonths(crop) {
  var s = hemisphere() === "S" ? crop.sow : crop.sow.map(function (m) { return (m + 5) % 12 + 1; });
  return s;
}
function inSowWindow(crop, iso) {
  var m = parseISO(iso).getMonth() + 1;
  return sowMonths(crop).indexOf(m) >= 0;
}
function monthName(m) {
  return ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][m - 1];
}
function sowWindowText(crop) {
  var s = sowMonths(crop).slice().sort(function (a, b) { return a - b; });
  if (s.length === 12) return "all year";
  if (s.length === 1) return monthName(s[0]);
  /* collapse runs, allowing the Dec-Jan wrap */
  var runs = [], i = 0;
  while (i < s.length) {
    var j = i;
    while (j + 1 < s.length && s[j + 1] === s[j] + 1) j++;
    if (i === 0 && j === s.length - 1 && s[i] !== 1 && s[j] !== 12 && s[0] !== s[j] + 1) {
      /* wrapped run like Sep..Mar */
      runs.push(monthName(s[i]) + "\u2013" + monthName(s[j]));
    } else if (j > i) {
      runs.push(monthName(s[i]) + "\u2013" + monthName(s[j]));
    } else {
      runs.push(monthName(s[i]));
    }
    i = j + 1;
  }
  return runs.join(", ");
}

/* ---------- crop lookup ---------- */
function cropOf(p) {
  if (p.cropId) {
    for (var i = 0; i < CROPS.length; i++) if (CROPS[i].id === p.cropId) return CROPS[i];
  }
  return null;
}
function plantTitle(p) { return p.name || (cropOf(p) ? cropOf(p).n : "Plant"); }
function bedOf(p) {
  for (var i = 0; i < D.beds.length; i++) if (D.beds[i].id === p.bedId) return D.beds[i];
  return null;
}
function photoOf(id) { return id && D.photos[id] ? D.photos[id].d : null; }

/* ---------- timeline engine (estimates the user confirms or shifts) ---------- */
function lastEntry(p, type) {
  var best = null;
  for (var i = 0; i < D.entries.length; i++) {
    var e = D.entries[i];
    if (e.plantId === p.id && (!type || e.type === type)) {
      if (!best || e.date > best.date) best = e;
    }
  }
  return best;
}
function waterStatus(p) {
  var crop = cropOf(p);
  if (!crop) return null;
  var w = lastEntry(p, "watered");
  if (!w) {
    var due = addDays(p.planted, crop.wd);
    var dd = daysBetween(todayISO(), due);
    return { label: "Watering expected about " + fmtDate(due),
      cls: dd <= 0 ? "due" : "ok", due: dd <= 0, est: true, date: due };
  }
  var next = addDays(w.date, crop.wd);
  var d = daysBetween(todayISO(), next);
  if (d < 0) return { label: "Watering overdue (expected " + fmtDate(next) + ")",
    cls: "late", due: true, est: true, date: next };
  if (d === 0) return { label: "Watering due today (estimated)", cls: "due", due: true, est: true, date: next };
  if (d <= 1) return { label: "Watering expected about " + fmtDate(next), cls: "due", due: true, est: true, date: next };
  return { label: "Watering expected about " + fmtDate(next), cls: "ok", due: false, est: true, date: next };
}
/* Milestones: germination and first harvest, framed as estimates. */
function milestones(p) {
  var crop = cropOf(p);
  if (!crop) return [];
  var out = [];
  var germinated = lastEntry(p, "germinated");
  if (crop.germ && crop.germ < 200) {
    if (germinated) out.push({ label: "Germinated", date: germinated.date, est: false });
    else out.push({ label: "Germination expected", date: addDays(p.planted, crop.germ), est: true });
  }
  var harvested = lastEntry(p, "harvested");
  if (harvested) out.push({ label: "First harvest", date: harvested.date, est: false });
  else if (crop.hv) {
    var h = addDays(p.planted, Math.round(crop.hv * 0.9));
    out.push({ label: "First harvest expected", date: h, est: true });
  }
  return out;
}

/* ---------- weather (optional layer; the app never waits on it) ---------- */
function wxCache() {
  try {
    var w = JSON.parse(localStorage.getItem("gs_wx") || "null");
    if (w && Date.now() - w.t < 3600000) return w.v;
  } catch (e) {}
  return null;
}
function wxSet(v) { localStorage.setItem("gs_wx", JSON.stringify({ t: Date.now(), v: v })); }
function fetchWeather() {
  if (!D.settings.weather || D.settings.lat == null) return;
  var cached = wxCache();
  if (cached) { renderWeather(cached); return; }
  /* Native layer does the network call (v0.2); browser dev falls back to XHR. */
  if (window.GardenSowerBridge && window.GardenSowerBridge.fetchWeather) {
    try { window.GardenSowerBridge.fetchWeather(D.settings.lat, D.settings.lng); } catch (e) {}
    return;
  }
  var xhr = new XMLHttpRequest();
  xhr.open("GET", "https://api.open-meteo.com/v1/forecast?latitude=" + D.settings.lat +
    "&longitude=" + D.settings.lng +
    "&daily=precipitation_sum&past_days=2&forecast_days=4&timezone=auto", true);
  xhr.onload = function () { window.__wx(btoa(unescape(encodeURIComponent(xhr.responseText)))); };
  xhr.onerror = function () {}; /* offline: the app just says nothing */
  xhr.send();
}
/* Native bridge hands the raw Open-Meteo JSON over base64-wrapped. */
window.__wx = function (b64) {
  if (!b64) return;
  try {
    var j = JSON.parse(decodeURIComponent(escape(atob(b64))));
    var past = (j.daily.precipitation_sum || []).slice(0, 2);
    var fut = (j.daily.precipitation_sum || []).slice(2);
    var sum = function (a) { return a.reduce(function (x, y) { return x + (y || 0); }, 0); };
    var v = { past: Math.round(sum(past) * 10) / 10, fut: Math.round(sum(fut) * 10) / 10 };
    wxSet(v);
    renderWeather(v);
  } catch (e) {}
}
function renderWeather(w) {
  var el = document.getElementById("wx");
  if (!el || !w) return;
  var msg;
  if (w.past >= 8) msg = w.past + " mm fell in the last two days, so the garden is probably still damp. You can likely skip the hose.";
  else if (w.fut >= 8) msg = "About " + w.fut + " mm of rain expected over the next three days. Watering can wait for it.";
  else if (w.fut >= 3) msg = "Some rain expected in the next few days (" + w.fut + " mm). A top-up only if beds look dry.";
  else msg = "A dry stretch: " + (w.past < 2 ? "little rain lately" : w.past + " mm in the last two days") + ", and little coming. Keep the water up.";
  el.innerHTML = '<div class="row"><div class="wicon">&#127783;</div><div class="grow">' +
    '<div class="psub" style="margin-top:0">Local weather</div><div class="status ok">' + esc(msg) + '</div></div></div>';
  el.style.display = "";
}

/* ---------- photo helper ---------- */
var PENDING_PHOTO = null; /* {mode:'plant'|'entry', plantId} */
function takePhoto() {
  var inp = $("photoInput");
  inp.value = "";
  inp.click();
}
$("photoInput").addEventListener("change", function () {
  var f = this.files && this.files[0];
  if (!f) return;
  var fr = new FileReader();
  fr.onload = function () {
    var img = new Image();
    img.onload = function () {
      var MAX = 640;
      var sc = Math.min(1, MAX / Math.max(img.width, img.height));
      var cv = document.createElement("canvas");
      cv.width = Math.round(img.width * sc);
      cv.height = Math.round(img.height * sc);
      cv.getContext("2d").drawImage(img, 0, 0, cv.width, cv.height);
      var d = cv.toDataURL("image/jpeg", 0.72);
      var pid = uid();
      D.photos[pid] = { d: d, t: Date.now() };
      save();
      if (PENDING_PHOTO && PENDING_PHOTO.cb) PENDING_PHOTO.cb(pid);
    };
    img.src = fr.result;
  };
  fr.readAsDataURL(f);
});

/* ---------- entries ---------- */
var TYPES = [
  { id: "watered", n: "Watered", ic: "\u{1F4A7}" },
  { id: "fed", n: "Fed", ic: "\u{1F343}" },
  { id: "pruned", n: "Pruned", ic: "\u{2702}" },
  { id: "treated", n: "Treated", ic: "\u{1F489}" },
  { id: "harvested", n: "Harvested", ic: "\u{1F957}" },
  { id: "germinated", n: "Germinated", ic: "\u{1F331}" },
  { id: "note", n: "Note", ic: "\u{1F4DD}" }
];
function typeOf(id) {
  for (var i = 0; i < TYPES.length; i++) if (TYPES[i].id === id) return TYPES[i];
  return TYPES[6];
}
function logEntry(plantId, type, date, note, photoId) {
  D.entries.push({ id: uid(), plantId: plantId, type: type, date: date,
    note: note || "", photoId: photoId || null, ts: Date.now() });
  save();
}

/* ---------- views ---------- */
var TAB = "today";
function switchTab(t) {
  TAB = t;
  var bs = document.querySelectorAll("#tabs button");
  for (var i = 0; i < bs.length; i++) bs[i].classList.toggle("on", bs[i].getAttribute("data-tab") === t);
  render();
  window.scrollTo(0, 0);
}
document.querySelectorAll("#tabs button").forEach(function (b) {
  b.addEventListener("click", function () { switchTab(b.getAttribute("data-tab")); });
});

function render() {
  $("fab").style.display = (TAB === "plants") ? "" : "none";
  if (TAB === "today") renderToday();
  else if (TAB === "plants") renderPlants();
  else if (TAB === "log") renderLog();
  else renderSettings();
}

/* Today */
function renderToday() {
  var h = '<h2>Today</h2>';
  h += '<div id="wx" class="card" style="display:none"></div>';
  var plants = D.plants.slice().sort(function (a, b) { return a.name.localeCompare(b.name); });
  var dueRows = [], watchRows = [], restRows = [];
  plants.forEach(function (p) {
    var ws = waterStatus(p);
    if (!ws) { restRows.push(p); return; }
    if (ws.cls === "late" || ws.cls === "due") dueRows.push({ p: p, ws: ws });
    else if (ws.date && daysBetween(todayISO(), ws.date) <= 2) watchRows.push({ p: p, ws: ws });
    else restRows.push(p);
  });
  if (!plants.length) {
    h += '<div class="card empty big-empty">Nothing planted yet.<br>Tap <b>+ Plant</b> to add your first seed, seedling or plant. A photo is enough: the app builds the rest of the timeline from the crop database, and every date stays an estimate you can confirm or shift.</div>';
  } else {
    h += '<h2>Needs water</h2>';
    if (!dueRows.length) h += '<div class="card mut" style="font-size:14px">Nothing overdue. Estimates only: rain and your soil have the final say.</div>';
    dueRows.forEach(function (r) { h += plantRow(r.p, r.ws, true); });
    if (watchRows.length) {
      h += '<h2>Coming up</h2>';
      watchRows.forEach(function (r) { h += plantRow(r.p, r.ws, false); });
    }
    h += '<h2>On track</h2>';
    if (!restRows.length && dueRows.length) h += '<div class="card mut" style="font-size:14px">Everything else is waiting on water.</div>';
    restRows.forEach(function (p) { h += plantRow(p, waterStatus(p), false); });
  }
  h += '<h2>Recent log</h2>';
  var recent = D.entries.slice().sort(function (a, b) { return b.ts - a.ts; }).slice(0, 5);
  if (!recent.length) h += '<div class="card mut" style="font-size:14px">No entries yet.</div>';
  recent.forEach(function (e) {
    var p = plantById(e.plantId);
    var t = typeOf(e.type);
    h += '<div class="card row"><div class="grow"><div class="pname" style="font-size:14px">' +
      t.ic + " " + esc(t.n) + " \u00B7 " + esc(p ? plantTitle(p) : "?") + '</div>' +
      '<div class="psub">' + fmtDate(e.date) + (e.note ? " \u00B7 " + esc(e.note) : "") + '</div></div></div>';
  });
  $("view").innerHTML = h;
  fetchWeather();
}
function plantRow(p, ws, urgent) {
  var crop = cropOf(p);
  var ms = milestones(p).filter(function (m) { return m.est; })[0];
  var h = '<div class="card"><div class="row">';
  var ph = photoOf(p.photoId);
  h += ph ? '<img class="thumb" src="' + ph + '" alt="">' : '<div class="thumb"></div>';
  h += '<div class="grow"><div class="pname">' + esc(plantTitle(p)) + '</div>' +
    '<div class="psub">' + esc(crop ? crop.n : "Custom plant") +
    (p.bedId && bedOf(p) ? " \u00B7 " + esc(bedOf(p).name) : "") +
    " \u00B7 sown " + fmtDate(p.planted) + '</div>' +
    (ws ? '<div class="status ' + ws.cls + '">' + esc(ws.label) + '</div>' : '');
  if (ms) h += '<span class="chip est">' + esc(ms.label) + " ~" + fmtDate(ms.date) + '</span>';
  h += '</div><div style="display:flex;flex-direction:column;gap:6px">' +
    '<button class="btn small" onclick="quickWater(\'' + p.id + '\')">Watered</button>' +
    '<button class="btn sec small" onclick="quickPhoto(\'' + p.id + '\')">Photo</button>' +
    '<button class="btn sec small" onclick="openPlant(\'' + p.id + '\')">Open</button>' +
    '</div></div></div>';
  return h;
}

/* Plants */
function plantById(id) {
  for (var i = 0; i < D.plants.length; i++) if (D.plants[i].id === id) return D.plants[i];
  return null;
}
function renderPlants() {
  if (!D.plants.length) {
    $("view").innerHTML = '<h2>Plants</h2><div class="card empty big-empty">No plants yet.<br>Tap <b>+ Plant</b> to start. Pick a crop and snap a photo; the care timeline builds itself from there.</div>';
    return;
  }
  var h = '<h2>By bed</h2>';
  D.beds.forEach(function (b) {
    var ps = D.plants.filter(function (p) { return p.bedId === b.id; });
    if (!ps.length) return;
    h += '<h2>' + esc(b.name) + (b.face ? " (" + esc(b.face) + " facing)" : "") + '</h2>';
    ps.forEach(function (p) { h += plantRow(p, waterStatus(p), false); });
  });
  var noBed = D.plants.filter(function (p) { return !p.bedId || !bedOf(p); });
  if (noBed.length) {
    h += '<h2>Unassigned</h2>';
    noBed.forEach(function (p) { h += plantRow(p, waterStatus(p), false); });
  }
  $("view").innerHTML = h;
}

/* Log */
function renderLog() {
  var h = '<h2>Full log</h2>';
  if (!D.entries.length) {
    h += '<div class="card empty">No entries yet. Watering, feeding, pruning, treatments and harvests all land here with dates and photos.</div>';
  } else {
    var es = D.entries.slice().sort(function (a, b) { return b.ts - a.ts; });
    var day = null, buf = "";
    es.forEach(function (e) {
      if (e.date !== day) {
        if (day !== null) h += '<div class="card">' + buf + '</div>';
        day = e.date; buf = "";
        buf += '<div class="mut" style="font-size:12px;margin-bottom:4px">' + fmtDateY(e.date) + '</div>';
      }
      var p = plantById(e.plantId);
      var t = typeOf(e.type);
      buf += '<div class="entry"><div class="et">' + t.ic + " " + esc(t.n) + '</div>' +
        '<div class="eb"><b>' + esc(p ? plantTitle(p) : "?") + '</b>' +
        (e.note ? '<br>' + esc(e.note) : "") + '</div>' +
        (e.photoId ? '<img src="' + photoOf(e.photoId) + '" alt="">' : "") + '</div>';
    });
    h += '<div class="card">' + buf + '</div>';
  }
  $("view").innerHTML = h;
}

/* Settings */
function renderSettings() {
  var hemi = hemisphere();
  var h = '<h2>Settings</h2>';
  h += '<div class="card"><label class="f">Season hemisphere</label>' +
    '<div class="optrow">' +
    hemiBtn("S", hemi) + hemiBtn("N", hemi) +
    '</div><div class="psub" style="margin-top:6px">Sowing windows follow your hemisphere. ' +
    (D.settings.lat != null ? "Set automatically from your one-time location check (" + hemi + ")." :
      "No location on file yet; showing southern seasons.") + '</div></div>';
  h += '<div class="card"><label class="f">Weather check (optional)</label>' +
    '<div class="row"><div class="grow"><div class="eb">Rain check for watering reminders</div>' +
    '<div class="psub">Fetches a small forecast when you open the app. Everything else stays fully offline, and the app never waits on it.</div></div>' +
    '<label class="switch"><input type="checkbox" id="wxSwitch" ' + (D.settings.weather ? "checked" : "") + '><span class="sl"></span></label></div></div>';
  h += '<h2>Beds</h2>';
  if (!D.beds.length) h += '<div class="card mut" style="font-size:14px">No beds yet. Add one when you add a plant.</div>';
  D.beds.forEach(function (b) {
    h += '<div class="card row"><div class="grow"><div class="pname" style="font-size:15px">' + esc(b.name) + '</div>' +
      '<div class="psub">' + (b.face ? esc(b.face) + " facing" : "") + '</div></div>' +
      '<button class="btn sec small" onclick="editBed(\'' + b.id + '\')">Edit</button></div>';
  });
  h += '<button class="btn ghost" style="width:100%;margin:4px" onclick="editBed(null)">+ Add bed</button>';
  h += '<h2>Your data</h2>' +
    '<div class="card"><div class="eb">One-tap export: your whole log with photos, as a JSON file to Downloads/GardenSower. Camera originals are already in your phone gallery under Pictures/GardenSower.</div>' +
    '<button class="btn" style="width:100%;margin-top:10px" onclick="doExport()">Export everything</button></div>';
  h += '<div class="card mut" style="font-size:12px">GardenSower keeps everything on this phone. No account, no sensors, no tracking. Sowing dates are estimates from a temperate-climate database; your garden gets the final word.</div>';
  $("view").innerHTML = h;
  var sw = $("wxSwitch");
  if (sw) sw.addEventListener("change", function () {
    D.settings.weather = sw.checked; save();
    if (sw.checked && D.settings.lat == null) toast("Enable weather after the app has a location, or set one in Settings later.");
    else fetchWeather();
  });
}
function hemiBtn(v, cur) {
  return '<button class="opt ' + (cur === v ? "on" : "") + '" onclick="setHemi(\'' + v + '\')">' +
    (v === "S" ? "Southern" : "Northern") + '</button>';
}
function setHemi(v) { D.settings.hemisphere = v; save(); render(); }

/* ---------- modals ---------- */
function openModal(html) {
  $("modalCard").innerHTML = html;
  $("modal").classList.remove("hidden");
}
function closeModal() { $("modal").classList.add("hidden"); }
$("modal").addEventListener("click", function (e) {
  if (e.target === $("modal")) closeModal();
});
function toast(msg) {
  var t = document.createElement("div");
  t.className = "toast"; t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(function () { t.remove(); }, 3200);
}

/* Add plant */
var ADD = null;
function openAddPlant() {
  ADD = { cropId: null, bedId: null, name: "", date: todayISO(), photoId: null };
  openModal(modalHtml());
  bindCropSearch();
}
function modalHtml() {
  var h = '<div class="mtitle">Add a plant</div>';
  h += '<label class="f">Crop</label><input type="text" id="fCrop" placeholder="Search crops, e.g. tomato" value="' + esc(ADD.name || "") + '" autocomplete="off">';
  h += '<div id="cropPick"></div>';
  h += '<label class="f">Bed</label><select id="fBed"><option value="">No bed yet</option>';
  D.beds.forEach(function (b) {
    h += '<option value="' + b.id + '"' + (ADD.bedId === b.id ? " selected" : "") + '>' + esc(b.name) + '</option>';
  });
  h += '</select><div style="margin-top:6px"><button class="btn sec small" onclick="inlineAddBed()">+ New bed</button></div><div id="newBedRow"></div>';
  h += '<label class="f">Planted / sown date</label><input type="date" id="fDate" value="' + ADD.date + '">';
  h += '<label class="f">Photo (optional)</label>';
  h += ADD.photoId ? '<img src="' + photoOf(ADD.photoId) + '" class="thumb" alt="">' : '';
  h += ' <button class="btn sec" style="margin-left:8px" onclick="addPlantPhoto()">' + (ADD.photoId ? "Change photo" : "Snap or pick a photo") + '</button>';
  h += '<div style="margin-top:18px;display:flex;gap:8px">' +
    '<button class="btn" style="flex:1" onclick="savePlant()">Add plant</button>' +
    '<button class="btn sec" onclick="closeModal()">Cancel</button></div>';
  return h;
}
var CROP_SEARCH = "";
function bindCropSearch() {
  var inp = $("fCrop");
  inp.addEventListener("input", function () {
    CROP_SEARCH = inp.value.toLowerCase().trim();
    renderCropPick();
    ADD.name = inp.value;
  });
  renderCropPick();
}
function renderCropPick() {
  var el = $("cropPick");
  if (!el) return;
  var list = CROPS;
  if (CROP_SEARCH) list = CROPS.filter(function (c) {
    return c.n.toLowerCase().indexOf(CROP_SEARCH) >= 0 || c.id.indexOf(CROP_SEARCH.replace(/[^a-z]/g, "")) >= 0;
  });
  var h = '<div class="optrow">';
  list.slice(0, 12).forEach(function (c) {
    h += '<button class="opt ' + (ADD.cropId === c.id ? "on" : "") + '" onclick="pickCrop(\'' + c.id + '\')">' + esc(c.n) + '</button>';
  });
  if (!list.length) h += '<span class="psub">No match; a custom name works too.</span>';
  h += '</div>';
  el.innerHTML = h;
}
function pickCrop(id) {
  ADD.cropId = (ADD.cropId === id ? null : id);
  if (ADD.cropId) {
    for (var i = 0; i < CROPS.length; i++) if (CROPS[i].id === id) ADD.name = CROPS[i].n;
    $("fCrop").value = CROPS[i] ? CROPS[i].n : ADD.name;
    var crop = cropOf({ cropId: id });
    if (crop && !inSowWindow(crop, ADD.date)) {
      toast("Usually sown " + sowWindowText(crop) + " (" + hemisphere() + " seasons) \u2014 your call, the timeline still builds.");
    }
  }
  renderCropPick();
}
function addPlantPhoto() {
  PENDING_PHOTO = { cb: function (pid) { ADD.photoId = pid; openModal(modalHtml()); bindCropSearch(); } };
  takePhoto();
}
function inlineAddBed() {
  var el = $("newBedRow");
  if (!el) return;
  el.innerHTML = '<div style="display:flex;gap:6px;margin-top:6px">' +
    '<input type="text" id="fNewBed" placeholder="Bed name, e.g. North bed" style="flex:1">' +
    '<button class="btn small" onclick="commitBed()">Add</button></div>';
}
function commitBed() {
  var nm = ($("fNewBed").value || "").trim();
  if (!nm) return;
  var b = { id: uid(), name: nm, face: "" };
  D.beds.push(b); save();
  ADD.bedId = b.id;
  openModal(modalHtml());
  bindCropSearch();
}
function savePlant() {
  var name = ($("fCrop").value || "").trim();
  var crop = ADD.cropId ? cropOf({ cropId: ADD.cropId }) : null;
  if (!name && !crop) { toast("Name the plant or pick a crop."); return; }
  var p = { id: uid(), name: name, cropId: ADD.cropId, bedId: $("fBed").value || null,
    planted: $("fDate").value || todayISO(), photoId: ADD.photoId };
  D.plants.push(p);
  logEntry(p.id, "planted", p.planted, crop ? "Crop: " + crop.n : "", p.photoId);
  save();
  closeModal();
  toast("Added. The care timeline builds from " + fmtDate(p.planted) + ".");
  render();
}

/* Plant detail */
function openPlant(id) {
  var p = plantById(id);
  if (!p) return;
  var crop = cropOf(p);
  var h = '<div class="mtitle">' + esc(plantTitle(p)) + '</div>';
  var ph = photoOf(p.photoId);
  h += '<div class="row" style="margin-bottom:6px">' +
    (ph ? '<img class="thumb" src="' + ph + '" alt="">' : "") +
    '<div class="grow"><div class="psub" style="margin-top:0">' + esc(crop ? crop.n : "Custom plant") +
    " \u00B7 " + (p.bedId && bedOf(p) ? esc(bedOf(p).name) : "no bed") +
    " \u00B7 sown " + fmtDateY(p.planted) + '</div>' +
    '<div class="psub">Age: ' + Math.max(0, daysBetween(p.planted, todayISO())) + ' days</div></div></div>';
  if (crop) {
    h += '<span class="chip">Sow window: ' + esc(sowWindowText(crop)) + '</span>' +
      '<span class="chip">Sun: ' + esc(crop.sun) + '</span>' +
      '<span class="chip">Spacing: ' + esc(crop.sp) + '</span>' +
      '<span class="chip">Water about every ' + crop.wd + ' days</span>' +
      '<div class="psub" style="margin-top:6px">' + esc(crop.tip) + '</div>';
  }
  var ws = waterStatus(p);
  if (ws) h += '<div class="status ' + ws.cls + '" style="margin-top:10px">' + esc(ws.label) + '</div>';
  h += '<div style="margin-top:4px">';
  milestones(p).forEach(function (m) {
    h += '<span class="chip ' + (m.est ? "est" : "") + '">' + esc(m.label) + ": " + fmtDate(m.date) + (m.est ? " (estimate)" : "") + '</span> ';
  });
  h += '</div>';
  h += '<label class="f">Log something</label><div class="optrow">';
  TYPES.forEach(function (t) {
    if (t.id === "germinated" && (!crop || crop.germ >= 200)) return;
    h += '<button class="opt" onclick="openEntry(\'' + p.id + '\',\'' + t.id + '\')">' + t.ic + " " + t.n + '</button>';
  });
  h += '</div>';
  h += '<h2>Timeline</h2>';
  var es = D.entries.filter(function (e) { return e.plantId === p.id; })
    .sort(function (a, b) { return b.ts - a.ts; });
  if (!es.length) h += '<div class="card mut" style="font-size:14px">No entries yet.</div>';
  es.forEach(function (e) {
    var t = typeOf(e.type);
    h += '<div class="entry"><div class="et">' + fmtDate(e.date) + '</div>' +
      '<div class="eb">' + t.ic + " " + esc(t.n) + (e.note ? '<br>' + esc(e.note) : "") + '</div>' +
      (e.photoId ? '<img src="' + photoOf(e.photoId) + '" alt="">' : "") + '</div>';
  });
  h += '<div style="margin-top:16px;display:flex;gap:8px">' +
    '<button class="btn sec" style="flex:1" onclick="editPlant(\'' + p.id + '\')">Edit</button>' +
    '<button class="btn sec" style="flex:1" onclick="delPlant(\'' + p.id + '\')">Remove plant</button>' +
    '<button class="btn sec" onclick="closeModal()">Close</button></div>';
  openModal(h);
}
var ENTRY = null;
function openEntry(plantId, type) {
  ENTRY = { plantId: plantId, type: type, date: todayISO(), note: "", photoId: null };
  entryModal();
}
function entryModal() {
  var t = typeOf(ENTRY.type);
  var p = plantById(ENTRY.plantId);
  var h = '<div class="mtitle">' + t.ic + " " + esc(t.n) + " \u00B7 " + esc(plantTitle(p)) + '</div>';
  h += '<label class="f">Date</label><input type="date" id="eDate" value="' + ENTRY.date + '">';
  h += '<label class="f">Note (optional)</label><textarea id="eNote" placeholder="How it looked, what you did">' + esc(ENTRY.note) + '</textarea>';
  h += '<label class="f">Photo (optional)</label>';
  h += ENTRY.photoId ? '<img src="' + photoOf(ENTRY.photoId) + '" class="thumb" alt="">' : "";
  h += ' <button class="btn sec" style="margin-left:8px" onclick="entryPhoto()">' + (ENTRY.photoId ? "Change" : "Add photo") + '</button>';
  h += '<div style="margin-top:16px;display:flex;gap:8px">' +
    '<button class="btn" style="flex:1" onclick="saveEntry()">Save</button>' +
    '<button class="btn sec" onclick="closeModal()">Cancel</button></div>';
  openModal(h);
}
function entryPhoto() {
  PENDING_PHOTO = { cb: function (pid) { ENTRY.photoId = pid; entryModal(); } };
  takePhoto();
}
function saveEntry() {
  ENTRY.date = $("eDate").value || todayISO();
  ENTRY.note = ($("eNote").value || "").trim();
  logEntry(ENTRY.plantId, ENTRY.type, ENTRY.date, ENTRY.note, ENTRY.photoId);
  closeModal();
  toast("Logged for " + fmtDate(ENTRY.date) + ".");
  render();
  openPlant(ENTRY.plantId);
}
function quickWater(id) {
  logEntry(id, "watered", todayISO(), "", null);
  toast("Watered today. Estimates re-set from here.");
  render();
}
function quickPhoto(id) {
  PENDING_PHOTO = { cb: function (pid) {
    logEntry(id, "note", todayISO(), "", pid);
    toast("Photo logged.");
    render();
  } };
  takePhoto();
}
function editPlant(id) {
  var p = plantById(id);
  if (!p) return;
  ADD = { cropId: p.cropId, bedId: p.bedId, name: p.name, date: p.planted, photoId: p.photoId, editing: id };
  openModal(modalHtml());
}
function savePlantEdit() {
  var p = plantById(ADD.editing);
  if (!p) return;
  p.name = ($("fCrop").value || "").trim();
  p.cropId = ADD.cropId;
  p.bedId = $("fBed").value || null;
  p.planted = $("fDate").value || p.planted;
  p.photoId = ADD.photoId;
  save(); closeModal(); render();
}
function delPlant(id) {
  if (!confirm("Remove this plant and its log entries? Photos stay in your gallery and the export.")) return;
  D.plants = D.plants.filter(function (p) { return p.id !== id; });
  D.entries = D.entries.filter(function (e) { return e.plantId !== id; });
  save(); closeModal(); render();
}
/* The add modal doubles as the edit modal */
var _savePlantOrig = savePlant;
savePlant = function () {
  if (ADD.editing) {
    var p = plantById(ADD.editing);
    if (!p) return;
    p.name = ($("fCrop").value || "").trim();
    p.cropId = ADD.cropId;
    p.bedId = $("fBed").value || null;
    p.planted = $("fDate").value || p.planted;
    p.photoId = ADD.photoId;
    save(); closeModal(); render();
    return;
  }
  _savePlantOrig();
};

/* Beds */
function editBed(id) {
  var b = id ? null : { id: uid(), name: "", face: "" };
  if (id) for (var i = 0; i < D.beds.length; i++) if (D.beds[i].id === id) b = D.beds[i];
  openModal('<div class="mtitle">' + (id ? "Edit bed" : "Add bed") + '</div>' +
    '<label class="f">Name</label><input type="text" id="bName" value="' + esc(b.name) + '">' +
    '<label class="f">Faces</label><div class="optrow">' +
    ["", "north", "east", "south", "west"].map(function (f) {
      return '<button class="opt ' + (b.face === f ? "on" : "") + '" onclick="setBedFace(\'' + f + '\')">' +
        (f ? f.charAt(0).toUpperCase() + f.slice(1) : "Not set") + '</button>';
    }).join("") + '</div>' +
    '<div style="margin-top:16px;display:flex;gap:8px">' +
    '<button class="btn" style="flex:1" onclick="saveBed(\'' + b.id + '\')">Save</button>' +
    (id ? '<button class="btn sec" onclick="delBed(\'' + b.id + '\')">Delete</button>' : "") +
    '<button class="btn sec" onclick="closeModal()">Cancel</button></div>');
}
var editBedFace = "", editBedKeepName = null, editBedId = null;
function openBedModalWithFace() {
  var b = { id: editBedId || uid(), name: editBedKeepName || "", face: editBedFace };
  var isNew = !editBedId;
  openModal('<div class="mtitle">' + (isNew ? "Add bed" : "Edit bed") + '</div>' +
    '<label class="f">Name</label><input type="text" id="bName" value="' + esc(b.name) + '">' +
    '<label class="f">Faces</label><div class="optrow">' +
    ["", "north", "east", "south", "west"].map(function (f) {
      return '<button class="opt ' + (b.face === f ? "on" : "") + '" onclick="bedFace(\'' + f + '\')">' +
        (f ? f.charAt(0).toUpperCase() + f.slice(1) : "Not set") + '</button>';
    }).join("") + '</div>' +
    '<div style="margin-top:16px;display:flex;gap:8px">' +
    '<button class="btn" style="flex:1" onclick="saveBed()">Save</button>' +
    (!isNew ? '<button class="btn sec" onclick="delBed()">Delete</button>' : "") +
    '<button class="btn sec" onclick="closeModal()">Cancel</button></div>');
}
function bedFace(f) { editBedFace = f; editBedKeepName = ($("bName") || {}).value || ""; openBedModalWithFace(); }
function saveBed() {
  var nm = ($("bName").value || "").trim();
  if (!nm) { toast("Name the bed."); return; }
  if (editBedId) {
    for (var i = 0; i < D.beds.length; i++) if (D.beds[i].id === editBedId) {
      D.beds[i].name = nm; D.beds[i].face = editBedFace;
    }
  } else {
    D.beds.push({ id: uid(), name: nm, face: editBedFace });
  }
  editBedId = null; editBedFace = "";
  save(); closeModal(); render();
}
function delBed() {
  if (!editBedId) return;
  if (!confirm("Delete this bed? Plants stay and become Unassigned.")) return;
  D.beds = D.beds.filter(function (b) { return b.id !== editBedId; });
  editBedId = null; editBedFace = "";
  save(); closeModal(); render();
}
/* Wire the settings buttons through the stateful bed editor */
var _editBedOrig = editBed;
editBed = function (id) {
  editBedId = id || null;
  editBedFace = "";
  editBedKeepName = null;
  if (id) {
    for (var i = 0; i < D.beds.length; i++) if (D.beds[i].id === id) {
      editBedFace = D.beds[i].face || "";
      editBedKeepName = D.beds[i].name;
    }
  }
  openBedModalWithFace();
};

/* ---------- export ---------- */
function doExport() {
  var payload = { app: "GardenSower", version: D.v, exported: new Date().toISOString(),
    data: D, note: "Camera originals are in the phone gallery under Pictures/GardenSower." };
  var json = JSON.stringify(payload, null, 1);
  var b64 = btoa(unescape(encodeURIComponent(json)));
  var a = document.createElement("a");
  a.href = "data:application/json;base64," + b64;
  a.download = "gardensower_export_" + todayISO() + ".json";
  a.click();
  toast("Export saved to Downloads/GardenSower.");
}

/* ---------- gps hook from the wrapper ---------- */
window.__gps = function (lat, lng) {
  var changed = false;
  if (D.settings.lat == null || D.settings.hemisphere == null) {
    D.settings.lat = lat; D.settings.lng = lng;
    if (!D.settings.hemisphere) D.settings.hemisphere = lat < 0 ? "S" : "N";
    changed = true;
    save();
    if (TAB === "settings") render();
    toast("Location set once for seasons (" + hemisphere() + " hemisphere). No tracking after this.");
  }
};

/* ---------- boot ---------- */
load();
var M = ["January","February","March","April","May","June","July","August","September","October","November","December"];
var now = new Date();
$("hdrDate").textContent = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"][now.getDay()] +
  ", " + now.getDate() + " " + M[now.getMonth()];
$("fab").addEventListener("click", openAddPlant);
render();
