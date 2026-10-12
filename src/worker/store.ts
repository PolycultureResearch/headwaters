import type {
  Attention,
  Contact,
  Fit,
  Funnel,
  FunnelStage,
  HeatLevel,
  LeadDetail,
  LeadSummary,
  Note,
  NoteKind,
  OriginFunnel,
  Pipeline,
  Stage,
  StageKind,
  Transition,
} from "../shared/types";

/** An error whose message is safe and useful to show to the person or model that made the request. */
export class UserError extends Error {}

export interface LeadFields {
  name?: string;
  website?: string | null;
  summary?: string | null;
  next_action?: string | null;
  next_action_due?: string | null;
  priority?: number;
  follow_up_on?: string | null;
  last_contact_at?: string | null;
  check_in_days?: number | null;
  origin?: string | null;
  origin_detail?: string | null;
  headcount?: number | null;
  annual_revenue_usd?: number | null;
  location?: string | null;
  industry?: string | null;
  fit?: Fit | null;
  certifications?: string[];
  data_stack?: string[];
  briefing?: string | null;
}

export interface ContactFields {
  name?: string;
  title?: string | null;
  email?: string | null;
  phone?: string | null;
  linkedin?: string | null;
  notes?: string | null;
  is_primary?: boolean;
}

export interface StageFields {
  name?: string;
  kind?: StageKind;
  description?: string | null;
  exit_criteria?: string | null;
  default_next_action?: string | null;
  stale_after_days?: number | null;
}

export interface MoveOptions {
  note?: string;
  next_action?: string | null;
  next_action_due?: string | null;
  follow_up_on?: string | null;
  /** When the move actually happened, for backfilling. Defaults to now. */
  at?: string;
}

const LEAD_COLUMNS = [
  "name",
  "website",
  "summary",
  "next_action",
  "next_action_due",
  "priority",
  "follow_up_on",
  "last_contact_at",
  "check_in_days",
  "origin",
  "origin_detail",
  "headcount",
  "annual_revenue_usd",
  "location",
  "industry",
  "fit",
  "certifications",
  "data_stack",
  "briefing",
] as const;

const CONTACT_COLUMNS = ["name", "title", "email", "phone", "linkedin", "notes", "is_primary"] as const;
const STAGE_COLUMNS = ["name", "kind", "description", "exit_criteria", "default_next_action", "stale_after_days"] as const;

const DAY_MS = 86_400_000;

const newId = () => crypto.randomUUID().replace(/-/g, "").slice(0, 12);
const nowIso = () => new Date().toISOString();
const today = () => nowIso().slice(0, 10);
const daysBetween = (from: string, to: string) => (Date.parse(to) - Date.parse(from)) / DAY_MS;

function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "stage"
  );
}

function parseList(value: unknown): string[] {
  try {
    const parsed = JSON.parse(String(value ?? "[]"));
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const value = sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  return Math.round(value * 10) / 10;
}

function normaliseTimestamp(value: string | undefined, label: string): string {
  if (!value) return nowIso();
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) throw new UserError(`${label} is not a valid date: ${value}`);
  return new Date(parsed).toISOString();
}

type Row = Record<string, unknown>;

// What goes into a lead's heat, out of 100: how good a fit it is, the priority set by hand,
// how far along the pipeline it is, and whether something about it is due.
const HEAT_FIT: Record<string, number> = { strong: 30, good: 20, unclear: 10, weak: 0 };
const HEAT_FIT_UNKNOWN = 10;
const HEAT_PRIORITY: Record<number, number> = { 1: 25, 2: 12, 3: 0 };
const HEAT_PROGRESS = 20;
const HEAT_ATTENTION = { due: 25, "follow-up": 20, "check-in": 15, stale: 10 } as const;

const heatLevel = (heat: number): HeatLevel => (heat >= 70 ? "hot" : heat >= 50 ? "warm" : heat >= 30 ? "mild" : "cool");

export class Store {
  /** `actorId` is the signed-in user, recorded against the notes and stage moves they make. */
  constructor(
    private db: D1Database,
    private actorId: string | null = null,
  ) {}

  // ---- stages ----

  async listStages(): Promise<Stage[]> {
    const { results } = await this.db
      .prepare(
        "SELECT id, name, position, kind, description, exit_criteria, default_next_action, stale_after_days FROM stages WHERE archived_at IS NULL ORDER BY position",
      )
      .all<Stage>();
    return results;
  }

  async resolveStage(ref: string): Promise<Stage> {
    const stages = await this.listStages();
    const needle = ref.trim().toLowerCase();
    const match = stages.find((s) => s.id === needle) ?? stages.find((s) => s.name.toLowerCase() === needle);
    if (!match) {
      throw new UserError(`No stage called "${ref}". Stages are: ${stages.map((s) => s.name).join(", ")}.`);
    }
    return match;
  }

  /** Adds a stage. `before` is the stage it should sit in front of; omitted, it goes last among active stages. */
  async createStage(fields: StageFields & { name: string }, before?: string): Promise<Stage> {
    const stages = await this.listStages();
    const base = slugify(fields.name);
    const { results: taken } = await this.db.prepare("SELECT id FROM stages").all<{ id: string }>();
    const ids = new Set(taken.map((r) => r.id));
    let id = base;
    for (let n = 2; ids.has(id); n++) id = `${base}-${n}`;

    const kind = fields.kind ?? "active";
    let anchor: Stage | undefined;
    if (before) anchor = await this.resolveStage(before);
    else if (kind === "active") anchor = stages.find((s) => s.kind !== "active");
    const order = stages.map((s) => s.id);
    order.splice(anchor ? order.indexOf(anchor.id) : order.length, 0, id);

    await this.db
      .prepare(
        "INSERT INTO stages (id, name, position, kind, description, exit_criteria, default_next_action, stale_after_days) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .bind(
        id,
        fields.name.trim(),
        order.length + 1000,
        kind,
        fields.description ?? null,
        fields.exit_criteria ?? null,
        fields.default_next_action ?? null,
        fields.stale_after_days ?? null,
      )
      .run();
    await this.reorderStages(order);
    return this.resolveStage(id);
  }

  async updateStage(ref: string, fields: StageFields): Promise<Stage> {
    const stage = await this.resolveStage(ref);
    const sets: string[] = [];
    const values: unknown[] = [];
    for (const column of STAGE_COLUMNS) {
      if (fields[column] === undefined) continue;
      sets.push(`${column} = ?`);
      values.push(fields[column]);
    }
    if (sets.length) {
      await this.db
        .prepare(`UPDATE stages SET ${sets.join(", ")} WHERE id = ?`)
        .bind(...values, stage.id)
        .run();
    }
    return this.resolveStage(stage.id);
  }

  async reorderStages(orderedIds: string[]): Promise<Stage[]> {
    const stages = await this.listStages();
    const known = new Set(stages.map((s) => s.id));
    const order = orderedIds.filter((id) => known.has(id));
    for (const stage of stages) if (!order.includes(stage.id)) order.push(stage.id);
    await this.db.batch(
      order.map((id, index) => this.db.prepare("UPDATE stages SET position = ? WHERE id = ?").bind(index + 1, id)),
    );
    return this.listStages();
  }

  /** Retires a stage. Its history is kept; it must be empty first. */
  async archiveStage(ref: string): Promise<void> {
    const stage = await this.resolveStage(ref);
    const row = await this.db
      .prepare("SELECT COUNT(*) AS n FROM leads WHERE stage_id = ? AND archived_at IS NULL")
      .bind(stage.id)
      .first<{ n: number }>();
    if (row && row.n > 0) {
      throw new UserError(`${stage.name} still has ${row.n} lead(s) in it. Move them to another stage first.`);
    }
    await this.db.prepare("UPDATE stages SET archived_at = ? WHERE id = ?").bind(nowIso(), stage.id).run();
  }

  // ---- leads ----

  private toSummary(row: Row, stages: Map<string, Stage>): LeadSummary {
    const stage = stages.get(String(row.stage_id));
    const daysInStage = Math.max(0, Math.floor(daysBetween(String(row.stage_entered_at), nowIso())));
    const due = (row.next_action_due as string | null) ?? null;
    const followUp = (row.follow_up_on as string | null) ?? null;
    const resting = stage?.kind === "won" || stage?.kind === "lost";

    const lastContact = (row.last_contact_at as string | null) ?? null;
    const checkInDays = (row.check_in_days as number | null) ?? null;
    // With no contact logged yet, the interval counts from when the lead was added.
    const checkInDue = checkInDays
      ? new Date(Date.parse(lastContact ?? String(row.created_at)) + checkInDays * DAY_MS).toISOString().slice(0, 10)
      : null;

    // A check-in applies to every lead, clients and lost leads included; the rest only to open ones.
    const archived = (row.archived_at as string | null) ?? null;
    let attention: Attention = null;
    if (archived) attention = null;
    else if (!resting && due && due <= today()) attention = "due";
    else if (stage?.kind === "dormant" && followUp && followUp <= today()) attention = "follow-up";
    else if (checkInDue && checkInDue <= today()) attention = "check-in";
    else if (!resting && stage?.stale_after_days != null && daysInStage > stage.stale_after_days) attention = "stale";

    let heat: number | null = null;
    if (!resting && !archived) {
      const active = [...stages.values()].filter((s) => s.kind === "active").sort((a, b) => a.position - b.position);
      const step = active.findIndex((s) => s.id === stage?.id);
      const progress = step > 0 ? (step / (active.length - 1)) * HEAT_PROGRESS : 0;
      heat = Math.round(
        (HEAT_FIT[String(row.fit)] ?? HEAT_FIT_UNKNOWN) +
          (HEAT_PRIORITY[Number(row.priority)] ?? 0) +
          progress +
          (attention ? HEAT_ATTENTION[attention] : 0),
      );
    }

    const nextAction = (row.next_action as string | null) ?? null;
    return {
      id: String(row.id),
      name: String(row.name),
      website: (row.website as string | null) ?? null,
      summary: (row.summary as string | null) ?? null,
      stage_id: String(row.stage_id),
      stage_entered_at: String(row.stage_entered_at),
      days_in_stage: daysInStage,
      next_action: nextAction,
      next_action_due: due,
      effective_next_action: nextAction ?? stage?.default_next_action ?? null,
      priority: Number(row.priority),
      follow_up_on: followUp,
      last_contact_at: lastContact,
      days_since_contact: lastContact ? Math.max(0, Math.floor(daysBetween(lastContact, nowIso()))) : null,
      check_in_days: checkInDays,
      check_in_due: checkInDue,
      origin: (row.origin as string | null) ?? null,
      origin_detail: (row.origin_detail as string | null) ?? null,
      headcount: (row.headcount as number | null) ?? null,
      annual_revenue_usd: (row.annual_revenue_usd as number | null) ?? null,
      location: (row.location as string | null) ?? null,
      industry: (row.industry as string | null) ?? null,
      fit: (row.fit as Fit | null) ?? null,
      certifications: parseList(row.certifications),
      data_stack: parseList(row.data_stack),
      primary_contact: (row.primary_contact as string | null) ?? null,
      attention,
      heat,
      heat_level: heat === null ? null : heatLevel(heat),
      created_at: String(row.created_at),
      updated_at: String(row.updated_at),
      archived_at: archived,
    };
  }

  private static readonly SUMMARY_SQL = `
    SELECT l.*, (
      SELECT c.name FROM contacts c WHERE c.lead_id = l.id ORDER BY c.is_primary DESC, c.created_at LIMIT 1
    ) AS primary_contact
    FROM leads l`;

  async getPipeline(): Promise<Pipeline> {
    const stages = await this.listStages();
    const byId = new Map(stages.map((s) => [s.id, s]));
    const { results } = await this.db
      .prepare(`${Store.SUMMARY_SQL} WHERE l.archived_at IS NULL ORDER BY l.priority, l.stage_entered_at`)
      .all<Row>();
    // Hottest first, so each column of the board reads top-down in the order to work it.
    const leads = results.map((row) => this.toSummary(row, byId)).sort((a, b) => (b.heat ?? -1) - (a.heat ?? -1));
    const counts = new Map<string, number>();
    for (const lead of leads) if (lead.origin) counts.set(lead.origin, (counts.get(lead.origin) ?? 0) + 1);
    const origins = [...counts.keys()].sort((a, b) => counts.get(b)! - counts.get(a)! || a.localeCompare(b));
    return { stages, leads, origins };
  }

  /** Matches an origin to one already in use, ignoring case, so the same channel is not counted under two spellings. */
  private async canonicalOrigin(value: string | null | undefined, exceptLeadId = ""): Promise<string | null> {
    const origin = value?.trim();
    if (!origin) return null;
    const existing = await this.db
      .prepare("SELECT origin FROM leads WHERE archived_at IS NULL AND id != ?1 AND LOWER(origin) = LOWER(?2) LIMIT 1")
      .bind(exceptLeadId, origin)
      .first<{ origin: string }>();
    return existing?.origin ?? origin;
  }

  /** Finds a lead by id, exact name, or an unambiguous part of its name. An archived lead is found by id only. */
  async resolveLeadId(ref: string): Promise<string> {
    const needle = ref.trim();
    const { results } = await this.db
      .prepare(
        "SELECT id, name FROM leads WHERE id = ?1 OR (archived_at IS NULL AND (name LIKE ?1 OR name LIKE '%' || ?1 || '%'))",
      )
      .bind(needle)
      .all<{ id: string; name: string }>();
    const exact = results.filter((r) => r.id === needle || r.name.toLowerCase() === needle.toLowerCase());
    if (exact.length === 1) return exact[0].id;
    if (exact.length === 0 && results.length === 1) return results[0].id;
    if (results.length === 0) throw new UserError(`No lead matches "${ref}".`);
    throw new UserError(
      `"${ref}" matches more than one lead: ${results.map((r) => `${r.name} (${r.id})`).join(", ")}. Use the id.`,
    );
  }

  async getLead(ref: string): Promise<LeadDetail> {
    const id = await this.resolveLeadId(ref);
    const stages = new Map((await this.listStages()).map((s) => [s.id, s]));
    const [lead, contacts, notes, history] = await this.db.batch<Row>([
      this.db.prepare(`${Store.SUMMARY_SQL} WHERE l.id = ?`).bind(id),
      this.db.prepare("SELECT * FROM contacts WHERE lead_id = ? ORDER BY is_primary DESC, created_at").bind(id),
      this.db
        .prepare(
          "SELECT n.id, n.lead_id, n.kind, n.body, n.created_at, u.name AS author FROM notes n LEFT JOIN users u ON u.id = n.author_id WHERE n.lead_id = ? ORDER BY n.created_at DESC",
        )
        .bind(id),
      this.db
        .prepare(
          "SELECT t.id, t.from_stage_id, t.to_stage_id, t.at, t.note, u.name AS actor FROM stage_transitions t LEFT JOIN users u ON u.id = t.actor_id WHERE t.lead_id = ? ORDER BY t.at",
        )
        .bind(id),
    ]);
    const row = lead.results[0];
    return {
      ...this.toSummary(row, stages),
      briefing: (row.briefing as string | null) ?? null,
      briefing_updated_at: (row.briefing_updated_at as string | null) ?? null,
      contacts: contacts.results.map((c) => ({
        ...c,
        is_primary: Boolean(c.is_primary),
      })) as unknown as Contact[],
      notes: notes.results as unknown as Note[],
      history: history.results as unknown as Transition[],
    };
  }

  async createLead(
    fields: LeadFields & { name: string },
    options: {
      stage?: string;
      created_at?: string;
      contacts?: (ContactFields & { name: string })[];
    } = {},
  ): Promise<LeadDetail> {
    const name = fields.name.trim();
    if (!name) throw new UserError("A lead needs a name.");
    const existing = await this.db
      .prepare("SELECT id, archived_at FROM leads WHERE name LIKE ? ORDER BY archived_at IS NOT NULL LIMIT 1")
      .bind(name)
      .first<{ id: string; archived_at: string | null }>();
    if (existing?.archived_at) {
      throw new UserError(`${name} is in the archive (id ${existing.id}). Restore it instead of adding it again.`);
    }
    if (existing) throw new UserError(`${name} is already in the pipeline (id ${existing.id}). Update it instead.`);

    const stage = options.stage ? await this.resolveStage(options.stage) : (await this.listStages())[0];
    const id = newId();
    const at = normaliseTimestamp(options.created_at, "created_at");
    const statements = [
      this.db
        .prepare(
          `INSERT INTO leads (id, name, website, summary, stage_id, stage_entered_at, next_action, next_action_due,
            priority, follow_up_on, last_contact_at, check_in_days, origin, origin_detail, headcount, annual_revenue_usd,
            location, industry, fit, certifications, data_stack, briefing, briefing_updated_at, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          id,
          name,
          fields.website ?? null,
          fields.summary ?? null,
          stage.id,
          at,
          fields.next_action ?? null,
          fields.next_action_due ?? null,
          fields.priority ?? 2,
          fields.follow_up_on ?? null,
          fields.last_contact_at ? normaliseTimestamp(fields.last_contact_at, "last_contact_at") : null,
          fields.check_in_days ?? null,
          await this.canonicalOrigin(fields.origin),
          fields.origin_detail ?? null,
          fields.headcount ?? null,
          fields.annual_revenue_usd ?? null,
          fields.location ?? null,
          fields.industry ?? null,
          fields.fit ?? null,
          JSON.stringify(fields.certifications ?? []),
          JSON.stringify(fields.data_stack ?? []),
          fields.briefing ?? null,
          fields.briefing ? nowIso() : null,
          at,
          nowIso(),
        ),
      this.db
        .prepare(
          "INSERT INTO stage_transitions (id, lead_id, from_stage_id, to_stage_id, at, actor_id) VALUES (?, ?, NULL, ?, ?, ?)",
        )
        .bind(newId(), id, stage.id, at, this.actorId),
      ...(options.contacts ?? []).map((contact, index) => this.insertContact(id, contact, index)),
    ];
    await this.db.batch(statements);
    return this.getLead(id);
  }

  async updateLead(ref: string, fields: LeadFields): Promise<LeadDetail> {
    const id = await this.resolveLeadId(ref);
    const sets: string[] = [];
    const values: unknown[] = [];
    for (const column of LEAD_COLUMNS) {
      let value = fields[column];
      if (value === undefined) continue;
      if (column === "last_contact_at" && value) value = normaliseTimestamp(String(value), "last_contact_at");
      if (column === "origin") value = await this.canonicalOrigin(value as string | null, id);
      sets.push(`${column} = ?`);
      values.push(Array.isArray(value) ? JSON.stringify(value) : value);
    }
    if (fields.briefing !== undefined) {
      sets.push("briefing_updated_at = ?");
      values.push(nowIso());
    }
    if (sets.length) {
      await this.db
        .prepare(`UPDATE leads SET ${sets.join(", ")}, updated_at = ? WHERE id = ?`)
        .bind(...values, nowIso(), id)
        .run();
    }
    return this.getLead(id);
  }

  async moveLead(ref: string, stageRef: string, options: MoveOptions = {}): Promise<LeadDetail> {
    const id = await this.resolveLeadId(ref);
    const stage = await this.resolveStage(stageRef);
    const current = await this.db
      .prepare("SELECT stage_id, stage_entered_at FROM leads WHERE id = ?")
      .bind(id)
      .first<{ stage_id: string; stage_entered_at: string }>();
    if (!current) throw new UserError(`No lead matches "${ref}".`);

    const statements: D1PreparedStatement[] = [];
    if (current.stage_id !== stage.id) {
      const at = normaliseTimestamp(options.at, "at");
      if (at < current.stage_entered_at) {
        throw new UserError(
          `That move is dated before the lead entered its current stage (${current.stage_entered_at}).`,
        );
      }
      // The old next action belonged to the old stage, so it is cleared unless a new one is given.
      statements.push(
        this.db
          .prepare(
            "UPDATE leads SET stage_id = ?, stage_entered_at = ?, next_action = ?, next_action_due = ?, follow_up_on = ?, updated_at = ? WHERE id = ?",
          )
          .bind(
            stage.id,
            at,
            options.next_action ?? null,
            options.next_action_due ?? null,
            stage.kind === "dormant" ? (options.follow_up_on ?? null) : null,
            nowIso(),
            id,
          ),
        this.db
          .prepare(
            "INSERT INTO stage_transitions (id, lead_id, from_stage_id, to_stage_id, at, note, actor_id) VALUES (?, ?, ?, ?, ?, ?, ?)",
          )
          .bind(newId(), id, current.stage_id, stage.id, at, options.note ?? null, this.actorId),
      );
    } else {
      const { note: _note, at: _at, ...rest } = options;
      if (Object.keys(rest).length) await this.updateLead(id, rest);
    }
    if (statements.length) await this.db.batch(statements);
    return this.getLead(id);
  }

  /** Takes a lead off the board and out of the statistics, keeping everything about it. */
  async archiveLead(ref: string, reason?: string): Promise<LeadDetail> {
    const id = await this.resolveLeadId(ref);
    if (reason?.trim()) await this.addNote(id, `Archived: ${reason.trim()}`);
    await this.db.prepare("UPDATE leads SET archived_at = COALESCE(archived_at, ?) WHERE id = ?").bind(nowIso(), id).run();
    return this.getLead(id);
  }

  async listArchived(): Promise<LeadSummary[]> {
    const stages = new Map((await this.listStages()).map((s) => [s.id, s]));
    const { results } = await this.db
      .prepare(`${Store.SUMMARY_SQL} WHERE l.archived_at IS NOT NULL ORDER BY l.archived_at DESC`)
      .all<Row>();
    return results.map((row) => this.toSummary(row, stages));
  }

  /** Finds an archived lead by id, exact name, or an unambiguous part of its name. */
  private async resolveArchivedId(ref: string): Promise<string> {
    const needle = ref.trim().toLowerCase();
    const archived = await this.listArchived();
    const exact = archived.filter((l) => l.id === needle || l.name.toLowerCase() === needle);
    const matches = exact.length ? exact : archived.filter((l) => l.name.toLowerCase().includes(needle));
    if (matches.length === 1) return matches[0].id;
    if (matches.length === 0) throw new UserError(`No archived lead matches "${ref}".`);
    throw new UserError(`"${ref}" matches more than one archived lead: ${matches.map((l) => `${l.name} (${l.id})`).join(", ")}. Use the id.`);
  }

  /** Puts an archived lead back on the board, in the stage it was in. */
  async restoreLead(ref: string): Promise<LeadDetail> {
    const id = await this.resolveArchivedId(ref);
    const clash = await this.db
      .prepare("SELECT l.name FROM leads l JOIN leads a ON a.id = ?1 WHERE l.archived_at IS NULL AND l.name LIKE a.name")
      .bind(id)
      .first<{ name: string }>();
    if (clash) throw new UserError(`There is already a lead called ${clash.name} on the board.`);
    const stage = await this.db
      .prepare("SELECT s.archived_at FROM leads l JOIN stages s ON s.id = l.stage_id WHERE l.id = ?")
      .bind(id)
      .first<{ archived_at: string | null }>();
    // Its old stage may have been retired since; if so it comes back at the start of the pipeline.
    if (stage?.archived_at) {
      const first = (await this.listStages())[0];
      await this.db.prepare("UPDATE leads SET stage_id = ?, stage_entered_at = ? WHERE id = ?").bind(first.id, nowIso(), id).run();
    }
    await this.db.prepare("UPDATE leads SET archived_at = NULL, updated_at = ? WHERE id = ?").bind(nowIso(), id).run();
    return this.getLead(id);
  }

  /** Deletes an archived lead for good, with its contacts, notes and history. */
  async deleteArchivedLead(id: string): Promise<void> {
    const lead = await this.db.prepare("SELECT archived_at FROM leads WHERE id = ?").bind(id).first<{ archived_at: string | null }>();
    if (!lead) throw new UserError("That lead no longer exists.");
    if (!lead.archived_at) throw new UserError("Archive the lead before deleting it.");
    await this.db.batch([
      this.db.prepare("DELETE FROM notes WHERE lead_id = ?").bind(id),
      this.db.prepare("DELETE FROM contacts WHERE lead_id = ?").bind(id),
      this.db.prepare("DELETE FROM stage_transitions WHERE lead_id = ?").bind(id),
      this.db.prepare("DELETE FROM leads WHERE id = ?").bind(id),
    ]);
  }

  // ---- notes ----

  async addNote(ref: string, body: string, kind: NoteKind = "note", createdAt?: string): Promise<Note> {
    const leadId = await this.resolveLeadId(ref);
    if (!body.trim()) throw new UserError("A note needs some text.");
    const note: Note = {
      id: newId(),
      lead_id: leadId,
      kind,
      body: body.trim(),
      created_at: normaliseTimestamp(createdAt, "created_at"),
      author: null,
    };
    if (this.actorId) {
      const author = await this.db.prepare("SELECT name FROM users WHERE id = ?").bind(this.actorId).first<{ name: string }>();
      note.author = author?.name ?? null;
    }
    await this.db.batch([
      this.db
        .prepare("INSERT INTO notes (id, lead_id, kind, body, created_at, author_id) VALUES (?, ?, ?, ?, ?, ?)")
        .bind(note.id, note.lead_id, note.kind, note.body, note.created_at, this.actorId),
      // A meeting, call or email is contact; a plain note is not. An older entry never moves the date back.
      kind === "note"
        ? this.db.prepare("UPDATE leads SET updated_at = ? WHERE id = ?").bind(nowIso(), leadId)
        : this.db
            .prepare(
              "UPDATE leads SET updated_at = ?1, last_contact_at = MAX(COALESCE(last_contact_at, ''), ?2) WHERE id = ?3",
            )
            .bind(nowIso(), note.created_at, leadId),
    ]);
    return note;
  }

  /**
   * Records that contact happened. With a summary it is kept as a note; without one only the date moves.
   * Logging the same contact twice (same lead, kind and time) changes nothing, so a sync can be re-run.
   */
  async logContact(
    ref: string,
    options: {
      at?: string;
      kind?: Exclude<NoteKind, "note">;
      summary?: string;
    } = {},
  ): Promise<LeadDetail> {
    const leadId = await this.resolveLeadId(ref);
    const at = normaliseTimestamp(options.at, "at");
    const kind = options.kind ?? "email";
    if (options.summary?.trim()) {
      const existing = await this.db
        .prepare("SELECT id FROM notes WHERE lead_id = ? AND kind = ? AND created_at = ?")
        .bind(leadId, kind, at)
        .first();
      if (!existing) await this.addNote(leadId, options.summary, kind, at);
    } else {
      await this.db
        .prepare(
          "UPDATE leads SET updated_at = ?1, last_contact_at = MAX(COALESCE(last_contact_at, ''), ?2) WHERE id = ?3",
        )
        .bind(nowIso(), at, leadId)
        .run();
    }
    return this.getLead(leadId);
  }

  async deleteNote(noteId: string): Promise<void> {
    await this.db.prepare("DELETE FROM notes WHERE id = ?").bind(noteId).run();
  }

  // ---- contacts ----

  private insertContact(leadId: string, fields: ContactFields & { name: string }, index = 0): D1PreparedStatement {
    // Offsetting created_at keeps contacts added together in the order they were given.
    const createdAt = new Date(Date.now() + index).toISOString();
    return this.db
      .prepare(
        "INSERT INTO contacts (id, lead_id, name, title, email, phone, linkedin, notes, is_primary, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .bind(
        newId(),
        leadId,
        fields.name.trim(),
        fields.title ?? null,
        fields.email ?? null,
        fields.phone ?? null,
        fields.linkedin ?? null,
        fields.notes ?? null,
        fields.is_primary ? 1 : 0,
        createdAt,
      );
  }

  async addContact(ref: string, fields: ContactFields & { name: string }): Promise<LeadDetail> {
    const leadId = await this.resolveLeadId(ref);
    if (!fields.name.trim()) throw new UserError("A contact needs a name.");
    const statements = [this.insertContact(leadId, fields)];
    if (fields.is_primary) {
      statements.unshift(this.db.prepare("UPDATE contacts SET is_primary = 0 WHERE lead_id = ?").bind(leadId));
    }
    await this.db.batch(statements);
    return this.getLead(leadId);
  }

  async updateContact(contactId: string, fields: ContactFields): Promise<LeadDetail> {
    const contact = await this.db
      .prepare("SELECT lead_id FROM contacts WHERE id = ?")
      .bind(contactId)
      .first<{ lead_id: string }>();
    if (!contact) throw new UserError(`No contact with id ${contactId}.`);
    const statements: D1PreparedStatement[] = [];
    if (fields.is_primary) {
      statements.push(this.db.prepare("UPDATE contacts SET is_primary = 0 WHERE lead_id = ?").bind(contact.lead_id));
    }
    const sets: string[] = [];
    const values: unknown[] = [];
    for (const column of CONTACT_COLUMNS) {
      const value = fields[column];
      if (value === undefined) continue;
      sets.push(`${column} = ?`);
      values.push(typeof value === "boolean" ? Number(value) : value);
    }
    if (sets.length) {
      statements.push(
        this.db.prepare(`UPDATE contacts SET ${sets.join(", ")} WHERE id = ?`).bind(...values, contactId),
      );
    }
    if (statements.length) await this.db.batch(statements);
    return this.getLead(contact.lead_id);
  }

  /** Everyone attached to a lead, with their company, for matching against email or a calendar. */
  async listContacts(): Promise<Row[]> {
    const { results } = await this.db
      .prepare(
        `SELECT c.id AS contact_id, c.name, c.title, c.email, c.is_primary, l.id AS lead_id, l.name AS lead,
           l.website, l.last_contact_at
         FROM contacts c JOIN leads l ON l.id = c.lead_id
         WHERE l.archived_at IS NULL ORDER BY l.name, c.is_primary DESC, c.created_at`,
      )
      .all<Row>();
    return results.map((row) => ({
      ...row,
      is_primary: Boolean(row.is_primary),
    }));
  }

  async deleteContact(contactId: string): Promise<void> {
    await this.db.prepare("DELETE FROM contacts WHERE id = ?").bind(contactId).run();
  }

  // ---- analysis ----

  /** Leads that need something done, most pressing first. */
  async getFocus(): Promise<LeadSummary[]> {
    const { stages, leads } = await this.getPipeline();
    const position = new Map(stages.map((s) => [s.id, s]));
    const urgency = {
      due: 0,
      "follow-up": 1,
      "check-in": 2,
      stale: 3,
    } as const;
    return leads
      .filter((lead) => {
        const kind = position.get(lead.stage_id)?.kind;
        return kind === "active" || lead.attention !== null;
      })
      .sort((a, b) => {
        const ua = a.attention ? urgency[a.attention] : 4;
        const ub = b.attention ? urgency[b.attention] : 4;
        if (ua !== ub) return ua - ub;
        if (a.priority !== b.priority) return a.priority - b.priority;
        // Later stages are closer to revenue, so they come first.
        const pa = position.get(a.stage_id)?.position ?? 0;
        const pb = position.get(b.stage_id)?.position ?? 0;
        if (pa !== pb) return pb - pa;
        return b.days_in_stage - a.days_in_stage;
      });
  }

  async getFunnel(): Promise<Funnel> {
    const stages = await this.listStages();
    const active = stages.filter((s) => s.kind === "active");
    const wonIds = new Set(stages.filter((s) => s.kind === "won").map((s) => s.id));
    // Progress index: 0..n-1 for the active stages in order, n for won.
    const progress = new Map<string, number>(active.map((s, i) => [s.id, i]));
    for (const id of wonIds) progress.set(id, active.length);

    const [leadRows, transitionRows] = await this.db.batch<Row>([
      this.db.prepare("SELECT id, stage_id, origin FROM leads WHERE archived_at IS NULL"),
      this.db.prepare(
        "SELECT t.lead_id, t.to_stage_id, t.at FROM stage_transitions t JOIN leads l ON l.id = t.lead_id WHERE l.archived_at IS NULL ORDER BY t.lead_id, t.at",
      ),
    ]);

    const byLead = new Map<string, { to: string; at: string }[]>();
    for (const row of transitionRows.results) {
      const list = byLead.get(String(row.lead_id)) ?? [];
      list.push({ to: String(row.to_stage_id), at: String(row.at) });
      byLead.set(String(row.lead_id), list);
    }

    const reached = new Array<number>(active.length + 1).fill(0);
    const open = new Array<number>(active.length).fill(0);
    const stints = new Map<string, number[]>();
    const daysToWin: number[] = [];
    const kindOf = new Map(stages.map((s) => [s.id, s.kind]));
    const byOrigin = new Map<string | null, OriginFunnel>();
    let lost = 0;
    let dormant = 0;

    for (const lead of leadRows.results) {
      const history = byLead.get(String(lead.id)) ?? [];
      let furthest = -1;
      history.forEach((step, index) => {
        furthest = Math.max(furthest, progress.get(step.to) ?? -1);
        const next = history[index + 1];
        if (next) {
          const list = stints.get(step.to) ?? [];
          list.push(daysBetween(step.at, next.at));
          stints.set(step.to, list);
        }
      });
      for (let i = 0; i <= furthest; i++) reached[i]++;

      const currentKind = kindOf.get(String(lead.stage_id));
      const origin = (lead.origin as string | null) || null;
      const group = byOrigin.get(origin) ?? {
        origin,
        leads: 0,
        reached: new Array<number>(active.length).fill(0),
        won: 0,
        lost: 0,
      };
      byOrigin.set(origin, group);
      group.leads++;
      for (let i = 0; i <= Math.min(furthest, active.length - 1); i++) group.reached[i]++;
      if (furthest === active.length) group.won++;
      if (currentKind === "lost") group.lost++;

      if (currentKind === "lost") lost++;
      if (currentKind === "dormant") dormant++;
      if (currentKind === "active" && progress.get(String(lead.stage_id)) === furthest) open[furthest]++;

      const win = history.find((step) => wonIds.has(step.to));
      if (win && history.length) daysToWin.push(daysBetween(history[0].at, win.at));
    }

    const funnelStages: FunnelStage[] = active.map((stage, i) => {
      const resolved = reached[i] - open[i];
      return {
        stage_id: stage.id,
        name: stage.name,
        reached: reached[i],
        advanced: reached[i + 1],
        open: open[i],
        conversion: resolved > 0 ? reached[i + 1] / resolved : null,
        median_days: median(stints.get(stage.id) ?? []),
      };
    });

    const rates = funnelStages.map((s) => s.conversion);
    const overall = rates.length && rates.every((r) => r !== null) ? rates.reduce((a, r) => a * r!, 1) : null;
    return {
      stages: funnelStages,
      // Unattributed leads go last, whatever their number.
      origins: [...byOrigin.values()].sort(
        (a, b) => Number(a.origin === null) - Number(b.origin === null) || b.leads - a.leads || b.won - a.won,
      ),
      total_leads: leadRows.results.length,
      won: reached[active.length],
      lost,
      dormant,
      overall_conversion: overall,
      leads_per_win: overall ? Math.round((1 / overall) * 10) / 10 : null,
      median_days_to_win: median(daysToWin),
    };
  }
}
