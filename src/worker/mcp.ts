// The MCP server: the same pipeline the UI shows, as tools a chat assistant can call.
import { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import type { LeadDetail, LeadSummary } from "../shared/types";
import {
  createContactInput,
  createLeadInput,
  createStageInput,
  logContactInput,
  moveLeadInput,
  noteInput,
  updateContactInput,
  updateLeadInput,
  updateStageInput,
} from "./schemas";
import { Store, UserError } from "./store";

const INSTRUCTIONS = `Headwaters is the lead pipeline for Polyculture Research. Each lead is a company moving through stages towards becoming a client.

Working conventions:
- Call get_pipeline first if you do not know the current stages or whether a company is already tracked. Stages are configurable, so never assume their names.
- Refer to a lead by its name or id. Names match case-insensitively and partial names work when unambiguous.
- Each stage has exit_criteria: what must be true for a lead to move on. When you move a lead, also set next_action (and next_action_due when there is a date) to the concrete thing that satisfies the new stage's exit criteria. A lead with no next_action shows the stage's default.
- Record what happened with add_note (kind "meeting", "call" or "email" when it was one). Put durable company facts in the structured fields with update_lead, not only in notes.
- Research goes in the lead's briefing (Markdown), with the structured fields (headcount, annual_revenue_usd, location, industry, certifications, data_stack, fit) filled from it. Leave a field out when you could not find it; do not guess silently.
- Moving a lead to a dormant stage should come with follow_up_on.
- Every lead tracks last_contact_at. add_note with kind meeting, call or email updates it; use log_contact when contact happened but there is nothing more to record, or when syncing from email. Set check_in_days on a lead to have it resurface that many days after the last contact, in any stage.
- Every lead should have an origin: where it came from, as a short reusable channel (get_pipeline lists the origins in use), with origin_detail for the specifics. Ask if you are adding a lead and do not know. get_funnel compares origins.`;

const lead = z.string().describe("The lead's name or id");

type ToolResult = { content: { type: "text"; text: string }[]; isError?: boolean };

const reply = (data: unknown): ToolResult => ({
  content: [{ type: "text", text: typeof data === "string" ? data : JSON.stringify(data, null, 2) }],
});

/** Runs a tool body, turning mistakes the caller can fix into a readable tool error. */
async function run(body: () => Promise<unknown>): Promise<ToolResult> {
  try {
    return reply(await body());
  } catch (error) {
    if (error instanceof UserError) return { ...reply(error.message), isError: true };
    throw error;
  }
}

/** The board view of a lead: enough to decide what to do, without the long text. */
function brief(leadSummary: LeadSummary, stageName: (id: string) => string) {
  const { stage_id, effective_next_action, next_action, created_at, updated_at, stage_entered_at, ...rest } = leadSummary;
  return { ...rest, stage: stageName(stage_id), next_action: effective_next_action, next_action_is_stage_default: !next_action };
}

async function detail(store: Store, value: LeadDetail) {
  const stages = await store.listStages();
  const stage = stages.find((s) => s.id === value.stage_id);
  return { ...value, stage: stage?.name, stage_exit_criteria: stage?.exit_criteria ?? null };
}

/** `userId` is whoever approved this connection; what the assistant does is recorded as theirs. */
export function createServer(env: Env, userId: string): McpServer {
  const store = new Store(env.DB, userId);
  const server = new McpServer({ name: "headwaters", version: "0.1.0" }, { instructions: INSTRUCTIONS });
  const readOnly = { readOnlyHint: true };

  server.registerTool(
    "get_pipeline",
    {
      title: "Get pipeline",
      description:
        "The whole board: every stage (with its exit criteria) and the leads in it, with time in stage, next action and whether each needs attention. Also lists the lead origins in use. Optionally filter by stage or search text.",
      inputSchema: {
        stage: z.string().optional().describe("Only leads in this stage (name or id)"),
        query: z.string().optional().describe("Only leads whose name, industry, location, origin or certifications contain this text"),
      },
      annotations: readOnly,
    },
    ({ stage, query }) =>
      run(async () => {
        const { stages, leads, origins } = await store.getPipeline();
        const stageId = stage ? (await store.resolveStage(stage)).id : null;
        const needle = query?.trim().toLowerCase();
        const name = (id: string) => stages.find((s) => s.id === id)?.name ?? id;
        const matches = leads.filter((l) => {
          if (stageId && l.stage_id !== stageId) return false;
          if (!needle) return true;
          return [l.name, l.industry, l.location, l.summary, l.origin, l.origin_detail, ...l.certifications, ...l.data_stack]
            .filter(Boolean)
            .some((value) => value!.toLowerCase().includes(needle));
        });
        return { stages, origins, leads: matches.map((l) => brief(l, name)) };
      }),
  );

  server.registerTool(
    "get_lead",
    {
      title: "Get lead",
      description: "Everything about one lead: structured fields, briefing, contacts, notes and stage history.",
      inputSchema: { lead },
      annotations: readOnly,
    },
    ({ lead }) => run(async () => detail(store, await store.getLead(lead))),
  );

  server.registerTool(
    "get_focus",
    {
      title: "Get focus list",
      description:
        "The leads that need work, most pressing first: next actions due, dormant leads whose follow-up date has arrived, leads due a check-in, leads gone stale in their stage, then the rest of the open pipeline by priority and stage.",
      inputSchema: {},
      annotations: readOnly,
    },
    () =>
      run(async () => {
        const stages = await store.listStages();
        const name = (id: string) => stages.find((s) => s.id === id)?.name ?? id;
        return (await store.getFocus()).map((l) => brief(l, name));
      }),
  );

  server.registerTool(
    "get_funnel",
    {
      title: "Get funnel statistics",
      description:
        "Stage-by-stage conversion rates and median days in each stage, plus overall lead-to-win conversion and how many leads it takes to win one client. Also the same funnel split by lead origin, to show which sources of leads go furthest. Based on the recorded stage history.",
      inputSchema: {},
      annotations: readOnly,
    },
    () => run(() => store.getFunnel()),
  );

  server.registerTool(
    "create_lead",
    {
      title: "Create lead",
      description:
        "Add a company to the pipeline, optionally with its research briefing, structured attributes and contacts in one call. Fails if a lead with that name already exists.",
      inputSchema: createLeadInput.shape,
    },
    ({ stage, created_at, contacts, ...fields }) =>
      run(async () => detail(store, await store.createLead(fields, { stage, created_at, contacts }))),
  );

  server.registerTool(
    "update_lead",
    {
      title: "Update lead",
      description:
        "Change a lead's fields: next action, priority, company attributes, briefing and so on. Only the fields you pass change. certifications and data_stack replace the whole list. To change stage use move_lead.",
      inputSchema: { lead, ...updateLeadInput.shape },
      annotations: { idempotentHint: true },
    },
    ({ lead, ...fields }) => run(async () => detail(store, await store.updateLead(lead, fields))),
  );

  server.registerTool(
    "move_lead",
    {
      title: "Move lead to a stage",
      description:
        "Move a lead to another stage and record the transition. The previous next action is cleared, so pass the new next_action for the new stage.",
      inputSchema: { lead, ...moveLeadInput.shape },
    },
    ({ lead, stage, ...options }) => run(async () => detail(store, await store.moveLead(lead, stage, options))),
  );

  server.registerTool(
    "add_note",
    {
      title: "Add note",
      description: "Attach a note to a lead: meeting notes, a call or email summary, or anything worth remembering.",
      inputSchema: { lead, ...noteInput.shape },
    },
    ({ lead, body, kind, created_at }) => run(() => store.addNote(lead, body, kind, created_at)),
  );

  server.registerTool(
    "log_contact",
    {
      title: "Log contact",
      description:
        "Record that there was contact with a lead (an email, call or meeting), which updates its last-contact date. Pass a summary to keep it as a note too. Safe to repeat: the same lead, kind and time is only recorded once, and an older contact never moves the last-contact date back.",
      inputSchema: { lead, ...logContactInput.shape },
      annotations: { idempotentHint: true },
    },
    ({ lead, ...options }) =>
      run(async () => {
        const { name, last_contact_at, check_in_days, check_in_due } = await store.logContact(lead, options);
        return { lead: name, last_contact_at, check_in_days, check_in_due };
      }),
  );

  server.registerTool(
    "list_contacts",
    {
      title: "List contacts",
      description:
        "Every person attached to a lead, with their email address, company and that company's last-contact date. Use it to match emails or calendar events to leads.",
      inputSchema: {},
      annotations: readOnly,
    },
    () => run(() => store.listContacts()),
  );

  server.registerTool(
    "add_contact",
    {
      title: "Add contact",
      description: "Attach a person to a lead.",
      inputSchema: { lead, ...createContactInput.shape },
    },
    ({ lead, ...fields }) => run(async () => (await store.addContact(lead, fields)).contacts),
  );

  server.registerTool(
    "update_contact",
    {
      title: "Update contact",
      description: "Change a contact's details. Contact ids come from get_lead.",
      inputSchema: { contact_id: z.string(), ...updateContactInput.shape },
      annotations: { idempotentHint: true },
    },
    ({ contact_id, ...fields }) => run(async () => (await store.updateContact(contact_id, fields)).contacts),
  );

  server.registerTool(
    "create_stage",
    {
      title: "Create stage",
      description: "Add a stage to the pipeline, for example a Negotiation stage in front of Won.",
      inputSchema: createStageInput.shape,
    },
    ({ before, ...fields }) => run(() => store.createStage(fields, before)),
  );

  server.registerTool(
    "update_stage",
    {
      title: "Update stage",
      description: "Rename a stage or change its exit criteria, default next action or stale threshold.",
      inputSchema: { stage: z.string().describe("Stage name or id"), ...updateStageInput.shape },
      annotations: { idempotentHint: true },
    },
    ({ stage, ...fields }) => run(() => store.updateStage(stage, fields)),
  );

  return server;
}
