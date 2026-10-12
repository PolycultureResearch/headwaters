export type StageKind = "active" | "won" | "lost" | "dormant";
export type Fit = "strong" | "good" | "unclear" | "weak";
export type NoteKind = "note" | "meeting" | "email" | "call";

export interface Stage {
  id: string;
  name: string;
  position: number;
  kind: StageKind;
  // What a lead in this stage is. exit_criteria is what moves it out.
  description: string | null;
  exit_criteria: string | null;
  default_next_action: string | null;
  stale_after_days: number | null;
}

export type HeatLevel = "hot" | "warm" | "mild" | "cool";

export type Attention = "due" | "follow-up" | "check-in" | "stale" | null;

export interface LeadSummary {
  id: string;
  name: string;
  website: string | null;
  summary: string | null;
  stage_id: string;
  stage_entered_at: string;
  days_in_stage: number;
  next_action: string | null;
  next_action_due: string | null;
  // The lead's own next action, or the stage default when it has none.
  effective_next_action: string | null;
  priority: number;
  follow_up_on: string | null;
  // The last meeting, call or email with anyone at the company.
  last_contact_at: string | null;
  days_since_contact: number | null;
  // How often to get back in touch, and the date that makes the next check-in due.
  check_in_days: number | null;
  check_in_due: string | null;
  // Where the lead came from: a short reusable channel, and the specifics.
  origin: string | null;
  origin_detail: string | null;
  headcount: number | null;
  annual_revenue_usd: number | null;
  location: string | null;
  industry: string | null;
  fit: Fit | null;
  certifications: string[];
  data_stack: string[];
  primary_contact: string | null;
  attention: Attention;
  // 0 to 100: how much this lead deserves attention now, from fit, priority, how far along it is and
  // whether something is due. Null for won and lost leads.
  heat: number | null;
  heat_level: HeatLevel | null;
  created_at: string;
  updated_at: string;
}

export interface Contact {
  id: string;
  lead_id: string;
  name: string;
  title: string | null;
  email: string | null;
  phone: string | null;
  linkedin: string | null;
  notes: string | null;
  is_primary: boolean;
}

export interface Note {
  id: string;
  lead_id: string;
  kind: NoteKind;
  body: string;
  created_at: string;
  // Name of whoever wrote it, when known.
  author: string | null;
}

export interface Transition {
  id: string;
  from_stage_id: string | null;
  to_stage_id: string;
  at: string;
  note: string | null;
  // Name of whoever made the move, when known.
  actor: string | null;
}

export interface LeadDetail extends LeadSummary {
  briefing: string | null;
  briefing_updated_at: string | null;
  contacts: Contact[];
  notes: Note[];
  history: Transition[];
}

export interface Pipeline {
  stages: Stage[];
  leads: LeadSummary[];
  // Every origin in use, most used first, so new leads can reuse the same wording.
  origins: string[];
}

export interface FunnelStage {
  stage_id: string;
  name: string;
  // Leads that have ever reached this stage or a later one.
  reached: number;
  // Of those, how many went on to reach the next stage or beyond.
  advanced: number;
  // Still sitting in this stage right now, outcome unknown.
  open: number;
  // advanced / (reached - open): of the leads that have left this stage, the share that moved forward.
  conversion: number | null;
  median_days: number | null;
}

export interface OriginFunnel {
  // Null groups the leads with no origin recorded.
  origin: string | null;
  leads: number;
  // How many of them ever reached each funnel stage or a later one, in the same order as Funnel.stages.
  reached: number[];
  won: number;
  lost: number;
}

export interface Funnel {
  stages: FunnelStage[];
  // The same funnel split by where leads came from, biggest origin first.
  origins: OriginFunnel[];
  total_leads: number;
  won: number;
  lost: number;
  dormant: number;
  // Product of the stage-to-stage conversion rates, first stage to won.
  overall_conversion: number | null;
  leads_per_win: number | null;
  median_days_to_win: number | null;
}

export interface User {
  id: string;
  name: string;
  email: string | null;
  role: "owner" | "member";
  // invited: has a live link and no password yet. expired: the link ran out before they used it.
  status: "active" | "invited" | "expired";
  invite_expires_at: string | null;
}

/** A person together with the one-time link to send them. The link is shown once and never stored. */
export interface Invite {
  user: User;
  invite_url: string;
}
