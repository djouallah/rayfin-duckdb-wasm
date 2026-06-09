// =============================================================================
// data.js — DataSource: bring up DuckDB-WASM with `db` attached
// =============================================================================
// Platform-agnostic data loading. Given an AuthProvider (auth.js) and config, it:
//   1. instantiates DuckDB-WASM,
//   2. resolves the latest .duckdb file (OneLake `latest.txt` pointer, if any),
//   3. fetches + OPFS-caches it (conditional GET via ETag), carrying auth headers,
//   4. ATTACHes it as `db` (READ_ONLY).
//
// Base-URL precedence: cfg.dataBaseUrl ?? cfg.oneLakeBase ?? ''.
//   non-empty -> fetch `<base>/data/<file>.duckdb` with auth headers (OneLake).
//   ''        -> same-origin `./data/data.duckdb`, no auth (bundled / public static host).
//
// Contract: after init(), schema `db` exists with
//   fct_summary(date,time,DUID,mw,price,cutoff), dim_duid(...), dim_calendar(...).
//
// DOM-free: progress is reported through the injected `onStatus` callback.
// =============================================================================

import * as duckdb from "https://cdn.jsdelivr.net/npm/@duckdb/duckdb-wasm@1.32.0/+esm";

export function createDataSource(cfg = {}, auth, { onStatus = () => {} } = {}) {
  const baseUrl = cfg.dataBaseUrl ?? cfg.oneLakeBase ?? '';

  // Cache a remote .duckdb file in OPFS using the file's ETag for freshness.
  // OneLake honors conditional GETs, so on every load we send If-None-Match:
  //   304 -> file unchanged, use the OPFS copy (no download)
  //   200 -> file changed (or first load) -> download + store new ETag
  // => a plain refresh automatically picks up new data; no manual versioning.
  // source: 'opfs-hit' | 'opfs-miss' | 'opfs-refresh'
  async function cacheInOPFS(db, url, filename) {
    const root = await navigator.storage.getDirectory();
    const etagKey = `opfs_etag_${filename}`;
    const cachedEtag = localStorage.getItem(etagKey);

    const doFetch = (conditional) => {
      const headers = auth.getHeaders();
      if (conditional && cachedEtag) headers['If-None-Match'] = cachedEtag;
      return fetch(url, { headers });
    };

    onStatus("Checking for updates...");
    let resp = await doFetch(true);
    if (resp.status === 401) { await auth.refresh(); resp = await doFetch(true); }

    // Unchanged -> reuse the OPFS copy.
    if (resp.status === 304) {
      try {
        const handle = await root.getFileHandle(filename);
        const file = await handle.getFile();
        console.log(`[OPFS] ${filename} unchanged (304), using cache (${(file.size/1048576).toFixed(1)} MB)`);
        await db.registerFileBuffer(filename, new Uint8Array(await file.arrayBuffer()));
        return { source: 'opfs-hit' };
      } catch (e) {
        console.log(`[OPFS] 304 but no OPFS copy for ${filename}, re-downloading`);
        resp = await doFetch(false); // unconditional
        if (resp.status === 401) { await auth.refresh(); resp = await doFetch(false); }
      }
    }

    if (!resp.ok) throw new Error(`Failed to fetch ${filename}: HTTP ${resp.status}`);
    onStatus("Downloading database...");
    const buffer = new Uint8Array(await resp.arrayBuffer());
    if (buffer.byteLength < 100) throw new Error(`${filename} is too small (${buffer.byteLength} bytes), likely not a valid database`);
    const sizeMB = (buffer.byteLength / 1024 / 1024).toFixed(1);

    const handle = await root.getFileHandle(filename, { create: true });
    const writable = await handle.createWritable();
    await writable.write(buffer);
    await writable.close();
    const newEtag = resp.headers.get('ETag');
    if (newEtag) localStorage.setItem(etagKey, newEtag); else localStorage.removeItem(etagKey);
    console.log(`[OPFS] Downloaded ${filename} (${sizeMB} MB)`);

    await db.registerFileBuffer(filename, buffer);
    return { source: cachedEtag ? 'opfs-refresh' : 'opfs-miss' };
  }

  // Resolve the moving `latest.txt` pointer to a concrete db filename. Same-origin
  // (no baseUrl) has no pointer — always 'data.duckdb'.
  async function resolveLatestDuckDB() {
    if (!baseUrl) return 'data.duckdb';
    try {
      // no-store: latest.txt is a moving pointer; a cached copy would resolve to a stale db
      // filename and the dashboard would never pick up a fresh import.
      const fetchLatest = () => fetch(`${baseUrl}/data/latest.txt`, { headers: auth.getHeaders(), cache: 'no-store' });
      let resp = await fetchLatest();
      if (resp.status === 401) { await auth.refresh(); resp = await fetchLatest(); }
      if (!resp.ok) return 'data.duckdb';
      const fname = (await resp.text()).trim();
      console.log(`[data] latest db: ${fname}`);
      return fname || 'data.duckdb';
    } catch (e) {
      console.warn('[data] latest.txt read failed:', e.message);
      return 'data.duckdb';
    }
  }

  async function evictOldDuckDBs(keep) {
    const root = await navigator.storage.getDirectory();
    for await (const [name] of root.entries()) {
      if (/^data.*\.duckdb$/.test(name) && name !== keep) {
        await root.removeEntry(name).catch(() => {});
      }
    }
  }

  async function init() {
    onStatus("Loading DuckDB WASM...");
    const JSDELIVR_BUNDLES = duckdb.getJsDelivrBundles();
    const bundle = await duckdb.selectBundle(JSDELIVR_BUNDLES);
    const workerUrl = URL.createObjectURL(
      new Blob([`importScripts("${bundle.mainWorker}");`], { type: "text/javascript" })
    );
    const worker = new Worker(workerUrl);
    const logger = new duckdb.ConsoleLogger();
    const db = new duckdb.AsyncDuckDB(logger, worker);
    await db.instantiate(bundle.mainModule, bundle.pthreadWorker);
    URL.revokeObjectURL(workerUrl);

    const conn = await db.connect();

    let dbResult, dbFile;
    try {
      dbFile = await resolveLatestDuckDB();
      const url = baseUrl ? `${baseUrl}/data/${dbFile}` : './data/data.duckdb';
      dbResult = await cacheInOPFS(db, url, dbFile);
      await evictOldDuckDBs(dbFile);
    } catch (e) {
      // OneLake unreachable (offline, token, CORS) -> fall back to a same-origin bundled copy.
      console.warn('[data] remote fetch failed, falling back to local data.duckdb:', e.message);
      onStatus('Data source unavailable, loading local data…');
      auth._clearToken?.();
      dbFile = 'data.duckdb';
      dbResult = await cacheInOPFS(db, './data/data.duckdb', 'data.duckdb');
    }
    await conn.query(`ATTACH '${dbFile}' AS db (READ_ONLY);`);
    await conn.query("SET preserve_insertion_order = false;");

    const sourceLabel = { 'opfs-hit': 'cached', 'opfs-miss': 'downloaded', 'opfs-refresh': 'refreshed' };
    console.log(`[OPFS] ${dbFile}: ${sourceLabel[dbResult.source]}`);
    console.log(`[DuckDB] crossOriginIsolated: ${window.crossOriginIsolated} (${window.crossOriginIsolated ? 'multi-threaded' : 'single-threaded'})`);

    return { db, conn };
  }

  return { init };
}
