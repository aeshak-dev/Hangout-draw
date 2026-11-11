'use strict';
/* Hangout Draw client */
const W = 1600, H = 1000;
const $ = s => document.querySelector(s), $$ = s => [...document.querySelectorAll(s)];
const main = $('#main'), live = $('#live'), mc = main.getContext('2d'), lc = live.getContext('2d');
const wrap = $('#wrap'), stage = $('#stage');
main.width = live.width = W; main.height = live.height = H;

const TOOLS = [
  ['pen', '🖊️', 'Pen'], ['marker', '🖍️', 'Marker'], ['callig', '✒️', 'Calligraphy'], ['pencil', '✏️', 'Pencil'],
  ['spray', '🧴', 'Spray'], ['neon', '💡', 'Neon'], ['rainbow', '🌈', 'Rainbow'], ['eraser', '🧽', 'Eraser'],
  ['line', '📏', 'Line'], ['rect', '⬛', 'Box'], ['ellipse', '⭕', 'Oval'], ['stamp', '⭐', 'Stamp']
];
const PREVIEW = ['line', 'rect', 'ellipse', 'stamp'];
const STAMPS = ['❤️', '⭐', '🌸', '🌙', '✨', '🐱', '🐶', '🦋', '🔥', '🍓', '☁️', '🎈', '💋', '🌈', '🫶', '🍀'];
const PALETTES = {
  'Sweet': ['#ff7b8f', '#ff9eb5', '#ffc2d1', '#e8457c', '#b5179e', '#7209b7', '#f8c8dc', '#fff0f5'],
  'Neon': ['#ff0055', '#ff9e00', '#faff00', '#39ff14', '#00f5d4', '#00b4ff', '#7a5cff', '#ff2bd6'],
  'Pastel': ['#ffd6e0', '#ffe5b4', '#fff9b0', '#cdf2c4', '#bde7f5', '#d5c6f7', '#f5c6e8', '#e8e8e8'],
  'Earth': ['#3b2a20', '#6b4a35', '#a47148', '#d4a373', '#8a9a5b', '#4f6d4a', '#c8553d', '#e9d8a6'],
  'Ocean': ['#03045e', '#0077b6', '#00b4d8', '#90e0ef', '#caf0f8', '#2a9d8f', '#264653', '#e0fbfc'],
  'Sunset': ['#2d1e4f', '#6a2c70', '#b83b5e', '#f08a5d', '#f9ed69', '#ffb26b', '#ff6b6b', '#ffd460'],
  'Greys': ['#000000', '#222222', '#444444', '#666666', '#888888', '#aaaaaa', '#dddddd', '#ffffff']
};

const S = { tool: 'pen', color: '#e8457c', size: 8, alpha: 1, blur: 0, symN: 1, mirror: false, fill: false, stamp: '❤️' };
const uid = Math.random().toString(36).slice(2, 10);
let name = 'Guest', room = 'lobby', myColor = '#e8457c', bg = '#ffffff';
let ws = null, ops = [], byId = new Map(), cnt = 0, peers = new Map(), cursors = new Map();
let cur = null, buf = [], zoom = 1, recent = [];

/* ---------- helpers ---------- */
const cx = document.createElement('canvas').getContext('2d');
const norm = c => { cx.fillStyle = '#000'; cx.fillStyle = c; return cx.fillStyle; };
const toHex = (r, g, b) => '#' + [r, g, b].map(n => n.toString(16).padStart(2, '0')).join('');
const hash = s => { let h = 0; for (const ch of s) h = Math.imul(31, h) + ch.charCodeAt(0) | 0; return h; };
const rng = seed => () => {
  seed |= 0; seed = seed + 0x6D2B79F5 | 0;
  let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
  t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
  return ((t ^ t >>> 14) >>> 0) / 4294967296;
};
function hsv2rgb(h, s, v) {
  const f = n => { const k = (n + h / 60) % 6; return Math.round(255 * (v - v * s * Math.max(0, Math.min(k, 4 - k, 1)))); };
  return [f(5), f(3), f(1)];
}
function hex2hsl(hex) {
  const r = parseInt(hex.slice(1, 3), 16) / 255, g = parseInt(hex.slice(3, 5), 16) / 255, b = parseInt(hex.slice(5, 7), 16) / 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2, d = mx - mn;
  let h = 0, s = 0;
  if (d) {
    s = d / (1 - Math.abs(2 * l - 1));
    h = mx === r ? ((g - b) / d + 6) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
    h *= 60;
  }
  return [h, s * 100, l * 100];
}
const send = o => { if (ws && ws.readyState === 1) ws.send(JSON.stringify(o)); };
const online = () => ws && ws.readyState === 1;

/* ---------- brush engine ---------- */
function sym(c, o, fn) {
  const [n, m] = o.sym || [1, 0];
  for (let k = 0; k < n; k++) for (let f = 0; f <= m; f++) {
    c.save();
    c.translate(W / 2, H / 2); c.rotate(k * 2 * Math.PI / n);
    if (f) c.scale(-1, 1);
    c.translate(-W / 2, -H / 2);
    fn();
    c.restore();
  }
}
function seg(c, o, i) {
  const p = o.pts, x = p[i * 2], y = p[i * 2 + 1], px = i ? p[i * 2 - 2] : x, py = i ? p[i * 2 - 1] : y;
  const s = o.size, t = o.tool, r = rng(hash(o.id) + i * 977);
  const line = () => { c.beginPath(); c.moveTo(px, py); c.lineTo(x, y); c.stroke(); };
  sym(c, o, () => {
    c.globalAlpha = o.alpha; c.lineCap = c.lineJoin = 'round';
    c.strokeStyle = c.fillStyle = o.color;
    if (t === 'eraser') c.globalCompositeOperation = 'destination-out';
    if (t === 'rainbow') c.strokeStyle = `hsl(${(i * 4 + Math.abs(hash(o.id))) % 360} 90% 55%)`;
    if (o.blur && (t === 'pen' || t === 'marker' || t === 'rainbow')) { c.shadowBlur = o.blur; c.shadowColor = c.strokeStyle; }
    if (t === 'neon') {
      c.shadowColor = o.color; c.shadowBlur = s * 2 + o.blur; c.lineWidth = s; line();
      c.shadowBlur = 0; c.strokeStyle = '#fff'; c.lineWidth = Math.max(1, s / 3); line();
    } else if (t === 'callig') {
      const a = Math.PI / 4, dx = Math.cos(a) * s * .6, dy = -Math.sin(a) * s * .6;
      c.beginPath(); c.moveTo(px + dx, py + dy); c.lineTo(x + dx, y + dy); c.lineTo(x - dx, y - dy); c.lineTo(px - dx, py - dy);
      c.closePath(); c.fill(); c.lineWidth = 1; c.stroke();
    } else if (t === 'pencil') {
      const d = Math.hypot(x - px, y - py), n = (Math.ceil(d / 2) + 1) * Math.ceil(s / 2) * 2;
      for (let j = 0; j < n; j++) {
        const u = r();
        c.globalAlpha = o.alpha * (.2 + r() * .5);
        c.fillRect(px + (x - px) * u + (r() - .5) * s * .8, py + (y - py) * u + (r() - .5) * s * .8, 1 + r() * 1.5, 1 + r() * 1.5);
      }
    } else if (t === 'spray') {
      const d = Math.hypot(x - px, y - py), n = Math.ceil(s * 1.2) * (Math.ceil(d / 6) + 1);
      for (let j = 0; j < n; j++) {
        const u = r(), a = r() * 6.2832, rad = Math.sqrt(r()) * s * 1.6;
        c.fillRect(px + (x - px) * u + Math.cos(a) * rad, py + (y - py) * u + Math.sin(a) * rad, 1.5, 1.5);
      }
    } else {
      c.lineWidth = t === 'marker' ? s * 1.8 : s;
      if (t === 'marker') c.lineCap = 'square';
      line();
    }
  });
}
function shape(c, o) {
  const [x1, y1, x2, y2] = o.pts;
  sym(c, o, () => {
    c.globalAlpha = o.alpha; c.strokeStyle = c.fillStyle = o.color; c.lineWidth = o.size; c.lineCap = c.lineJoin = 'round';
    if (o.blur) { c.shadowBlur = o.blur; c.shadowColor = o.color; }
    if (o.tool === 'stamp') {
      c.font = `${o.size * 4 + 12}px serif`; c.textAlign = 'center'; c.textBaseline = 'middle';
      c.fillText(o.stamp, x1, y1); return;
    }
    c.beginPath();
    if (o.tool === 'line') { c.moveTo(x1, y1); c.lineTo(x2, y2); }
    else if (o.tool === 'rect') c.rect(x1, y1, x2 - x1, y2 - y1);
    else c.ellipse((x1 + x2) / 2, (y1 + y2) / 2, Math.abs(x2 - x1) / 2, Math.abs(y2 - y1) / 2, 0, 0, 7);
    if (o.fill && o.tool !== 'line') c.fill(); else c.stroke();
  });
}
function renderOp(c, o) {
  if (PREVIEW.includes(o.tool)) shape(c, o);
  else for (let i = 0; i < o.pts.length / 2; i++) seg(c, o, i);
}
function redraw() { mc.clearRect(0, 0, W, H); ops.forEach(o => renderOp(mc, o)); }
const addOp = o => { ops.push(o); byId.set(o.id, o); };

/* ---------- pointer input ---------- */
function pos(e) {
  const r = main.getBoundingClientRect();
  return [(e.clientX - r.left) * W / r.width, (e.clientY - r.top) * H / r.height];
}
function drawPrev() { lc.clearRect(0, 0, W, H); renderOp(lc, cur); }
let lastC = 0;
live.onpointerdown = e => {
  if (e.button) return;
  live.setPointerCapture(e.pointerId);
  const [x, y] = pos(e), prev = PREVIEW.includes(S.tool);
  cur = {
    id: `${uid}-${++cnt}`, uid, tool: S.tool, color: S.color, size: S.size, alpha: S.alpha, blur: S.blur,
    sym: [S.symN, S.mirror ? 1 : 0], fill: S.fill, stamp: S.stamp,
    pts: S.tool === 'stamp' ? [x, y] : prev ? [x, y, x, y] : [x, y]
  };
  if (prev) drawPrev();
  else { addOp(cur); seg(mc, cur, 0); send({ t: 'begin', op: cur }); }
  addRecent(S.color);
};
live.onpointermove = e => {
  const now = performance.now();
  if (now - lastC > 50) { lastC = now; const [x, y] = pos(e); send({ t: 'cur', x: x / W, y: y / H }); }
  if (!cur) return;
  const evs = e.getCoalescedEvents ? e.getCoalescedEvents() : [];
  (evs.length ? evs : [e]).forEach(ev => {
    const [x, y] = pos(ev);
    if (PREVIEW.includes(cur.tool)) {
      if (cur.tool === 'stamp') cur.pts = [x, y]; else { cur.pts[2] = x; cur.pts[3] = y; }
    } else {
      cur.pts.push(x, y); seg(mc, cur, cur.pts.length / 2 - 1); buf.push(x, y);
    }
  });
  if (PREVIEW.includes(cur.tool)) drawPrev();
};
live.onpointerup = live.onpointercancel = () => {
  if (!cur) return;
  const o = cur; cur = null;
  if (PREVIEW.includes(o.tool)) {
    lc.clearRect(0, 0, W, H); addOp(o); renderOp(mc, o); send({ t: 'op', op: o });
  } else flush(o);
};
function flush(o) {
  const c = o || cur;
  if (c && buf.length) { send({ t: 'pts', id: c.id, pts: buf }); buf = []; }
}
setInterval(() => flush(), 50);

/* ---------- actions ---------- */
function undo() {
  if (online()) return send({ t: 'undo' });
  for (let i = ops.length - 1; i >= 0; i--) if (ops[i].uid === uid) { removeOp(ops[i].id); break; }
}
function removeOp(id) { ops = ops.filter(o => o.id !== id); byId.delete(id); redraw(); }
function clearAll() { ops = []; byId.clear(); redraw(); }
function setBg(c, tell) {
  bg = c; wrap.style.background = c; $('#bg').value = norm(c);
  if (tell) send({ t: 'bg', color: c });
}
$('#undo').onclick = undo;
$('#clear').onclick = () => {
  if (!confirm('Clear the canvas for everyone in this room?')) return;
  if (online()) send({ t: 'clear' }); else clearAll();
};
$('#bg').oninput = e => setBg(e.target.value, true);
$('#grid').onchange = e => wrap.classList.toggle('grid', e.target.checked);
$('#save').onclick = () => {
  const t = document.createElement('canvas'); t.width = W; t.height = H;
  const c = t.getContext('2d'); c.fillStyle = bg; c.fillRect(0, 0, W, H); c.drawImage(main, 0, 0);
  t.toBlob(b => { const a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = `drawing-${room}.png`; a.click(); });
};
$('#copyLink').onclick = async e => {
  const url = location.origin + location.pathname + '?room=' + encodeURIComponent(room);
  try { await navigator.clipboard.writeText(url); e.currentTarget.firstChild.textContent = 'Copied! '; }
  catch { prompt('Copy this invite link:', url); }
  setTimeout(() => $('#copyLink').firstChild.textContent = 'Invite: ', 1500);
};
function setZoom(z) {
  zoom = Math.min(4, Math.max(.2, z));
  wrap.style.width = W * zoom + 'px'; $('#zlab').textContent = Math.round(zoom * 100) + '%';
}
const fit = () => setZoom(Math.min((stage.clientWidth - 24) / W, (stage.clientHeight - 24) / H));
$('#zin').onclick = () => setZoom(zoom * 1.25);
$('#zout').onclick = () => setZoom(zoom / 1.25);
$('#zfit').onclick = fit;
addEventListener('resize', fit);

addEventListener('keydown', e => {
  const t = e.target;
  if (/INPUT|TEXTAREA/.test(t.tagName) && !['range', 'checkbox'].includes(t.type)) return;
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); undo(); return; }
  if (e.key === '[') setSize(S.size - 2);
  else if (e.key === ']') setSize(S.size + 2);
  else if (e.key === 'e') pickTool('eraser');
  else if (e.key === 'b') pickTool('pen');
});

/* ---------- tools & brush panel ---------- */
const tools = $('#tools');
TOOLS.forEach(([id, em, label]) => {
  const b = document.createElement('button');
  b.className = 'tool' + (id === S.tool ? ' on' : ''); b.dataset.id = id; b.title = label;
  b.innerHTML = `<span class="e">${em}</span>${label}`;
  b.onclick = () => pickTool(id);
  tools.append(b);
});
function pickTool(id) { S.tool = id; $$('.tool').forEach(b => b.classList.toggle('on', b.dataset.id === id)); }
function updatePrev() {
  const p = $('#prev'), d = Math.min(S.size, 110);
  p.style.cssText = `width:${d}px;height:${d}px;background:${S.color};opacity:${S.alpha};filter:blur(${S.blur / 4}px)`;
}
function setSize(v) {
  S.size = Math.min(120, Math.max(1, v));
  const r = $('[data-k=size]'); r.value = S.size; $('#v-size').textContent = S.size; updatePrev();
}
$$('[data-k]').forEach(r => r.oninput = () => {
  const k = r.dataset.k, v = +r.value;
  S[k] = r.dataset.d ? v / r.dataset.d : v;
  $('#v-' + k).textContent = v; updatePrev();
});
$('#mirror').onchange = e => S.mirror = e.target.checked;
$('#fill').onchange = e => S.fill = e.target.checked;
STAMPS.forEach(s => {
  const b = document.createElement('button');
  b.className = 'dot emoji' + (s === S.stamp ? ' on' : ''); b.textContent = s;
  b.onclick = () => { S.stamp = s; $$('#stamps .dot').forEach(x => x.classList.toggle('on', x === b)); pickTool('stamp'); };
  $('#stamps').append(b);
});

/* ---------- colour ---------- */
function setColor(c, fromMix) {
  S.color = norm(c);
  $('#big').style.background = S.color; $('#hex').value = S.color; $('#native').value = S.color;
  if (!fromMix) { const [h, s, l] = hex2hsl(S.color); $('#mh').value = h; $('#ms').value = s; $('#ml').value = l; }
  updatePrev();
}
function addRecent(c) {
  if (recent[0] === c) return;
  recent = [c, ...recent.filter(x => x !== c)].slice(0, 14);
  $('#recent').innerHTML = '';
  recent.forEach(x => $('#recent').append(dot(x)));
}
function dot(c) {
  const b = document.createElement('button');
  b.className = 'dot'; b.style.background = c; b.title = c; b.onclick = () => setColor(c);
  return b;
}
$('#hex').oninput = e => { if (/^#[0-9a-f]{6}$/i.test(e.target.value)) setColor(e.target.value); };
$('#native').oninput = e => setColor(e.target.value);
if (!window.EyeDropper) $('#eye').hidden = true;
$('#eye').onclick = async () => { try { setColor((await new EyeDropper().open()).sRGBHex); } catch { } };
['mh', 'ms', 'ml'].forEach(id => $('#' + id).oninput = () =>
  setColor(`hsl(${$('#mh').value} ${$('#ms').value}% ${$('#ml').value}%)`, true));

// wheel: angle = hue, distance = saturation, slider = brightness
const wheel = $('#wheel'), wc = wheel.getContext('2d', { willReadFrequently: true });
function drawWheel() {
  const N = wheel.width, R = N / 2, v = $('#bri').value / 100, img = wc.createImageData(N, N);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const dx = x - R + .5, dy = y - R + .5, d = Math.hypot(dx, dy);
    if (d > R) continue;
    const [r, g, b] = hsv2rgb((Math.atan2(dy, dx) * 180 / Math.PI + 360) % 360, d / R, v);
    img.data.set([r, g, b, 255], (y * N + x) * 4);
  }
  wc.putImageData(img, 0, 0);
}
$('#bri').oninput = drawWheel;

// rings: 6 lightness rings x 24 hues, grey pie in the middle
const rings = $('#rings'), rc = rings.getContext('2d', { willReadFrequently: true });
function drawRings() {
  const c = rc, X = 120, R = 118, core = 26, n = 24, L = [90, 78, 66, 54, 42, 30], bt = (R - core) / L.length;
  c.clearRect(0, 0, 240, 240);
  L.forEach((l, j) => {
    const o = R - j * bt, inn = o - bt;
    for (let i = 0; i < n; i++) {
      const a0 = i * 2 * Math.PI / n, a1 = (i + 1) * 2 * Math.PI / n;
      c.beginPath(); c.arc(X, X, o, a0, a1); c.arc(X, X, inn, a1, a0, true); c.closePath();
      c.fillStyle = `hsl(${i * 15} 90% ${l}%)`; c.fill();
    }
  });
  ['#ffffff', '#d9d9d9', '#a6a6a6', '#737373', '#3d3d3d', '#000000'].forEach((g, k) => {
    c.beginPath(); c.moveTo(X, X); c.arc(X, X, core, k * Math.PI / 3, (k + 1) * Math.PI / 3); c.closePath();
    c.fillStyle = g; c.fill();
  });
}
function pickFrom(cv, ctx, e) {
  const r = cv.getBoundingClientRect(), x = Math.floor((e.clientX - r.left) * cv.width / r.width), y = Math.floor((e.clientY - r.top) * cv.height / r.height);
  if (x < 0 || y < 0 || x >= cv.width || y >= cv.height) return;
  const [R, G, B, A] = ctx.getImageData(x, y, 1, 1).data;
  if (A > 250) setColor(toHex(R, G, B));
}
[[wheel, wc], [rings, rc]].forEach(([cv, ctx]) => {
  let down = false;
  cv.onpointerdown = e => { down = true; cv.setPointerCapture(e.pointerId); pickFrom(cv, ctx, e); };
  cv.onpointermove = e => down && pickFrom(cv, ctx, e);
  cv.onpointerup = () => down = false;
});
Object.entries(PALETTES).forEach(([nm, cols]) => {
  const t = document.createElement('div'); t.className = 'setname'; t.textContent = nm;
  const d = document.createElement('div'); d.className = 'dots'; cols.forEach(c => d.append(dot(c)));
  $('#c-sets').append(t, d);
});

function tabs(bs, ps, key) {
  $$(bs).forEach(b => b.onclick = () => {
    $$(bs).forEach(x => x.classList.toggle('on', x === b));
    $$(ps).forEach(p => p.hidden = p.id !== b.dataset[key]);
    if (b.dataset[key] === 'p-chat') $('#chatDot').hidden = true;
  });
}
tabs('.tab', '.panel', 'p');
tabs('.stab', '.cpan', 'c');

/* ---------- chat & people ---------- */
function addMsg(m) {
  const d = document.createElement('div'); d.className = 'msg'; d.style.setProperty('--c', m.color);
  const b = document.createElement('b'); b.textContent = m.name + ': ';
  d.append(b, document.createTextNode(m.text));
  const box = $('#msgs'); box.append(d); box.scrollTop = box.scrollHeight;
  if ($('#p-chat').hidden) $('#chatDot').hidden = false;
}
function sys(text) {
  const d = document.createElement('div'); d.className = 'sys'; d.textContent = text;
  const box = $('#msgs'); box.append(d); box.scrollTop = box.scrollHeight;
}
$('#chatForm').onsubmit = e => {
  e.preventDefault();
  const t = $('#chatIn').value.trim();
  if (t) { send({ t: 'chat', text: t }); $('#chatIn').value = ''; }
};
function renderUsers() {
  const u = $('#users'); u.innerHTML = '';
  peers.forEach(p => {
    const s = document.createElement('span'); s.className = 'chip'; s.style.setProperty('--c', p.color);
    s.textContent = p.name + (p.id === uid ? ' (you)' : ''); u.append(s);
  });
}
function cursorEl(id) {
  let el = cursors.get(id);
  if (!el) {
    const p = peers.get(id) || { name: '?', color: '#888' };
    el = document.createElement('div'); el.className = 'cursor'; el.style.setProperty('--c', p.color);
    el.innerHTML = '<span></span>'; el.firstChild.textContent = p.name;
    $('#curs').append(el); cursors.set(id, el);
  }
  return el;
}

/* ---------- network ---------- */
function setStatus(on) {
  const s = $('#status'); s.className = on ? 'on' : 'off';
  s.textContent = on ? 'Live' : 'Offline (drawing solo)';
}
function handle(m) {
  switch (m.t) {
    case 'init':
      ops = m.ops; byId = new Map(ops.map(o => [o.id, o]));
      peers = new Map(m.users.map(u => [u.id, u])); peers.set(uid, { id: uid, name, color: myColor });
      setBg(m.bg, false); $('#msgs').innerHTML = ''; m.chat.forEach(addMsg);
      redraw(); renderUsers(); break;
    case 'join': peers.set(m.user.id, m.user); renderUsers(); sys(m.user.name + ' joined'); break;
    case 'leave': {
      const u = peers.get(m.id); peers.delete(m.id);
      const el = cursors.get(m.id); if (el) el.remove(); cursors.delete(m.id);
      renderUsers(); if (u) sys(u.name + ' left'); break;
    }
    case 'begin': addOp(m.op); renderOp(mc, m.op); break;
    case 'pts': {
      const o = byId.get(m.id); if (!o) break;
      const start = o.pts.length / 2; o.pts.push(...m.pts);
      for (let i = start; i < o.pts.length / 2; i++) seg(mc, o, i);
      break;
    }
    case 'op': addOp(m.op); renderOp(mc, m.op); break;
    case 'rm': removeOp(m.id); break;
    case 'clear': clearAll(); break;
    case 'bg': setBg(m.color, false); break;
    case 'chat': addMsg(m.msg); break;
    case 'cur': {
      const el = cursorEl(m.id); el.style.left = m.x * 100 + '%'; el.style.top = m.y * 100 + '%'; break;
    }
  }
}
function connect() {
  try { ws = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host); }
  catch { setStatus(false); return; }
  ws.onopen = () => { setStatus(true); send({ t: 'join', room, name, uid, color: myColor }); };
  ws.onclose = () => { setStatus(false); setTimeout(connect, 2500); };
  ws.onmessage = e => { try { handle(JSON.parse(e.data)); } catch (err) { console.error(err); } };
}

/* ---------- join dialog & boot ---------- */
const slug = s => s.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 30);
const ls = { get: k => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch { } } };
const params = new URLSearchParams(location.search);
$('#jName').value = ls.get('hd-name') || '';
$('#jRoom').value = slug(params.get('room') || '') || 'room-' + Math.random().toString(36).slice(2, 6);
$('#jColor').value = ls.get('hd-color') || toHex(...hsv2rgb(Math.random() * 360, .75, .95));

function start() {
  name = $('#jName').value.trim() || 'Guest';
  room = slug($('#jRoom').value) || 'lobby';
  myColor = $('#jColor').value;
  ls.set('hd-name', name); ls.set('hd-color', myColor);
  history.replaceState(null, '', '?room=' + encodeURIComponent(room));
  $('#roomLabel').textContent = room;
  $('#join').classList.add('hide');
  peers.set(uid, { id: uid, name, color: myColor }); renderUsers();
  setColor(myColor); setStatus(false); connect(); fit();
}
$('#jGo').onclick = start;
$('#join').addEventListener('keydown', e => { if (e.key === 'Enter') start(); });

drawWheel(); drawRings(); setColor(S.color); updatePrev(); fit();
