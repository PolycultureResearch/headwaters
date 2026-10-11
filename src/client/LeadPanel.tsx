import { useCallback, useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import type { Contact, Fit, LeadDetail, Note, Stage } from "../shared/types";
import { api, type LeadPatch } from "./api";
import { formatDate, formatDays, formatMoney, hostname, parseAmount, parseTags, safeUrl } from "./format";

interface LeadPanelProps {
  leadId: string;
  stages: Stage[];
  version: number;
  onClose: () => void;
  onChanged: () => void;
  onError: (message: string) => void;
}

/** Markdown with links that open in a new tab, so reading a source does not lose the board. */
function Markdown({ children }: { children: string }) {
  return (
    <ReactMarkdown components={{ a: ({ node: _node, ...props }) => <a {...props} target="_blank" rel="noreferrer" /> }}>
      {children}
    </ReactMarkdown>
  );
}

const FITS: Fit[] = ["strong", "good", "unclear", "weak"];
const NOTE_KINDS: Note["kind"][] = ["note", "meeting", "call", "email"];
const PRIORITIES = [
  { value: 1, label: "High" },
  { value: 2, label: "Normal" },
  { value: 3, label: "Low" },
];

export function LeadPanel({ leadId, stages, version, onClose, onChanged, onError }: LeadPanelProps) {
  const [lead, setLead] = useState<LeadDetail | null>(null);

  useEffect(() => {
    api.lead(leadId).then(setLead, (e: Error) => {
      onError(e.message);
      onClose();
    });
    // version changes whenever anything in the pipeline does, including edits made elsewhere.
  }, [leadId, version]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const typing = target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT";
      if (e.key === "Escape" && !typing) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  /** Runs a change that returns the updated lead (or nothing), then tells the board to reload. */
  const apply = useCallback(
    async (change: () => Promise<LeadDetail | unknown>) => {
      try {
        const result = await change();
        if (result && typeof result === "object" && "history" in result) setLead(result as LeadDetail);
      } catch (e) {
        onError((e as Error).message);
      }
      onChanged();
    },
    [onChanged, onError],
  );

  const save = useCallback((patch: LeadPatch) => apply(() => api.updateLead(leadId, patch)), [apply, leadId]);

  if (!lead) return <aside className="panel" aria-busy="true" />;

  const stage = stages.find((s) => s.id === lead.stage_id);
  const site = lead.website ? safeUrl(lead.website) : undefined;

  return (
    <>
      <div className="scrim" onClick={onClose} />
      <aside className="panel" aria-label={lead.name}>
        <header className="panel-head">
          <EditableText className="panel-title" label="Company name" value={lead.name} onSave={(name) => name && save({ name })} />
          <button className="ghost close" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </header>
        <div className="panel-sub">
          {site ? (
            <a href={site} target="_blank" rel="noreferrer">
              {hostname(lead.website!)}
            </a>
          ) : (
            <span className="muted">No website</span>
          )}
          {[lead.location, lead.industry].filter(Boolean).map((value) => (
            <span key={value}>{value}</span>
          ))}
        </div>

        <section className="forward">
          <div className="forward-stage">
            <select
              aria-label="Stage"
              value={lead.stage_id}
              onChange={(e) => apply(() => api.moveLead(leadId, e.target.value))}
            >
              {stages.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
            <span className={`age${lead.attention ? ` ${lead.attention}` : ""}`}>
              {formatDays(lead.days_in_stage)} in stage · since {formatDate(lead.stage_entered_at)}
            </span>
          </div>
          {stage?.exit_criteria && (
            <p className="forward-exit">
              <span className="eyebrow">To move on</span>
              {stage.exit_criteria}
            </p>
          )}
          {stage?.kind !== "won" && stage?.kind !== "lost" && (
            <div className="forward-action">
              <EditableText
                label="Next action"
                value={lead.next_action ?? ""}
                placeholder={stage?.default_next_action ?? "What happens next?"}
                onSave={(next_action) => save({ next_action: next_action || null })}
              />
              <label className="inline-date">
                Due
                <input
                  type="date"
                  value={lead.next_action_due ?? ""}
                  onChange={(e) => save({ next_action_due: e.target.value || null })}
                />
              </label>
              {stage?.kind === "dormant" && (
                <label className="inline-date">
                  Check back
                  <input
                    type="date"
                    value={lead.follow_up_on ?? ""}
                    onChange={(e) => save({ follow_up_on: e.target.value || null })}
                  />
                </label>
              )}
            </div>
          )}
        </section>

        <section>
          <h3>Company</h3>
          <EditableText
            label="Summary"
            multiline
            value={lead.summary ?? ""}
            placeholder="What they do and why they could be a fit"
            onSave={(summary) => save({ summary: summary || null })}
          />
          <dl className="facts">
            <Fact label="Priority">
              <select value={lead.priority} onChange={(e) => save({ priority: Number(e.target.value) })}>
                {PRIORITIES.map((p) => (
                  <option key={p.value} value={p.value}>
                    {p.label}
                  </option>
                ))}
              </select>
            </Fact>
            <Fact label="Fit">
              <select value={lead.fit ?? ""} onChange={(e) => save({ fit: (e.target.value || null) as Fit | null })}>
                <option value="">–</option>
                {FITS.map((fit) => (
                  <option key={fit} value={fit}>
                    {fit[0].toUpperCase() + fit.slice(1)}
                  </option>
                ))}
              </select>
            </Fact>
            <Fact label="Headcount">
              <EditableText
                label="Headcount"
                value={lead.headcount?.toLocaleString() ?? ""}
                placeholder="–"
                onSave={(v) => save({ headcount: parseAmount(v) })}
              />
            </Fact>
            <Fact label="Revenue">
              <EditableText
                label="Annual revenue"
                value={lead.annual_revenue_usd === null ? "" : formatMoney(lead.annual_revenue_usd)}
                placeholder="–"
                onSave={(v) => save({ annual_revenue_usd: parseAmount(v) })}
              />
            </Fact>
            <Fact label="Location">
              <EditableText label="Location" value={lead.location ?? ""} placeholder="–" onSave={(v) => save({ location: v || null })} />
            </Fact>
            <Fact label="Industry">
              <EditableText label="Industry" value={lead.industry ?? ""} placeholder="–" onSave={(v) => save({ industry: v || null })} />
            </Fact>
            <Fact label="Website" wide>
              <EditableText label="Website" value={lead.website ?? ""} placeholder="–" onSave={(v) => save({ website: v || null })} />
            </Fact>
            <Fact label="Certifications" wide>
              <EditableText
                label="Certifications, comma separated"
                value={lead.certifications.join(", ")}
                placeholder="–"
                onSave={(v) => save({ certifications: parseTags(v) })}
              />
            </Fact>
            <Fact label="Data stack" wide>
              <EditableText
                label="Data stack, comma separated"
                value={lead.data_stack.join(", ")}
                placeholder="–"
                onSave={(v) => save({ data_stack: parseTags(v) })}
              />
            </Fact>
          </dl>
        </section>

        <Contacts lead={lead} apply={apply} />
        <Notes lead={lead} apply={apply} />
        <Briefing lead={lead} save={save} />

        <section>
          <h3>History</h3>
          <ol className="history">
            {lead.history.map((step, index) => {
              const next = lead.history[index + 1];
              const days = ((next ? Date.parse(next.at) : Date.now()) - Date.parse(step.at)) / 86_400_000;
              return (
                <li key={step.id}>
                  <span className="history-stage">{stages.find((s) => s.id === step.to_stage_id)?.name ?? step.to_stage_id}</span>
                  <span className="muted">
                    {formatDate(step.at)} · {formatDays(days)}
                    {next ? "" : " so far"}
                  </span>
                  {step.note && <span className="history-note">{step.note}</span>}
                </li>
              );
            })}
          </ol>
        </section>

        <footer className="panel-foot">
          <button
            className="ghost danger"
            onClick={async () => {
              if (!window.confirm(`Remove ${lead.name} from Headwaters?`)) return;
              await apply(() => api.archiveLead(leadId));
              onClose();
            }}
          >
            Remove lead
          </button>
        </footer>
      </aside>
    </>
  );
}

function Fact({ label, wide, children }: { label: string; wide?: boolean; children: React.ReactNode }) {
  return (
    <div className={`fact${wide ? " wide" : ""}`}>
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

interface EditableTextProps {
  label: string;
  value: string;
  placeholder?: string;
  multiline?: boolean;
  className?: string;
  onSave: (value: string) => void;
}

/** A field that looks like plain text until focused, and saves when focus leaves it. */
function EditableText({ label, value, placeholder, multiline, className, onSave }: EditableTextProps) {
  const [draft, setDraft] = useState(value);
  const focused = useRef(false);

  useEffect(() => {
    if (!focused.current) setDraft(value);
  }, [value]);

  const props = {
    className: `editable${className ? ` ${className}` : ""}`,
    "aria-label": label,
    value: draft,
    placeholder,
    onFocus: () => {
      focused.current = true;
    },
    onBlur: () => {
      focused.current = false;
      const next = draft.trim();
      if (next !== value) onSave(next);
      else setDraft(value);
    },
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setDraft(e.target.value),
  };

  if (multiline) return <textarea {...props} rows={Math.max(2, Math.ceil(draft.length / 60))} />;
  return (
    <input
      {...props}
      type="text"
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
        if (e.key === "Escape") {
          setDraft(value);
          // Blur after the reset has rendered, so the old draft is not saved.
          const input = e.currentTarget;
          requestAnimationFrame(() => input.blur());
        }
      }}
    />
  );
}

type Apply = (change: () => Promise<unknown>) => Promise<void>;

function Contacts({ lead, apply }: { lead: LeadDetail; apply: Apply }) {
  const [adding, setAdding] = useState(false);
  const reload = () => api.lead(lead.id);

  return (
    <section>
      <h3>
        People
        <button className="ghost small" onClick={() => setAdding((v) => !v)}>
          {adding ? "Cancel" : "Add"}
        </button>
      </h3>
      {lead.contacts.length === 0 && !adding && <p className="muted">No one yet. Who should you talk to?</p>}
      <ul className="contacts">
        {lead.contacts.map((contact) => (
          <ContactRow key={contact.id} contact={contact} apply={apply} reload={reload} />
        ))}
      </ul>
      {adding && (
        <form
          className="contact-form"
          onSubmit={async (e) => {
            e.preventDefault();
            const data = new FormData(e.currentTarget);
            const field = (name: string) => String(data.get(name) ?? "").trim() || null;
            const name = field("name");
            if (!name) return;
            await apply(() =>
              api.addContact(lead.id, {
                name,
                title: field("title"),
                email: field("email"),
                linkedin: field("linkedin"),
                is_primary: lead.contacts.length === 0,
              }),
            );
            setAdding(false);
          }}
        >
          <input name="name" placeholder="Name" aria-label="Name" required autoFocus />
          <input name="title" placeholder="Title" aria-label="Title" />
          <input name="email" type="email" placeholder="Email" aria-label="Email" />
          <input name="linkedin" placeholder="LinkedIn URL" aria-label="LinkedIn URL" />
          <button className="primary small">Save</button>
        </form>
      )}
    </section>
  );
}

function ContactRow({ contact, apply, reload }: { contact: Contact; apply: Apply; reload: () => Promise<LeadDetail> }) {
  const linkedin = contact.linkedin ? safeUrl(contact.linkedin) : undefined;
  return (
    <li className="contact-row">
      <div>
        <span className="contact-name">{contact.name}</span>
        {contact.is_primary && <span className="tag">Primary</span>}
        {contact.title && <span className="muted"> · {contact.title}</span>}
        <div className="contact-links">
          {contact.email && <a href={`mailto:${contact.email}`}>{contact.email}</a>}
          {linkedin && (
            <a href={linkedin} target="_blank" rel="noreferrer">
              LinkedIn
            </a>
          )}
          {contact.phone && <span>{contact.phone}</span>}
        </div>
        {contact.notes && <p className="contact-notes">{contact.notes}</p>}
      </div>
      <div className="row-actions">
        {!contact.is_primary && (
          <button className="ghost small" onClick={() => apply(() => api.updateContact(contact.id, { is_primary: true }))}>
            Make primary
          </button>
        )}
        <button
          className="ghost small"
          aria-label={`Remove ${contact.name}`}
          onClick={() => {
            if (window.confirm(`Remove ${contact.name}?`)) apply(() => api.deleteContact(contact.id).then(reload));
          }}
        >
          Remove
        </button>
      </div>
    </li>
  );
}

function Notes({ lead, apply }: { lead: LeadDetail; apply: Apply }) {
  const [body, setBody] = useState("");
  const [kind, setKind] = useState<Note["kind"]>("note");
  const reload = () => api.lead(lead.id);

  const submit = async () => {
    if (!body.trim()) return;
    await apply(() => api.addNote(lead.id, body, kind).then(reload));
    setBody("");
    setKind("note");
  };

  return (
    <section>
      <h3>Notes</h3>
      <div className="note-form">
        <textarea
          value={body}
          placeholder="Add a note"
          aria-label="New note"
          rows={body ? 4 : 2}
          onChange={(e) => setBody(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) submit();
          }}
        />
        {body && (
          <div className="note-form-actions">
            <select value={kind} aria-label="Kind of note" onChange={(e) => setKind(e.target.value as Note["kind"])}>
              {NOTE_KINDS.map((k) => (
                <option key={k} value={k}>
                  {k[0].toUpperCase() + k.slice(1)}
                </option>
              ))}
            </select>
            <button className="primary small" onClick={submit}>
              Save note
            </button>
          </div>
        )}
      </div>
      <ul className="notes">
        {lead.notes.map((note) => (
          <li key={note.id}>
            <div className="note-head">
              <span className="muted">
                {formatDate(note.created_at)}
                {note.kind !== "note" && ` · ${note.kind}`}
              </span>
              <button
                className="ghost small"
                onClick={() => {
                  if (window.confirm("Delete this note?")) apply(() => api.deleteNote(note.id).then(reload));
                }}
              >
                Delete
              </button>
            </div>
            <div className="prose">
              <Markdown>{note.body}</Markdown>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Briefing({ lead, save }: { lead: LeadDetail; save: (patch: LeadPatch) => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");

  return (
    <section>
      <h3>
        Briefing
        {lead.briefing_updated_at && <span className="muted h-note">{formatDate(lead.briefing_updated_at)}</span>}
        {!editing && (
          <button
            className="ghost small"
            onClick={() => {
              setDraft(lead.briefing ?? "");
              setEditing(true);
            }}
          >
            {lead.briefing ? "Edit" : "Write"}
          </button>
        )}
      </h3>
      {editing ? (
        <div className="note-form">
          <textarea value={draft} rows={16} aria-label="Briefing, in Markdown" onChange={(e) => setDraft(e.target.value)} autoFocus />
          <div className="note-form-actions">
            <button className="ghost small" onClick={() => setEditing(false)}>
              Cancel
            </button>
            <button
              className="primary small"
              onClick={async () => {
                await save({ briefing: draft.trim() || null });
                setEditing(false);
                setOpen(true);
              }}
            >
              Save briefing
            </button>
          </div>
        </div>
      ) : lead.briefing ? (
        <>
          <div className={`prose briefing${open ? "" : " clipped"}`}>
            <Markdown>{lead.briefing}</Markdown>
          </div>
          <button className="ghost small" onClick={() => setOpen((v) => !v)}>
            {open ? "Show less" : "Read the full briefing"}
          </button>
        </>
      ) : (
        <p className="muted">No briefing yet. Ask Claude to research this company and attach one.</p>
      )}
    </section>
  );
}
