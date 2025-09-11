// Mini-server SSE para "push" de QR por cajero
const express = require('express');
const cors = require('cors');

const app = express();

// ===== Config por ENV =====
const PORT = process.env.PORT || 8080;
// Dominio que mostrará la pantalla (para CORS). Usá "*" si estás probando.
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || "*";
// Token opcional para proteger /notify (poné uno en Railway y usalo desde n8n)
const AUTH_TOKEN = process.env.AUTH_TOKEN || null;

// ===== Middlewares =====
app.use(express.json());
app.use(cors({
  origin: ALLOWED_ORIGIN === "*" ? true : ALLOWED_ORIGIN,
  credentials: false
}));

// ===== Estado de clientes conectados (por cajero) =====
const clients = new Map(); // Map<cajeroId, Set<res>>

// ===== SSE: suscripción de la pantalla =====
app.get('/events', (req, res) => {
  const cajero = (req.query.cajero || 'DEFAULT').toString();

  // cabeceras SSE
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-store',
    'Connection': 'keep-alive',
    'Access-Control-Allow-Origin': ALLOWED_ORIGIN === "*" ? "*" : ALLOWED_ORIGIN,
  });
  res.write(': connected\n\n'); // comentario inicial

  if (!clients.has(cajero)) clients.set(cajero, new Set());
  const set = clients.get(cajero);
  set.add(res);

  req.on('close', () => {
    set.delete(res);
    if (set.size === 0) clients.delete(cajero);
  });
});

// ===== Endpoint de notificación desde n8n =====
app.post('/notify', (req, res) => {
  // Autenticación simple por token (opcional)
  if (AUTH_TOKEN) {
    const auth = req.get('authorization') || '';
    if (auth !== `Bearer ${AUTH_TOKEN}`) {
      return res.status(401).json({ ok: false, error: 'unauthorized' });
    }
  }

  const cajero = (req.body.cajero || 'DEFAULT').toString();
  const qr_url = (req.body.qr_url || '').toString();

  const payload = JSON.stringify({ qr_url });

  const set = clients.get(cajero);
  let delivered = 0;
  if (set && set.size) {
    for (const client of set) {
      client.write(`event: qr\n`);
      client.write(`data: ${payload}\n\n`);
      delivered++;
    }
  }
  return res.json({ ok: true, delivered });
});

// Salud
app.get('/healthz', (_req, res) => res.json({ ok: true }));

app.listen(PORT, () => {
  console.log(`SSE server listening on :${PORT}`);
  console.log(`Allowed origin: ${ALLOWED_ORIGIN}`);
});
