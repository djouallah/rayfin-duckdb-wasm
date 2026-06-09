// =============================================================================
// auth.js — AuthProvider abstraction (presentation/data agnostic)
// =============================================================================
// One interface, two implementations selected by config:
//   'msal' -> Entra ID SPA public client (PKCE), bearer token for OneLake
//   'none' -> no auth at all (plain static hosting, same-origin/public data)
//
// DOM-free: progress is reported through the injected `onStatus` callback so this
// module never touches the page. The dashboard (app.js) owns all UI, including the
// sign-in / "open in tab" gate — it just calls ensureSession()/getHeaders() here.
//
//   const auth = createAuth(cfg, { onStatus });
//   if (await auth.ensureSession(false)) { /* have what we need to fetch data */ }
//   fetch(url, { headers: auth.getHeaders() });
// =============================================================================

const MSAL_ESM = "https://cdn.jsdelivr.net/npm/@azure/msal-browser@3.28.1/+esm";
const OL_SCOPES = ['https://storage.azure.com/user_impersonation'];

// --- No-auth provider: everything is already accessible. ---
function createNoAuth() {
  return {
    mode: 'none',
    async ensureSession() { return true; },
    getHeaders() { return {}; },
    async refresh() { return true; },
  };
}

// --- MSAL provider: Entra SPA public client, OneLake bearer token. ---
// REDIRECT auth (not popup): the coi-serviceworker sets COOP: same-origin to get
// crossOriginIsolated for DuckDB multi-threading, which severs the popup<->opener link once the
// popup bounces through login.microsoftonline.com — so loginPopup can't return the token after the
// session expires. A full-page redirect is COOP-safe. Redirect throws "redirect_in_iframe" inside
// the Fabric portal iframe, but we never auth there (app.js shows "open in tab" instead).
function createMsalAuth(cfg) {
  const MSAL_CONFIG = {
    auth: {
      clientId: cfg.clientId,
      authority: `https://login.microsoftonline.com/${cfg.tenantId}`,
      redirectUri: window.location.origin,
    },
    cache: { cacheLocation: 'localStorage' },
  };

  let _msalApp = null;
  let _token = null;

  // Lazy-load msal-browser only when this provider is actually used, so a no-auth
  // deploy never fetches it.
  async function initMsal() {
    if (_msalApp) return;
    const msal = await import(MSAL_ESM);
    _msalApp = new msal.PublicClientApplication(MSAL_CONFIG);
    await _msalApp.initialize();
    // Process a redirect response if we're returning from acquireTokenRedirect.
    const resp = await _msalApp.handleRedirectPromise();
    if (resp && resp.account) {
      _msalApp.setActiveAccount(resp.account);
      _token = resp.accessToken;
    }
    const acct = _msalApp.getActiveAccount() || _msalApp.getAllAccounts()[0];
    if (acct) _msalApp.setActiveAccount(acct);
  }

  // Acquire a OneLake token. interactive=true navigates the whole tab to Microsoft and back.
  // Returns true if we now hold a token, false if interactive sign-in is still needed (or has
  // been kicked off — acquireTokenRedirect navigates away and never resolves).
  async function acquire(interactive) {
    await initMsal();
    if (_token) return true;   // already set by handleRedirectPromise
    const account = _msalApp.getActiveAccount();
    if (account) {
      try {
        _token = (await _msalApp.acquireTokenSilent({ scopes: OL_SCOPES, account })).accessToken;
        return true;
      } catch (e) { /* fall through */ }
    }
    try {
      const r = await _msalApp.ssoSilent({ scopes: OL_SCOPES });
      _msalApp.setActiveAccount(r.account);
      _token = r.accessToken;
      return true;
    } catch (e) { /* no usable session -> need interaction */ }
    if (!interactive) return false;
    await _msalApp.acquireTokenRedirect({ scopes: OL_SCOPES });   // navigates away
    return false;
  }

  return {
    mode: 'msal',
    ensureSession(interactive) { return acquire(interactive); },
    getHeaders() { return _token ? { Authorization: 'Bearer ' + _token } : {}; },
    async refresh() {
      try { return await acquire(false); } catch (e) { return false; }
    },
    // Let the data layer drop a stale token before falling back to local data.
    _clearToken() { _token = null; },
  };
}

// Pick the provider. Explicit cfg.auth wins; otherwise infer from whether MSAL
// identifiers are present (keeps old configs working without an `auth` field).
export function createAuth(cfg = {}, { onStatus } = {}) {
  const mode = cfg.auth || ((cfg.clientId && cfg.tenantId) ? 'msal' : 'none');
  if (mode === 'msal') {
    if (!cfg.clientId || !cfg.tenantId) {
      console.warn('[auth] msal mode but clientId/tenantId missing in config.js');
    }
    return createMsalAuth(cfg);
  }
  return createNoAuth();
}
