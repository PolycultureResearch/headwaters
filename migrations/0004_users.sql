-- The people who can sign in. Everyone sees and manages the whole pipeline; only the owner manages people.
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  -- Stored lower-case. The owner may have none until they fill it in.
  email TEXT,
  role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('owner', 'member')),
  -- Null for the owner, who signs in with the ADMIN_PASSWORD secret, and for members who have not accepted yet.
  password_hash TEXT,
  -- SHA-256 of the one-time link that lets someone set their password.
  invite_hash TEXT,
  invite_expires_at TEXT,
  -- Part of every session cookie; raising it signs the person out everywhere.
  session_version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  removed_at TEXT
);
CREATE UNIQUE INDEX users_email ON users(email) WHERE removed_at IS NULL AND email IS NOT NULL;

-- The id matches the user id that existing MCP connections were granted to.
INSERT INTO users (id, name, role, created_at) VALUES ('owner', 'Owner', 'owner', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));

-- Who wrote each note and made each stage move. Everything so far was the owner.
ALTER TABLE notes ADD COLUMN author_id TEXT REFERENCES users(id);
ALTER TABLE stage_transitions ADD COLUMN actor_id TEXT REFERENCES users(id);
UPDATE notes SET author_id = 'owner';
UPDATE stage_transitions SET actor_id = 'owner';
