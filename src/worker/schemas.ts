// Input shapes shared by the HTTP API and the MCP tools. The descriptions are what a model reads.
import { z } from "zod";

const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD")
  .describe("A date as YYYY-MM-DD");
const timestamp = z.string().describe("An ISO 8601 date or date-time");
const text = (max = 2000) => z.string().trim().max(max);
const tags = z.array(z.string().trim().min(1).max(60)).max(30);

export const leadFields = {
  name: text(200).min(1).describe("Company name"),
  website: text(300).nullable().describe("Company website URL"),
  summary: text(400).nullable().describe("One or two sentences: what the company does and why it could be a fit"),
  next_action: text(400)
    .nullable()
    .describe("The specific next thing to do to move this lead forward. Null falls back to the stage's default"),
  next_action_due: date.nullable().describe("When the next action is due"),
  priority: z.number().int().min(1).max(3).describe("1 = high, 2 = normal, 3 = low"),
  follow_up_on: date.nullable().describe("For dormant leads: when to check back in"),
  last_contact_at: timestamp
    .nullable()
    .describe("When there was last contact with anyone at the company. Normally set by add_note or log_contact"),
  check_in_days: z
    .number()
    .int()
    .positive()
    .max(3650)
    .nullable()
    .describe("Get back in touch this many days after the last contact, e.g. 90. Applies in any stage. Null turns it off"),
  origin: text(60)
    .nullable()
    .describe(
      'Where this lead came from, as a short reusable channel, e.g. "Community", "Own research", "Personal network", "Job application". Reuse an origin already listed by get_pipeline when one fits, so leads can be compared by origin',
    ),
  origin_detail: text(300)
    .nullable()
    .describe('The specifics behind the origin, e.g. "dbt Slack", "Groundwork", "Friend from school"'),
  headcount: z.number().int().nonnegative().nullable().describe("Approximate number of employees"),
  annual_revenue_usd: z.number().int().nonnegative().nullable().describe("Estimated annual revenue in US dollars"),
  location: text(200).nullable().describe("Headquarters, as City, Region or City, Country"),
  industry: text(200).nullable().describe("Industry or sector, a few words"),
  fit: z
    .enum(["strong", "good", "unclear", "weak"])
    .nullable()
    .describe("How good a fit this company looks for Polyculture Research"),
  certifications: tags.describe('Certifications and memberships, e.g. ["B Corp", "USDA Organic", "1% for the Planet"]'),
  data_stack: tags.describe('Known or likely data tools, e.g. ["Segment", "Snowflake", "dbt", "Looker"]'),
  briefing: z
    .string()
    .max(60_000)
    .nullable()
    .describe("The research briefing for this company, in Markdown. Replaces any existing briefing"),
};

export const contactFields = {
  name: text(200).min(1).describe("Full name"),
  title: text(200).nullable().describe("Job title"),
  email: text(200).nullable(),
  phone: text(60).nullable(),
  linkedin: text(300).nullable().describe("LinkedIn profile URL"),
  notes: text(1000).nullable().describe("Why this person is the right contact, or anything worth remembering"),
  is_primary: z.boolean().describe("The main person to talk to at this company"),
};

export const stageFields = {
  name: text(60).min(1),
  kind: z
    .enum(["active", "won", "lost", "dormant"])
    .describe("active = a step in the forward pipeline; won, lost and dormant are where leads come to rest"),
  exit_criteria: text(400).nullable().describe("What has to be true for a lead to move on from this stage"),
  default_next_action: text(400)
    .nullable()
    .describe("The next action shown for a lead in this stage that has none of its own"),
  stale_after_days: z
    .number()
    .int()
    .positive()
    .nullable()
    .describe("Flag leads that sit in this stage longer than this many days"),
};

const contactInput = z.object({ ...partial(contactFields), name: contactFields.name });

export const createLeadInput = z.object({
  ...partial(leadFields),
  name: leadFields.name,
  stage: z.string().optional().describe("Stage name or id. Defaults to the first stage"),
  created_at: timestamp.optional().describe("When the lead entered the pipeline, for backfilling. Defaults to now"),
  contacts: z.array(contactInput).max(20).optional().describe("People at the company to attach"),
});

export const updateLeadInput = z.object(partial(leadFields));

export const moveLeadInput = z.object({
  stage: z.string().describe("Stage name or id to move the lead to"),
  note: text(2000).optional().describe("Why it moved; kept in the lead's stage history"),
  next_action: leadFields.next_action.optional(),
  next_action_due: leadFields.next_action_due.optional(),
  follow_up_on: leadFields.follow_up_on.optional(),
  at: timestamp.optional().describe("When the move actually happened, for backfilling. Defaults to now"),
});

export const noteInput = z.object({
  body: z.string().trim().min(1).max(20_000).describe("The note, in Markdown"),
  kind: z.enum(["note", "meeting", "email", "call"]).default("note"),
  created_at: timestamp.optional().describe("When this happened, if not now"),
});

export const logContactInput = z.object({
  at: timestamp.optional().describe("When the contact happened. Defaults to now"),
  kind: z.enum(["email", "call", "meeting"]).default("email"),
  summary: z
    .string()
    .trim()
    .max(20_000)
    .optional()
    .describe("What was said, kept as a note. Leave out to record only that contact happened"),
});

export const createContactInput = contactInput;
export const updateContactInput = z.object(partial(contactFields));

export const createStageInput = z.object({
  ...partial(stageFields),
  name: stageFields.name,
  before: z.string().optional().describe("Name or id of the stage this one should sit in front of"),
});
export const updateStageInput = z.object(partial(stageFields));
export const reorderStagesInput = z.object({ order: z.array(z.string()).min(1) });

const email = z.email().trim().max(200);
export const createUserInput = z.object({ name: text(100).min(1), email });
export const updateUserInput = z.object({ name: text(100).min(1).optional(), email: email.nullable().optional() });

function partial<T extends Record<string, z.ZodType>>(shape: T): { [K in keyof T]: z.ZodOptional<T[K]> } {
  return Object.fromEntries(Object.entries(shape).map(([key, value]) => [key, value.optional()])) as {
    [K in keyof T]: z.ZodOptional<T[K]>;
  };
}
