export type StageKind = "active" | "won" | "lost" | "dormant";
export type Fit = "strong" | "good" | "unclear" | "weak";
export type NoteKind = "note" | "meeting" | "email" | "call";

export interface Stage {
  id: string;
  name: string;
  position: number;
  kind: StageKind;
  exit_criteria: string | null;
  default_next_action: string | null;
  stale_after_days: number | null;
}

export type Attention = "due" | "follow-up" | "stale" | null;

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
  headcount: number | null;
  annual_revenue_usd: number | null;
  location: string | null;
  industry: string | null;
  fit: Fit | null;
  certifications: string[];
  data_stack: string[];
  primary_contact: string | null;
  attention: Attention;
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
}

export interface Transition {
  id: string;
  from_stage_id: string | null;
  to_stage_id: string;
  at: string;
  note: string | null;
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

export interface Funnel {
  stages: FunnelStage[];
  total_leads: number;
  won: number;
  lost: number;
  dormant: number;
  // Product of the stage-to-stage conversion rates, first stage to won.
  overall_conversion: number | null;
  leads_per_win: number | null;
  median_days_to_win: number | null;
}
