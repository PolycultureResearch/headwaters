import { OAuthProvider } from "@cloudflare/workers-oauth-provider";
import { createMcpHandler } from "agents/mcp/server";
import { app } from "./app";
import { createServer } from "./mcp";
import { Users } from "./users";

const mcpHandler = {
  async fetch(request: Request, env: Env, ctx: ExecutionContext) {
    // The connection belongs to whoever approved it, and stops working when they are removed.
    const { userId } = (ctx as ExecutionContext & { props?: { userId?: string } }).props ?? {};
    const user = userId ? await new Users(env.DB).get(userId) : null;
    if (!user) return Response.json({ error: "This connection's user no longer has access." }, { status: 401 });
    return createMcpHandler(() => createServer(env, user.id), {
      route: "/mcp",
      // A custom domain is not covered by the handler's built-in localhost and workers.dev allowance.
      allowedHostnames: [new URL(request.url).hostname],
    })(request, env, ctx);
  },
};

// The OAuth resource is this deployment's own /mcp URL, so one provider is built per origin served.
const providers = new Map<string, OAuthProvider<Env>>();

function providerFor(origin: string): OAuthProvider<Env> {
  let provider = providers.get(origin);
  if (!provider) {
    provider = new OAuthProvider<Env>({
      apiRoute: "/mcp",
      apiHandler: mcpHandler,
      defaultHandler: app as unknown as ExportedHandler<Env>,
      authorizeEndpoint: "/authorize",
      tokenEndpoint: "/oauth/token",
      clientRegistrationEndpoint: "/oauth/register",
      clientIdMetadataDocumentEnabled: true,
      resourceMetadata: { resource: `${origin}/mcp`, authorization_servers: [origin] },
    });
    providers.set(origin, provider);
  }
  return provider;
}

export default {
  fetch(request, env, ctx) {
    return providerFor(new URL(request.url).origin).fetch(request, env, ctx);
  },
} satisfies ExportedHandler<Env>;
