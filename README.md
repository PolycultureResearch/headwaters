# Headwaters

A bespoke CRM and lead tracker for Polyculture Research.

Headwaters tracks companies as they move from lead to client. It is built around three questions: where is every lead, what has to happen for each one to move on, and where should today's effort go. It also records every stage change, so over time it can say how many leads it takes to win a client and how long each step takes.

There are two ways in:

- **A web UI** centred on a kanban board, with a focus list and a funnel view.
- **An MCP server**, so Claude (or another assistant that speaks MCP) can research companies, add leads, attach notes and contacts, and move leads between stages.

## How it is built

One Cloudflare Worker serves everything.

| Part | Where | Notes |
| --- | --- | --- |
| UI | `src/client` | React, built with Vite, served as static assets |
| API | `src/worker/app.ts` | Hono, JSON under `/api` |
| MCP server | `src/worker/mcp.ts` | Streamable HTTP at `/mcp`, behind OAuth |
| Data access | `src/worker/store.ts` | Shared by the API and the MCP tools |
| Database | `migrations/` | Cloudflare D1 (SQLite) |
| OAuth state | KV namespace `OAUTH_KV` | Tokens and grants for MCP clients |

Stages are rows in the database, not code. Each has a name, a kind (pipeline step, won, dormant or lost), exit criteria, a default next action, and a number of days after which a lead sitting in it is flagged. Edit them from **Stages** in the UI or with the `create_stage` and `update_stage` tools.

Every lead also tracks when it was last in touch. Logging a meeting, call or email note updates it, as does **Contacted today** on the lead. Give a lead a check-in interval (say 90 days) and it shows up as due for a check-in that long after the last contact, whatever stage it is in.

Each lead has an origin: where it came from, as a short channel such as "Community" or "Own research", plus a detail line for the specifics. The funnel view splits the pipeline by origin, to show which sources of leads go furthest.

Sign-in is a single password, for a single user.

## Run it locally

```sh
npm install
cp .dev.vars.example .dev.vars   # then set a password and a random session secret
npm run db:migrate:local
npm run dev
```

Open http://localhost:5173 and sign in with the password from `.dev.vars`.

## Deploy to Cloudflare

```sh
npx wrangler login
npx wrangler d1 create headwaters             # copy the database_id into wrangler.jsonc
npx wrangler kv namespace create OAUTH_KV     # copy the id into wrangler.jsonc
npm run db:migrate
npx wrangler secret put ADMIN_PASSWORD        # a long password; it guards all your pipeline data
npx wrangler secret put SESSION_SECRET        # any long random string, e.g. from `openssl rand -hex 32`
npm run deploy
```

The deploy prints the URL, something like `https://headwaters.<your-subdomain>.workers.dev`. To use your own domain, add a custom domain to the Worker in the Cloudflare dashboard.

## Connect Claude

1. In Claude, open **Settings → Connectors → Add custom connector**.
2. Enter `https://<your-headwaters-url>/mcp`.
3. Claude opens Headwaters to ask for access. Sign in with your password and choose **Allow**.

To have Claude research companies in a consistent way, upload `skills/research-lead` as a skill (Settings → Capabilities → Skills). Edit the "Who Polyculture Research is looking for" section first; it drives the fit rating.

To keep last-contact dates current from your inbox, also enable Claude's Gmail connector and upload `skills/sync-contact-log`. Then "sync my email with Headwaters" logs the latest exchange with each lead.

Then try:

> Libro.fm looks like a good product and it is a certified B Corp. Research it, assess whether it is a fit, and add it to Headwaters with a briefing and the best contacts.

> I just had a meeting with Libro.fm. They want to move product analytics off Segment. We set a follow-up for next Wednesday.

## MCP tools

| Tool | What it does |
| --- | --- |
| `get_pipeline` | Stages and the leads in them, optionally filtered, plus the lead origins in use |
| `get_lead` | One lead in full: fields, briefing, contacts, notes, history |
| `get_focus` | Leads that need work, most pressing first |
| `get_funnel` | Conversion rate and median days per stage, leads per win, and the funnel split by lead origin |
| `create_lead` | Add a company, with briefing, attributes and contacts in one call |
| `update_lead` | Change fields on a lead |
| `move_lead` | Move a lead to another stage and record why |
| `add_note` | Attach a note, meeting, call or email summary |
| `log_contact` | Record that contact happened, updating the last-contact date |
| `list_contacts` | Everyone on every lead, with email addresses, for matching against email |
| `add_contact`, `update_contact` | Manage people on a lead |
| `create_stage`, `update_stage` | Change the pipeline itself |

## Development

```sh
npm run typecheck
npm run build
```

Schema changes go in a new file under `migrations/`; never edit one that has been applied.
