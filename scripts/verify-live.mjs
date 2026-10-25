import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';
const root = resolve(import.meta.dirname, '..');
const records = join(root, '.release-backups'); await mkdir(records, { recursive: true });
const origin = 'http://127.0.0.1:43127/';
const name = '@local/dsh-fonts-manager';
const after = process.argv.includes('--after');
const before = after ? JSON.parse(await readFile(join(records, 'live-before.json'), 'utf8')) : null;
const source = await readFile(join(root, 'client.js'), 'utf8');
const digest = text => createHash('sha256').update(text).digest('hex');
function discover(value, result = { entries: [], release: null }) {
  if (!value || typeof value !== 'object') return result;
  if (value.release) result.release = value.release;
  if (Object.values(value).includes(name)) result.entries.push(value);
  for (const child of Object.values(value)) if (child && typeof child === 'object') discover(child, result);
  return result;
}
const response = await fetch(new URL('plugins/events', origin), { signal: AbortSignal.timeout(12000) });
if (!response.ok) throw new Error('Host event stream HTTP ' + response.status);
const reader = response.body.getReader(), decoder = new TextDecoder();
let buffer = '', result;
try {
  while (!result) {
    const { value, done } = await reader.read(); if (done) break;
    buffer += decoder.decode(value, { stream: true }).replaceAll('\r\n', '\n');
    let end;
    while ((end = buffer.indexOf('\n\n')) >= 0) {
      const frame = buffer.slice(0, end); buffer = buffer.slice(end + 2);
      const data = frame.split('\n').filter(line => line.startsWith('data:')).map(line => line.slice(5).trim()).join('\n');
      if (!data) continue;
      const event = JSON.parse(data), discovered = discover(event);
      const entry = discovered.entries.find(item => item.url && (item.rev || item.revision));
      if (!entry) { console.log('Host event schema:', Object.keys(event), 'matching entry keys:', discovered.entries.map(item => Object.keys(item))); continue; }
      const revision = entry.rev || entry.revision;
      if (after && revision === before.revision) continue;
      const url = new URL(entry.url, origin);
      if (url.origin !== new URL(origin).origin) throw new Error('Unexpected bundle origin');
      const bundle = await fetch(url); if (!bundle.ok) throw new Error('Bundle HTTP ' + bundle.status);
      const served = await bundle.text();
      const installed = await readFile('/home/andyk/.dsh-local-plugins/dsh-fonts-manager/client.js', 'utf8');
      if (!served.includes(installed.trim())) throw new Error('Served bundle does not contain the installed artifact');
      if (after && installed !== source) throw new Error('Installed artifact differs from workspace build');
      result = { checkedAt: new Date().toISOString(), origin, release: discovered.release, package: name, revision, url: url.href, sourceBytes: Buffer.byteLength(installed), servedBytes: Buffer.byteLength(served), artifactSha256: digest(installed), servedContainsInstalledArtifact: true, matchesWorkspace: installed === source };
      break;
    }
  }
} finally { await reader.cancel(); }
if (!result) throw new Error('No matching live bundle in Host graph');
await writeFile(join(records, after ? 'live-after.json' : 'live-before.json'), JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify(result, null, 2));
