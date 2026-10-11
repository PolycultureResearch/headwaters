// Server-rendered pages for signing in and for approving an MCP client.
import type { ConsentDescription } from "@cloudflare/workers-oauth-provider";

export const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);

const shell = (title: string, body: string) => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${escapeHtml(title)}</title>
<style>
  :root { color-scheme: dark; }
  body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #0e1110; color: #e6ebe8;
    font: 15px/1.5 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif; }
  main { width: min(360px, calc(100vw - 48px)); }
  h1 { font-size: 20px; font-weight: 600; margin: 0 0 4px; letter-spacing: -0.01em; }
  p { color: #98a39e; margin: 0 0 20px; }
  p.warn { color: #e0b46a; }
  p.error { color: #e88a7d; }
  strong { color: #e6ebe8; font-weight: 600; }
  input[type=password] { width: 100%; box-sizing: border-box; padding: 10px 12px; margin-bottom: 12px; font: inherit;
    color: inherit; background: #161a18; border: 1px solid #2a312e; border-radius: 8px; }
  input:focus-visible, button:focus-visible { outline: 2px solid #5fb39a; outline-offset: 2px; }
  .actions { display: flex; gap: 8px; }
  button { flex: 1; padding: 10px 12px; font: inherit; font-weight: 600; border-radius: 8px; cursor: pointer;
    border: 1px solid #2a312e; background: #161a18; color: #e6ebe8; }
  button.primary { background: #5fb39a; border-color: #5fb39a; color: #0e1110; }
</style>
</head>
<body><main>${body}</main></body>
</html>`;

const PAGE_HEADERS = {
  "Content-Type": "text/html; charset=utf-8",
  "Cache-Control": "no-store",
  "X-Frame-Options": "DENY",
};

/** `formTargets` are extra places a form on this page may end up, on top of this site itself. */
export function page(title: string, body: string, status = 200, extra?: Headers, formTargets: string[] = []): Response {
  const headers = new Headers(extra);
  for (const [key, value] of Object.entries(PAGE_HEADERS)) headers.set(key, value);
  headers.set(
    "Content-Security-Policy",
    `default-src 'none'; style-src 'unsafe-inline'; form-action ${["'self'", ...formTargets].join(" ")}; frame-ancestors 'none'`,
  );
  return new Response(shell(title, body), { status, headers });
}

/** The CSP source for where an OAuth redirect URI points: its origin, or its scheme for a native app. */
function redirectSource(redirectUri: string): string[] {
  try {
    const url = new URL(redirectUri);
    return [url.origin === "null" ? url.protocol : url.origin];
  } catch {
    return [];
  }
}

export function loginPage(next: string, error?: string, status = 200): Response {
  return page(
    "Sign in to Headwaters",
    `<h1>Headwaters</h1>
<p>Sign in to continue.</p>
${error ? `<p class="error">${escapeHtml(error)}</p>` : ""}
<form method="post" action="/login">
  <input type="hidden" name="next" value="${escapeHtml(next)}">
  <input type="password" name="password" placeholder="Password" autocomplete="current-password" autofocus required>
  <div class="actions"><button class="primary">Sign in</button></div>
</form>`,
    status,
  );
}

export function consentPage(details: ConsentDescription, handle: string, headers: Headers): Response {
  const publisher = details.clientDomain
    ? `Published by <strong>${escapeHtml(details.clientDomain)}</strong>.`
    : "This app registered itself, so its name is not verified.";
  return page(
    "Connect to Headwaters",
    `<h1>Connect ${escapeHtml(details.clientName)}?</h1>
<p>It will be able to read and change everything in Headwaters: leads, contacts, notes and stages.</p>
<p>${publisher} Access will be sent to <strong>${escapeHtml(details.redirectHost)}</strong>.</p>
${details.redirectIsLoopback ? '<p class="warn">This sends access to an app on your computer. Continue only if you just started connecting from it.</p>' : ""}
<form method="post" action="/authorize">
  <input type="hidden" name="handle" value="${escapeHtml(handle)}">
  <div class="actions">
    <button name="decision" value="deny">Cancel</button>
    <button class="primary" name="decision" value="approve">Allow</button>
  </div>
</form>`,
    200,
    headers,
    // Browsers apply form-action to the redirect that follows a submit, and Allow ends in a
    // redirect back to the client. Without this the approval is silently dropped.
    redirectSource(details.redirectUri),
  );
}

export function messagePage(title: string, message: string, status: number): Response {
  return page(title, `<h1>${escapeHtml(title)}</h1><p>${escapeHtml(message)}</p>`, status);
}
