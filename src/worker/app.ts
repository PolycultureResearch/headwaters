// Everything a browser talks to: sign-in, the MCP consent step, and the JSON API behind the UI.
import { AuthorizationError, CimdFetchError, type OAuthHelpers } from "@cloudflare/workers-oauth-provider";
import { Hono } from "hono";
import { ZodError } from "zod";
import { checkPassword, clearSessionCookie, hasSession, safeNext, sessionCookie } from "./auth";
import { consentPage, loginPage, messagePage } from "./pages";
import {
  createContactInput,
  createLeadInput,
  createStageInput,
  logContactInput,
  moveLeadInput,
  noteInput,
  reorderStagesInput,
  updateContactInput,
  updateLeadInput,
  updateStageInput,
} from "./schemas";
import { Store, UserError } from "./store";

type AppEnv = { Bindings: Env & { OAUTH_PROVIDER: OAuthHelpers }; Variables: { store: Store } };

const USER_ID = "owner";

export const app = new Hono<AppEnv>();

app.onError((error, c) => {
  if (error instanceof UserError) return c.json({ error: error.message }, 400);
  if (error instanceof ZodError) {
    const message = error.issues.map((issue) => `${issue.path.join(".") || "input"}: ${issue.message}`).join("; ");
    return c.json({ error: message }, 400);
  }
  if (error instanceof SyntaxError) return c.json({ error: "Request body is not valid JSON." }, 400);
  console.error(error);
  return c.json({ error: "Something went wrong." }, 500);
});

// ---- sign-in ----

app.get("/login", async (c) => {
  const next = safeNext(c.req.query("next"));
  if (await hasSession(c.req.raw, c.env)) return c.redirect(next);
  return loginPage(next);
});

app.post("/login", async (c) => {
  const form = await c.req.formData();
  const next = safeNext(String(form.get("next") ?? ""));
  const result = await checkPassword(c.req.raw, c.env, String(form.get("password") ?? ""));
  if (result === "locked") return loginPage(next, "Too many attempts. Try again in 15 minutes.", 429);
  if (result === "wrong") return loginPage(next, "That password is not right.", 401);
  return new Response(null, {
    status: 303,
    headers: { Location: next, "Set-Cookie": await sessionCookie(c.req.raw, c.env) },
  });
});

app.post("/logout", (c) => {
  return new Response(null, { status: 303, headers: { Location: "/login", "Set-Cookie": clearSessionCookie(c.req.raw) } });
});

// ---- connecting an MCP client (Claude and friends) ----

app.on(["GET", "POST"], "/authorize", async (c) => {
  const oauth = c.env.OAUTH_PROVIDER;
  try {
    if (c.req.method === "GET") {
      const request = await oauth.parseAuthRequest(c.req.raw);
      if (!(await hasSession(c.req.raw, c.env))) {
        const url = new URL(c.req.url);
        return c.redirect(`/login?next=${encodeURIComponent(url.pathname + url.search)}`);
      }
      const details = await oauth.describeConsent(request);
      const consent = await oauth.beginConsent(request);
      return consentPage(details, consent.handle, consent.headers);
    }

    if (!(await hasSession(c.req.raw, c.env))) return messagePage("Signed out", "Sign in and start connecting again.", 401);
    const form = await c.req.formData();
    const handle = String(form.get("handle") ?? "");
    if (form.get("decision") !== "approve") {
      const denied = await oauth.denyConsent(c.req.raw, handle);
      return new Response(null, { status: 302, headers: denied.headers });
    }
    const approved = await oauth.approveConsent(c.req.raw, handle);
    const { redirectTo } = await oauth.completeAuthorization({
      request: approved.request,
      userId: USER_ID,
      metadata: {},
      scope: approved.request.scope,
      props: { userId: USER_ID },
    });
    approved.headers.set("Location", redirectTo);
    return new Response(null, { status: 302, headers: approved.headers });
  } catch (error) {
    if (error instanceof AuthorizationError && error.redirectTo) return c.redirect(error.redirectTo, 302);
    if (error instanceof AuthorizationError) return messagePage("Could not connect", error.description, 400);
    if (error instanceof CimdFetchError) return messagePage("Could not connect", "This app could not be verified.", 400);
    throw error;
  }
});

// ---- JSON API for the UI ----

const api = new Hono<AppEnv>();

api.use("*", async (c, next) => {
  if (!(await hasSession(c.req.raw, c.env))) return c.json({ error: "Not signed in." }, 401);
  // Changes must come from this site's own pages, not a form or script on another one.
  if (c.req.method !== "GET" && c.req.header("Origin") !== new URL(c.req.url).origin) {
    return c.json({ error: "Cross-site request refused." }, 403);
  }
  c.set("store", new Store(c.env.DB));
  await next();
});

api.get("/pipeline", async (c) => c.json(await c.var.store.getPipeline()));
api.get("/focus", async (c) => c.json(await c.var.store.getFocus()));
api.get("/funnel", async (c) => c.json(await c.var.store.getFunnel()));

api.post("/leads", async (c) => {
  const { stage, created_at, contacts, ...fields } = createLeadInput.parse(await c.req.json());
  return c.json(await c.var.store.createLead(fields, { stage, created_at, contacts }), 201);
});
api.get("/leads/:id", async (c) => c.json(await c.var.store.getLead(c.req.param("id"))));
api.patch("/leads/:id", async (c) =>
  c.json(await c.var.store.updateLead(c.req.param("id"), updateLeadInput.parse(await c.req.json()))),
);
api.post("/leads/:id/move", async (c) => {
  const { stage, ...options } = moveLeadInput.parse(await c.req.json());
  return c.json(await c.var.store.moveLead(c.req.param("id"), stage, options));
});
api.delete("/leads/:id", async (c) => {
  await c.var.store.archiveLead(c.req.param("id"));
  return c.body(null, 204);
});

api.post("/leads/:id/notes", async (c) => {
  const { body, kind, created_at } = noteInput.parse(await c.req.json());
  return c.json(await c.var.store.addNote(c.req.param("id"), body, kind, created_at), 201);
});
api.post("/leads/:id/contact", async (c) =>
  c.json(await c.var.store.logContact(c.req.param("id"), logContactInput.parse(await c.req.json()))),
);
api.delete("/notes/:id", async (c) => {
  await c.var.store.deleteNote(c.req.param("id"));
  return c.body(null, 204);
});

api.post("/leads/:id/contacts", async (c) =>
  c.json(await c.var.store.addContact(c.req.param("id"), createContactInput.parse(await c.req.json())), 201),
);
api.patch("/contacts/:id", async (c) =>
  c.json(await c.var.store.updateContact(c.req.param("id"), updateContactInput.parse(await c.req.json()))),
);
api.delete("/contacts/:id", async (c) => {
  await c.var.store.deleteContact(c.req.param("id"));
  return c.body(null, 204);
});

api.post("/stages", async (c) => {
  const { before, ...fields } = createStageInput.parse(await c.req.json());
  return c.json(await c.var.store.createStage(fields, before), 201);
});
api.put("/stages/order", async (c) =>
  c.json(await c.var.store.reorderStages(reorderStagesInput.parse(await c.req.json()).order)),
);
api.patch("/stages/:id", async (c) =>
  c.json(await c.var.store.updateStage(c.req.param("id"), updateStageInput.parse(await c.req.json()))),
);
api.delete("/stages/:id", async (c) => {
  await c.var.store.archiveStage(c.req.param("id"));
  return c.body(null, 204);
});

app.route("/api", api);
