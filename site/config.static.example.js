// No-auth static-hosting config. Copy to `config.js` to publish the dashboard to any plain static
// host (GitHub Pages, S3, Netlify, or rayfin static hosting with bundled data) — no sign-in.
//
// Requirements: ship a `data/data.duckdb` next to index.html (the build already includes
// site/data/data.duckdb). The dashboard loads it same-origin with no token.
window.RAYFIN_WASM_CONFIG = {
  auth: "none",
  // "" => same-origin ./data/data.duckdb. Or point at a public URL serving /data/data.duckdb
  // (CORS must allow it), e.g. "https://example.github.io/myrepo".
  dataBaseUrl: "",
};
