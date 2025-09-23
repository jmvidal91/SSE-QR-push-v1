const express = require('express'); 
const cors = require('cors');
const app = express();

const PORT = process.env.PORT || 8080;
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || "*";
const AUTH_TOKEN = process.env.AUTH_TOKEN || null;

app.use(express.json());
app.use(cors({ origin: ALLOWED_ORIGIN === "*" ? true : ALLOWED_ORIGIN }));

// Map<cajeroId, Set<{res: ServerResponse, ping: NodeJS.Timer}>>
const clients = new Map();

const norm = (x) => (x || 'DEFAULT').toString().trim().toUpperCase();

/**
 * Conexión SSE de los clientes
 */
app.get('/events', (req, res) => {
  const cajero = norm(req.query.cajero);
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-store',
    'Connection': 'keep-alive',
    'Access-Control-Allow-Origin': ALLOWED_ORIGIN === "*" ? "*" : ALLOWED_ORIGIN,
    'X-Accel-Buffering': 'no' // evita buffering en proxies
  });
  res.write(': connected\n\n');

  const ping = setInterval(() => {
    res.write(`: ping ${Date.now()}\n\n`);
  }, 25000);

  if (!clients.has(cajero)) clients.set(cajero, new Set());
  const bucket = clients.get(cajero);
  const entry = { res, ping };
  bucket.add(entry);

  req.on('close', () => {
    clearInterval(ping);
    bucket.delete(entry);
    if (bucket.size === 0) clients.delete(cajero);
  });
});

/**
 * Endpoint para push desde n8n
 * Soporta:
 * - { cajero, qr_url } -> evento "qr"
 * - { cajero, type: "monitor_update" } -> evento "monitor" (trigger)
 */
app.post('/notify', (req, res) => {
  if (AUTH_TOKEN) {
    const auth = req.get('authorization') || '';
    if (auth !== `Bearer ${AUTH_TOKEN}`) {
      return res.status(401).json({ ok: false, error: 'unauthorized' });
    }
  }

  const cajero = norm(req.body.cajero);

  let eventName = "qr";
  let payload = {};

  if (req.body.qr_url) {
    // Caso QR
    payload = { qr_url: req.body.qr_url.toString() };
    eventName = "qr";
  } else if (req.body.type === "monitor_update") {
    // Caso monitor (trigger)
    payload = { type: "monitor_update" };
    eventName = "monitor";
  } else {
    return res.status(400).json({ ok: false, error: 'invalid payload' });
  }

  const bucket = clients.get(cajero);
  let delivered = 0;
  if (bucket && bucket.size) {
    for (const { res: r } of bucket) {
      r.write(`event: ${eventName}\n`);
      r.write(`data: ${JSON.stringify(payload)}\n\n`);
      delivered++;
    }
  }

  res.json({ 
    ok: true, 
    delivered, 
    listeners: bucket ? bucket.size : 0, 
    room: cajero, 
    event: eventName 
  });
});

/**
 * Estado de clientes conectados
 */
app.get('/clients', (_req, res) => {
  const out = {};
  for (const [k, set] of clients) out[k] = set.size;
  res.json(out);
});

app.get('/healthz', (_req, res) => res.json({ ok: true }));

app.listen(PORT, () => {
  console.log(`SSE server listening on :${PORT}`);
});
