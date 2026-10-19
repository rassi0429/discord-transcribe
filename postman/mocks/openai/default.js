const http = require('http');
http.createServer((req, res) => {
  if (req.method !== 'POST' || req.url !== '/v1/chat/completions') { res.writeHead(501).end(); return; }
  const body = req.body;
  if (!body || !body.model || !Array.isArray(body.messages) || body.messages[1]?.role !== 'user') { res.writeHead(400).end(JSON.stringify({ error: { message: 'Invalid request' } })); return; }
  if (body.messages[1].content === '失敗') { res.writeHead(429).end(JSON.stringify({ error: { message: 'rate limit', type: 'rate_limit_error' } })); return; }
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify({ id: 'chatcmpl-fixture', object: 'chat.completion', created: 1, model: body.model, choices: [{ index: 0, message: { role: 'assistant', content: 'Hello, everyone.' }, finish_reason: 'stop' }] }));
}).listen(process.env.PORT);
