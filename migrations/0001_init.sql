-- Pipeline stages are data, not code: rename, reorder, add or retire them freely.
CREATE TABLE stages (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  position INTEGER NOT NULL,
  -- active: part of the forward pipeline. won / lost / dormant: where leads come to rest.
  kind TEXT NOT NULL DEFAULT 'active' CHECK (kind IN ('active', 'won', 'lost', 'dormant')),
  -- What has to be true for a lead to leave this stage for the next one.
  exit_criteria TEXT,
  -- Shown on a lead in this stage that has no next action of its own.
  default_next_action TEXT,
  -- A lead sitting here longer than this is flagged as needing attention.
  stale_after_days INTEGER,
  archived_at TEXT
);

CREATE TABLE leads (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  website TEXT,
  summary TEXT,
  stage_id TEXT NOT NULL REFERENCES stages(id),
  stage_entered_at TEXT NOT NULL,
  next_action TEXT,
  next_action_due TEXT,
  -- 1 = high, 2 = normal, 3 = low
  priority INTEGER NOT NULL DEFAULT 2 CHECK (priority BETWEEN 1 AND 3),
  -- When to come back to a dormant lead.
  follow_up_on TEXT,
  headcount INTEGER,
  annual_revenue_usd INTEGER,
  location TEXT,
  industry TEXT,
  fit TEXT CHECK (fit IS NULL OR fit IN ('strong', 'good', 'unclear', 'weak')),
  certifications TEXT NOT NULL DEFAULT '[]',
  data_stack TEXT NOT NULL DEFAULT '[]',
  briefing TEXT,
  briefing_updated_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  archived_at TEXT
);
CREATE INDEX leads_stage ON leads(stage_id);

-- One row every time a lead enters a stage (including its first). This is the
-- source for time-in-stage, conversion rates and velocity.
CREATE TABLE stage_transitions (
  id TEXT PRIMARY KEY,
  lead_id TEXT NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  from_stage_id TEXT REFERENCES stages(id),
  to_stage_id TEXT NOT NULL REFERENCES stages(id),
  at TEXT NOT NULL,
  note TEXT
);
CREATE INDEX transitions_lead ON stage_transitions(lead_id, at);

CREATE TABLE contacts (
  id TEXT PRIMARY KEY,
  lead_id TEXT NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  title TEXT,
  email TEXT,
  phone TEXT,
  linkedin TEXT,
  notes TEXT,
  is_primary INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE INDEX contacts_lead ON contacts(lead_id);

CREATE TABLE notes (
  id TEXT PRIMARY KEY,
  lead_id TEXT NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  kind TEXT NOT NULL DEFAULT 'note' CHECK (kind IN ('note', 'meeting', 'email', 'call')),
  body TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX notes_lead ON notes(lead_id, created_at);

INSERT INTO stages (id, name, position, kind, exit_criteria, default_next_action, stale_after_days) VALUES
  ('lead', 'Lead', 1, 'active',
    'First outreach sent to a named contact.',
    'Find the right contact and reach out.', 14),
  ('contacted', 'Contacted', 2, 'active',
    'A meeting is on the calendar.',
    'Follow up to get a meeting booked.', 7),
  ('meeting-booked', 'Meeting booked', 3, 'active',
    'The meeting has happened and there is mutual interest in working together.',
    'Prepare for the meeting.', 14),
  ('qualified', 'Qualified', 4, 'active',
    'A written proposal has been sent.',
    'Write and send the proposal.', 10),
  ('proposal-out', 'Proposal out', 5, 'active',
    'Contract signed.',
    'Follow up on the proposal.', 10),
  ('won', 'Won', 6, 'won', NULL, NULL, NULL),
  ('dormant', 'Dormant', 7, 'dormant',
    'The follow-up date arrives and they are ready to talk again.',
    'Check back in on the follow-up date.', NULL),
  ('lost', 'Lost', 8, 'lost', NULL, NULL, NULL);
