import { useEffect, useState } from "react";
import type { LeadSummary, Stage, StageKind } from "../shared/types";
import { api, type StagePatch } from "./api";

interface StageSettingsProps {
  stages: Stage[];
  leads: LeadSummary[];
  onClose: () => void;
  act: (change: () => Promise<unknown>) => Promise<void>;
}

const KINDS: { value: StageKind; label: string }[] = [
  { value: "active", label: "Pipeline step" },
  { value: "won", label: "Won" },
  { value: "dormant", label: "Dormant" },
  { value: "lost", label: "Lost" },
];

export function StageSettings({ stages, leads, onClose, act }: StageSettingsProps) {
  const [newName, setNewName] = useState("");

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const move = (index: number, by: number) => {
    const order = stages.map((s) => s.id);
    const [id] = order.splice(index, 1);
    order.splice(index + by, 0, id);
    return act(() => api.reorderStages(order));
  };

  return (
    <>
      <div className="scrim" onClick={onClose} />
      <div className="dialog" role="dialog" aria-modal="true" aria-labelledby="stages-title">
        <header className="panel-head">
          <h2 id="stages-title" className="panel-title">
            Stages
          </h2>
          <button className="ghost close" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </header>
        <p className="muted">
          The pipeline, left to right. Each stage says what has to happen for a lead to leave it, and what to do by
          default while it is there.
        </p>
        <ol className="stage-list">
          {stages.map((stage, index) => {
            const count = leads.filter((l) => l.stage_id === stage.id).length;
            const save = (patch: StagePatch) => act(() => api.updateStage(stage.id, patch));
            return (
              <li key={stage.id} className="stage-row">
                <div className="stage-row-head">
                  <Text label="Stage name" className="stage-name" value={stage.name} onSave={(name) => name && save({ name })} />
                  <select aria-label="Kind" value={stage.kind} onChange={(e) => save({ kind: e.target.value as StageKind })}>
                    {KINDS.map((k) => (
                      <option key={k.value} value={k.value}>
                        {k.label}
                      </option>
                    ))}
                  </select>
                  <div className="row-actions">
                    <button className="ghost small" disabled={index === 0} aria-label={`Move ${stage.name} earlier`} onClick={() => move(index, -1)}>
                      ↑
                    </button>
                    <button
                      className="ghost small"
                      disabled={index === stages.length - 1}
                      aria-label={`Move ${stage.name} later`}
                      onClick={() => move(index, 1)}
                    >
                      ↓
                    </button>
                    <button
                      className="ghost small"
                      disabled={count > 0 || stages.length === 1}
                      title={count > 0 ? `Move its ${count} lead${count === 1 ? "" : "s"} out first` : undefined}
                      onClick={() => {
                        if (window.confirm(`Remove the ${stage.name} stage? Its history is kept.`)) act(() => api.archiveStage(stage.id));
                      }}
                    >
                      Remove
                    </button>
                  </div>
                </div>
                <label>
                  <span>Leaves when</span>
                  <Text
                    label="Exit criteria"
                    value={stage.exit_criteria ?? ""}
                    placeholder="What has to be true to move on"
                    onSave={(v) => save({ exit_criteria: v || null })}
                  />
                </label>
                <label>
                  <span>Default action</span>
                  <Text
                    label="Default next action"
                    value={stage.default_next_action ?? ""}
                    placeholder="What to do with a lead here"
                    onSave={(v) => save({ default_next_action: v || null })}
                  />
                </label>
                <label>
                  <span>Quiet after</span>
                  <Text
                    label="Days before a lead here is flagged"
                    className="narrow"
                    value={stage.stale_after_days?.toString() ?? ""}
                    placeholder="–"
                    onSave={(v) => save({ stale_after_days: /^\d+$/.test(v) && Number(v) > 0 ? Number(v) : null })}
                  />
                  <span className="muted">days</span>
                </label>
              </li>
            );
          })}
        </ol>
        <form
          className="stage-add"
          onSubmit={async (e) => {
            e.preventDefault();
            if (!newName.trim()) return;
            await act(() => api.createStage(newName.trim()));
            setNewName("");
          }}
        >
          <input value={newName} placeholder="New stage name" aria-label="New stage name" onChange={(e) => setNewName(e.target.value)} />
          <button className="primary small">Add stage</button>
        </form>
      </div>
    </>
  );
}

interface TextProps {
  label: string;
  value: string;
  placeholder?: string;
  className?: string;
  onSave: (value: string) => void;
}

function Text({ label, value, placeholder, className, onSave }: TextProps) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  return (
    <input
      className={`editable${className ? ` ${className}` : ""}`}
      aria-label={label}
      value={draft}
      placeholder={placeholder}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => draft.trim() !== value && onSave(draft.trim())}
      onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
    />
  );
}
