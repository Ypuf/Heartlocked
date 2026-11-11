import { appendFileSync, mkdirSync } from 'node:fs'
import { networkInterfaces } from 'node:os'

const PORT = 9090
const CONTROL_PORT = 9091
const LOG = 'build/debug.log'

mkdirSync('build', { recursive: true })

function log(line: string) {
	console.log(line)
	appendFileSync(LOG, `[${new Date().toISOString()}] ${line}\n`)
}

const CLIENT_JS = `(function () {
  var gen = (globalThis.__debugGen = (globalThis.__debugGen || 0) + 1);
  if (globalThis.__debugWs) try { globalThis.__debugWs.close(); } catch (e) {}
  var ws;
  function fmt(v) {
    if (typeof v === "string") return v;
    if (typeof v === "function") return v.toString().slice(0, 500);
    try { return JSON.stringify(v, null, 1); } catch (e) { return String(v); }
  }
  function send(text) { ws.send(text); }
  function fail(err) { send("!! " + ((err && err.stack) || String(err))); }
  function connect() {
    if (gen !== globalThis.__debugGen) return;
    ws = globalThis.__debugWs = new WebSocket("ws://" + HOST);
    ws.onopen = function () { send("connected"); };
    ws.onmessage = function (e) {
      try {
        Promise.resolve((0, eval)(e.data)).then(function (v) { send("=> " + fmt(v)); }, fail);
      } catch (err) { fail(err); }
    };
    ws.onclose = function () { setTimeout(connect, 3000); };
  }
  connect();
})();`

let phone: Bun.ServerWebSocket<unknown> | undefined

function run(code: string) {
	if (!phone) return false
	log(`> ${code}`)
	phone.send(code)
	return true
}

Bun.serve({
	port: PORT,
	fetch(req, server) {
		if (new URL(req.url).pathname === '/client.js') {
			const host = req.headers.get('host') ?? `localhost:${PORT}`
			return new Response(`var HOST = ${JSON.stringify(host)};\n${CLIENT_JS}`, {
				headers: { 'content-type': 'text/javascript' },
			})
		}
		if (server.upgrade(req)) return
		return new Response('debugger running')
	},
	websocket: {
		idleTimeout: 20,
		open(ws) {
			phone = ws
		},
		close(ws) {
			if (ws !== phone) return
			phone = undefined
			log('phone disconnected')
		},
		message(_, raw) {
			log(`< ${raw}`)
		},
	},
})

Bun.serve({
	port: CONTROL_PORT,
	hostname: '127.0.0.1',
	async fetch(req) {
		const { pathname } = new URL(req.url)
		if (pathname === '/status')
			return new Response(phone ? 'connected' : 'not connected')
		if (pathname === '/eval' && req.method === 'POST')
			return run(await req.text())
				? new Response('sent')
				: new Response("phone isn't connected", { status: 503 })
		return new Response('not found', { status: 404 })
	},
})

const lanIp =
	Object.values(networkInterfaces())
		.flat()
		.find(i => i?.family === 'IPv4' && !i.internal)?.address ?? 'localhost'

log(`debugger listening on :${PORT}, paste this into evaluate javascript:\n`)
console.log(
	`  fetch("http://${lanIp}:${PORT}/client.js").then(r => r.text()).then(eval)\n`,
)

for await (const line of console) {
	if (!line.trim()) continue
	if (!run(line)) console.log("phone isn't connected")
}
