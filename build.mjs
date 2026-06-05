// Static "build" for the Fabric dashboard: publish the contents of site/ to dist/.
// The dashboard is plain HTML + DuckDB-WASM (loaded from CDN) reading a single data.duckdb
// from OneLake (or same-origin when oneLakeBase="") — no bundler, so we just copy site/ -> dist/.
import { rm, cp } from "node:fs/promises";

const dist = new URL("./dist/", import.meta.url);
const site = new URL("./site/", import.meta.url);

await rm(dist, { recursive: true, force: true });
await cp(site, dist, { recursive: true });
console.log("Published site/ -> dist/");
