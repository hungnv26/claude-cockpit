// Device-emulated screenshot at DPR 2 via the DevTools protocol.
// Usage: node cdp-shot.mjs <out.png> <width> <height> <url>
// Plain `--window-size` won't do: headless Chrome on macOS won't go below
// ~500px wide, which clips the phone layout.
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import fs from 'node:fs'
const WebSocket = createRequire(import.meta.url)('ws')
const CHROME = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const [out, w, h, url] = process.argv.slice(2)
const profile = out + '.profile'
fs.rmSync(profile, { recursive: true, force: true })
const chrome = spawn(CHROME, [
  '--headless=new', '--disable-gpu', '--hide-scrollbars', '--no-first-run',
  `--user-data-dir=${profile}`, '--remote-debugging-port=9333', 'about:blank',
], { stdio: 'ignore' })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let page
for (let i = 0; i < 50 && !page; i++) {
  await sleep(200)
  try { page = (await (await fetch('http://127.0.0.1:9333/json')).json()).find((t) => t.type === 'page') } catch {}
}
const ws = new WebSocket(page.webSocketDebuggerUrl)
await new Promise((r) => ws.once('open', r))
let id = 0
const call = (method, params = {}) => new Promise((resolve) => {
  const n = ++id
  const on = (m) => { const d = JSON.parse(m); if (d.id === n) { ws.off('message', on); resolve(d.result) } }
  ws.on('message', on)
  ws.send(JSON.stringify({ id: n, method, params }))
})
await call('Emulation.setDeviceMetricsOverride', { width: +w, height: +h, deviceScaleFactor: 2, mobile: +w < 768 })
await call('Page.enable')
await call('Page.navigate', { url })
await sleep(5000) // socket connect + first snapshot
const { data } = await call('Page.captureScreenshot', { format: 'png' })
fs.writeFileSync(out, Buffer.from(data, 'base64'))
ws.close(); chrome.kill()
await new Promise((r) => chrome.once('exit', r))
fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5 })
console.log('wrote', out)
