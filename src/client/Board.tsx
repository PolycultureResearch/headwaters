import { useState } from "react";
import type { LeadSummary, Stage } from "../shared/types";
import { formatAgo, formatDate, formatDays } from "./format";

interface BoardProps {
  stages: Stage[];
  leads: LeadSummary[];
  onOpen: (leadId: string) => void;
  onMove: (leadId: string, stageId: string) => void;
  onAdd: (stageId: string) => void;
}

const ATTENTION_LABEL = {
  due: "Action due",
  "follow-up": "Follow-up due",
  "check-in": "Time to check in",
  stale: "Gone quiet",
} as const;

export function Board({ stages, leads, onOpen, onMove, onAdd }: BoardProps) {
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);

  return (
    <div className="board">
      {stages.map((stage) => {
        const inStage = leads.filter((lead) => lead.stage_id === stage.id);
        return (
          <section
            key={stage.id}
            className={`column kind-${stage.kind}${over === stage.id ? " drop-target" : ""}`}
            aria-label={stage.name}
            onDragOver={(e) => {
              if (!dragging) return;
              e.preventDefault();
              setOver(stage.id);
            }}
            onDragLeave={(e) => {
              if (!e.currentTarget.contains(e.relatedTarget as Node)) setOver(null);
            }}
            onDrop={(e) => {
              e.preventDefault();
              const leadId = e.dataTransfer.getData("text/plain");
              const lead = leads.find((l) => l.id === leadId);
              if (lead && lead.stage_id !== stage.id) onMove(leadId, stage.id);
              setOver(null);
              setDragging(null);
            }}
          >
            <header className="column-head">
              <div className="column-title">
                <h2>{stage.name}</h2>
                <span className="count">{inStage.length}</span>
                <button className="add" aria-label={`Add a lead to ${stage.name}`} onClick={() => onAdd(stage.id)}>
                  +
                </button>
              </div>
              {stage.exit_criteria && <p className="exit">{stage.exit_criteria}</p>}
            </header>
            <div className="cards">
              {inStage.map((lead) => (
                <Card
                  key={lead.id}
                  lead={lead}
                  stage={stage}
                  dragging={dragging === lead.id}
                  onOpen={() => onOpen(lead.id)}
                  onDragStart={() => setDragging(lead.id)}
                  onDragEnd={() => {
                    setDragging(null);
                    setOver(null);
                  }}
                />
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}

interface CardProps {
  lead: LeadSummary;
  stage: Stage;
  dragging: boolean;
  onOpen: () => void;
  onDragStart: () => void;
  onDragEnd: () => void;
}

function Card({ lead, stage, dragging, onOpen, onDragStart, onDragEnd }: CardProps) {
  const resting = stage.kind === "won" || stage.kind === "lost";
  return (
    <button
      className={`card${dragging ? " dragging" : ""}${lead.priority === 1 ? " high" : ""}${lead.priority === 3 ? " low" : ""}`}
      draggable
      onClick={onOpen}
      onDragStart={(e) => {
        e.dataTransfer.setData("text/plain", lead.id);
        e.dataTransfer.effectAllowed = "move";
        onDragStart();
      }}
      onDragEnd={onDragEnd}
    >
      <span className="card-name">{lead.name}</span>
      {!resting && lead.effective_next_action && (
        <span className={`card-action${lead.next_action ? "" : " is-default"}`}>{lead.effective_next_action}</span>
      )}
      <span className="card-meta">
        <span
          className={`age${lead.attention ? ` ${lead.attention}` : ""}`}
          title={lead.attention ? `${ATTENTION_LABEL[lead.attention]} · in ${stage.name} since ${formatDate(lead.stage_entered_at)}` : `In ${stage.name} since ${formatDate(lead.stage_entered_at)}`}
        >
          {formatDays(lead.days_in_stage)}
        </span>
        {!resting && lead.next_action_due && (
          <span className={lead.attention === "due" ? "due" : ""}>Due {formatDate(lead.next_action_due)}</span>
        )}
        {stage.kind === "dormant" && lead.follow_up_on && (
          <span className={lead.attention === "follow-up" ? "due" : ""}>Back {formatDate(lead.follow_up_on)}</span>
        )}
        {lead.attention === "check-in" ? (
          <span className="check-in">
            Check in{lead.days_since_contact !== null && ` · last ${formatAgo(lead.days_since_contact)}`}
          </span>
        ) : (
          // Leads at rest have no next action, so their last contact is the thing worth seeing.
          stage.kind !== "active" &&
          lead.days_since_contact !== null && <span>Last contact {formatAgo(lead.days_since_contact)}</span>
        )}
        {lead.primary_contact && <span className="contact">{lead.primary_contact}</span>}
      </span>
    </button>
  );
}
