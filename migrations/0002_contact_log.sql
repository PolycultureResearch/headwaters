-- When the lead was last in touch, and how often to check in with it.
ALTER TABLE leads ADD COLUMN last_contact_at TEXT;
ALTER TABLE leads ADD COLUMN check_in_days INTEGER;

-- Meetings, calls and emails already logged as notes count as contact.
UPDATE leads SET last_contact_at = (
  SELECT MAX(n.created_at) FROM notes n WHERE n.lead_id = leads.id AND n.kind IN ('meeting', 'call', 'email')
);
