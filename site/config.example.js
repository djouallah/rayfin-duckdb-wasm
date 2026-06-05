// Copy this file to `config.js` (same folder) and fill in your own values.
// config.js is gitignored, so your tenant/workspace identifiers stay out of the repo.
window.RAYFIN_WASM_CONFIG = {
  // Entra ID SPA app registration (public client, PKCE — no secret). See README "Setup".
  clientId: "<your-entra-spa-app-client-id>",
  tenantId: "<your-entra-tenant-id>",

  // OneLake base URL where your data.duckdb lives, of the form:
  //   https://onelake.dfs.fabric.microsoft.com/<workspace>/<lakehouse>.Lakehouse/Files
  // The dashboard reads the database from <oneLakeBase>/data/data.duckdb.
  // Set to "" to instead serve a same-origin site/data/data.duckdb (no auth needed).
  oneLakeBase: "https://onelake.dfs.fabric.microsoft.com/<workspace>/<lakehouse>.Lakehouse/Files",
};
