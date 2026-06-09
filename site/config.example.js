// Copy this file to `config.js` (same folder) and fill in your own values.
// config.js is gitignored, so your tenant/workspace identifiers stay out of the repo.
//
// This config selects the AUTH and DATA layers at runtime (see auth.js / data.js), so the same
// dashboard can be published to different platforms by shipping a different config.js.
// For a no-auth static deploy (GitHub Pages, S3, bundled data) start from config.static.example.js.
window.RAYFIN_WASM_CONFIG = {
  // 'msal' = Entra ID sign-in + OneLake bearer token. 'none' = no auth (public/same-origin data).
  // If omitted, inferred: 'msal' when clientId+tenantId are set, otherwise 'none'.
  auth: "msal",

  // Entra ID SPA app registration (public client, PKCE — no secret). See README "Setup". (msal only)
  clientId: "<your-entra-spa-app-client-id>",
  tenantId: "<your-entra-tenant-id>",

  // Base URL where the data lives, of the form:
  //   https://onelake.dfs.fabric.microsoft.com/<workspace>/<lakehouse>.Lakehouse/Files
  // The dashboard reads the database from <dataBaseUrl>/data/<latest>.duckdb (with the bearer token).
  // Set to "" to instead serve a same-origin ./data/data.duckdb (no auth needed).
  // (Legacy alias `oneLakeBase` is still accepted if `dataBaseUrl` is absent.)
  dataBaseUrl: "https://onelake.dfs.fabric.microsoft.com/<workspace>/<lakehouse>.Lakehouse/Files",
};
