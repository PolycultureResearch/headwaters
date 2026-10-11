import { useCallback, useEffect, useState } from "react";
import type { Invite, User } from "../shared/types";
import { api } from "./api";
import { formatDate } from "./format";

interface PeopleProps {
  onClose: () => void;
  onError: (message: string) => void;
}

const STATUS: Record<User["status"], string> = {
  active: "Active",
  invited: "Invited",
  expired: "Invite expired",
};

/** Who can sign in. Only the owner sees this. */
export function People({ onClose, onError }: PeopleProps) {
  const [users, setUsers] = useState<User[]>([]);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  // The link is only ever available straight after it is made, so it is held here until the dialog closes.
  const [invite, setInvite] = useState<Invite | null>(null);
  const [copied, setCopied] = useState(false);

  const load = useCallback(() => api.users().then(setUsers, (e: Error) => onError(e.message)), [onError]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const run = async (change: () => Promise<unknown>) => {
    try {
      const result = await change();
      if (result && typeof result === "object" && "invite_url" in result) {
        setInvite(result as Invite);
        setCopied(false);
      }
    } catch (e) {
      onError((e as Error).message);
    }
    await load();
  };

  return (
    <>
      <div className="scrim" onClick={onClose} />
      <div className="dialog" role="dialog" aria-modal="true" aria-labelledby="people-title">
        <header className="panel-head">
          <h2 id="people-title" className="panel-title">
            People
          </h2>
          <button className="ghost close" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </header>
        <p className="muted">Everyone here can see and manage the whole pipeline. Only you can add or remove people.</p>

        {invite && (
          <div className="invite" role="status">
            <p>
              Send this link to {invite.user.name}. It lets them set a password, works once, and expires
              {invite.user.invite_expires_at ? ` on ${formatDate(invite.user.invite_expires_at)}` : " in 7 days"}. It
              will not be shown again.
            </p>
            <div className="invite-link">
              <input readOnly value={invite.invite_url} aria-label="Invite link" onFocus={(e) => e.currentTarget.select()} />
              <button
                className="primary small"
                onClick={async () => {
                  await navigator.clipboard.writeText(invite.invite_url);
                  setCopied(true);
                }}
              >
                {copied ? "Copied" : "Copy"}
              </button>
            </div>
          </div>
        )}

        <ul className="people">
          {users.map((user) => (
            <li key={user.id} className="stage-row">
              <div className="stage-row-head">
                <Field
                  label="Name"
                  className="stage-name"
                  value={user.name}
                  onSave={(value) => value && run(() => api.updateUser(user.id, { name: value }))}
                />
                <span className="muted person-status">{user.role === "owner" ? "Owner" : STATUS[user.status]}</span>
                {user.role !== "owner" && (
                  <div className="row-actions">
                    <button className="ghost small" onClick={() => run(() => api.renewInvite(user.id))}>
                      {user.status === "active" ? "Reset password" : "New link"}
                    </button>
                    <button
                      className="ghost small"
                      onClick={() => {
                        if (window.confirm(`Remove ${user.name}? They are signed out straight away.`)) {
                          run(() => api.removeUser(user.id));
                        }
                      }}
                    >
                      Remove
                    </button>
                  </div>
                )}
              </div>
              <Field
                label="Email"
                value={user.email ?? ""}
                placeholder="Email address"
                onSave={(value) => run(() => api.updateUser(user.id, { email: value || null }))}
              />
            </li>
          ))}
        </ul>

        <form
          className="stage-add"
          onSubmit={async (e) => {
            e.preventDefault();
            if (!name.trim() || !email.trim()) return;
            await run(async () => {
              const created = await api.createUser(name.trim(), email.trim());
              setName("");
              setEmail("");
              return created;
            });
          }}
        >
          <input value={name} placeholder="Name" aria-label="Name" onChange={(e) => setName(e.target.value)} />
          <input
            type="email"
            value={email}
            placeholder="Email"
            aria-label="Email"
            onChange={(e) => setEmail(e.target.value)}
          />
          <button className="primary small">Invite</button>
        </form>
      </div>
    </>
  );
}

interface FieldProps {
  label: string;
  value: string;
  placeholder?: string;
  className?: string;
  onSave: (value: string) => void;
}

function Field({ label, value, placeholder, className, onSave }: FieldProps) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  return (
    <input
      className={`editable${className ? ` ${className}` : ""}`}
      aria-label={label}
      value={draft}
      placeholder={placeholder}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => (draft.trim() !== value ? onSave(draft.trim()) : setDraft(value))}
      onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
    />
  );
}
