import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { webcrypto } from 'node:crypto';
import { runInNewContext } from 'node:vm';
import { expect, it, vi } from 'vitest';
import { GET } from '../app/pwa-release.js/route';

const html = readFileSync('public/offline.html', 'utf8');
const origin = 'https://example.test';
const url = `${origin}/offline.html`;
function response(body = html, status = 200, type = 'text/html') {
  return new Response(body, { status, headers: { 'content-type': type } });
}
function worker() {
  type Event = { data?: string; request?: unknown; waitUntil?: (p: Promise<unknown>) => void; respondWith?: (p: Promise<unknown>) => void };
  const listeners: Record<string, (event: Event) => void> = {};
  const clients = [{ url: origin + '/retailer/home', postMessage: vi.fn() }, { url: origin + '/retailer/checkout', postMessage: vi.fn() }];
  const store = { put: vi.fn(), match: vi.fn() };
  const fetch = vi.fn(), remove = vi.fn(), skipWaiting = vi.fn(), claim = vi.fn();
  const open = vi.fn(async () => store);
  runInNewContext(readFileSync('public/sw.js','utf8'), {
    self: { location: { origin }, MAHA_RELEASE: 'release', skipWaiting, clients: { claim, matchAll: async () => clients }, addEventListener: (k: string,f: (e: Event) => void) => { listeners[k] = f; } },
    crypto: webcrypto, URL, Response, fetch, caches: { open, keys: async () => ['mt-static-v3-release','mt-static-v2','unrelated'], delete: remove },
  });
  async function fire(k: string, event: Event = {}) {
    let pending: Promise<unknown> | undefined;
    listeners[k]!({ waitUntil: p => { pending = p; }, respondWith: p => { pending = p; }, ...event });
    return await pending;
  }
  return { fire, fetch, remove, open, store, clients, skipWaiting, claim };
}
it('publishes only the artifact label, with revalidation', async () => {
  const res = GET(); expect(res.headers.get('cache-control')).toBe('no-store');
  expect(await res.text()).toMatch(/^self\.MAHA_RELEASE = "[\d.]+-(?:[a-f\d]{32}|development)";$/);
});
it('different local builds of one commit mint distinct labels stable within each build', () => {
  const build = () => execFileSync(process.execPath,['--input-type=module','-e',"import c from './next.config.mjs'; if(c.generateBuildId()!==c.env.MAHA_WEB_BUILD_LABEL)process.exit(1);console.log(c.generateBuildId())"],{env:{...process.env,VERCEL_GIT_COMMIT_SHA:'a'.repeat(40),VERCEL_DEPLOYMENT_ID:''}}).toString().trim();
  const first = build(); expect(first).toMatch(/^[a-f0-9]{32}$/); expect(build()).not.toBe(first);
});
it('home request never takes over another checkout, even after a ready snapshot; cleanup waits for closure',async()=>{
  const w = worker();
  await w.fire('message',{data:'CHECK_UPDATE_READINESS'});
  for(const client of w.clients) expect(client.postMessage).toHaveBeenCalledWith({type:'UPDATE_PENDING',openWindows:2});
  await w.fire('message',{data:'APPLY_UPDATE'}); // legacy registrar
  await w.fire('activate'); expect(w.remove).not.toHaveBeenCalled();
  w.clients[1]!.url = origin+'/retailer/orders/confirmation';
  w.clients.shift(); // requestor closed unexpectedly; no remembered quorum
  await w.fire('message',{data:'CHECK_UPDATE_READINESS'});
  expect(w.clients[0]!.postMessage).toHaveBeenLastCalledWith({type:'UPDATE_PENDING',openWindows:1});
  w.clients[0]!.url = origin+'/retailer/home';
  await w.fire('activate'); expect(w.remove).not.toHaveBeenCalled();
  w.clients.pop(); await w.fire('activate');
  expect(w.remove.mock.calls).toEqual([['mt-static-v2']]); expect(w.skipWaiting).not.toHaveBeenCalled(); expect(w.claim).not.toHaveBeenCalled();
});
it.each(['redirect','wrong URL','wrong MIME','HTTP failure','personalised HTML','valid static HTML'])('offline precache: %s',async scenario=>{
  const w = worker(); const res = response(scenario==='personalised HTML' ? html+'private' : html,scenario==='HTTP failure'?503:200,scenario==='wrong MIME'?'application/json':'text/html');
  Object.defineProperties(res,{url:{value:scenario==='wrong URL'?origin+'/login':url},redirected:{value:scenario==='redirect'}});
  w.fetch.mockResolvedValue(res);
  if(scenario==='valid static HTML') { await w.fire('install'); expect(w.open).toHaveBeenCalledWith('mt-static-v3-release');expect(await w.store.put.mock.calls[0]?.[1].text()).toBe(html); }
  else { await expect(w.fire('install')).rejects.toThrow(); expect(w.store.put).not.toHaveBeenCalled(); }
  expect(w.fetch).toHaveBeenCalledWith(url,{credentials:'omit',redirect:'error',cache:'no-store'});
  expect(w.skipWaiting).not.toHaveBeenCalled();
});
it('offline miss returns honest 503 without consulting other caches',async()=>{
  const w=worker();w.fetch.mockRejectedValue(Error('offline'));
  const result=await w.fire('fetch',{request:{method:'GET',url:origin+'/retailer/orders',mode:'navigate'}}) as Response;
  expect(result.status).toBe(503);expect(await result.text()).toContain('offline');expect(w.open.mock.calls).toEqual([['mt-static-v3-release']]);
});
