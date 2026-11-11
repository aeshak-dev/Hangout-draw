// Hangout Draw server: serves /public and relays drawing, chat and cursors per room.
const http = require('http'), fs = require('fs'), path = require('path');
const { WebSocketServer } = require('ws');
const root = path.join(__dirname, 'public');
const types = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript' };

const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/') p = '/index.html';
  const f = path.join(root, path.normalize(p));
  if (!f.startsWith(root)) { res.writeHead(403); return res.end('Forbidden'); }
  fs.readFile(f, (err, data) => {
    if (err) { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': (types[path.extname(f)] || 'application/octet-stream') + '; charset=utf-8' });
    res.end(data);
  });
});

const rooms = new Map();
const wss = new WebSocketServer({ server, maxPayload: 1 << 20 });

wss.on('connection', ws => {
  let room, me;
  const bc = (m, skip) => {
    const s = JSON.stringify(m);
    room.users.forEach((_, c) => { if (c !== skip && c.readyState === 1) c.send(s); });
  };
  ws.on('message', raw => {
    let m; try { m = JSON.parse(raw); } catch { return; }
    if (m.t === 'join') {
      const key = String(m.room || 'lobby').slice(0, 30).toLowerCase();
      if (!rooms.has(key)) rooms.set(key, { ops: [], bg: '#ffffff', chat: [], users: new Map() });
      room = rooms.get(key);
      me = { id: String(m.uid).slice(0, 20), name: String(m.name || 'Guest').slice(0, 20), color: String(m.color || '#888888').slice(0, 9) };
      room.users.set(ws, me);
      ws.send(JSON.stringify({ t: 'init', ops: room.ops, bg: room.bg, chat: room.chat, users: [...room.users.values()] }));
      bc({ t: 'join', user: me }, ws);
      return;
    }
    if (!room) return;
    switch (m.t) {
      case 'begin': case 'op':
        if (!m.op || !Array.isArray(m.op.pts)) return;
        room.ops.push(m.op);
        if (room.ops.length > 6000) room.ops.shift();
        bc(m, ws); break;
      case 'pts': {
        const o = room.ops.findLast(o => o.id === m.id);
        if (o && Array.isArray(m.pts)) o.pts.push(...m.pts);
        bc(m, ws); break;
      }
      case 'undo': {
        const i = room.ops.findLastIndex(o => o.uid === me.id);
        if (i >= 0) bc({ t: 'rm', id: room.ops.splice(i, 1)[0].id });
        break;
      }
      case 'clear': room.ops = []; bc({ t: 'clear' }); break;
      case 'bg': room.bg = String(m.color).slice(0, 9); bc({ t: 'bg', color: room.bg }); break;
      case 'chat': {
        const text = String(m.text || '').trim().slice(0, 500);
        if (!text) return;
        const msg = { name: me.name, color: me.color, text, time: Date.now() };
        room.chat = [...room.chat, msg].slice(-100);
        bc({ t: 'chat', msg }); break;
      }
      case 'cur': bc({ t: 'cur', id: me.id, x: +m.x, y: +m.y }, ws); break;
    }
  });
  ws.on('close', () => {
    if (!room || !me) return;
    room.users.delete(ws);
    bc({ t: 'leave', id: me.id });
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Hangout Draw running on http://localhost:${PORT}`));
