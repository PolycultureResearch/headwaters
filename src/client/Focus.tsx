import { useEffect, useState } from "react";
import type { LeadSummary, Stage } from "../shared/types";
import { api } from "./api";
import { formatDate, formatDays } from "./format";

const ATTENTION_LABEL = { due: "Due", "follow-up": "Follow up", stale: "Quiet" } as const;

export function Focus({ stages, version, onOpen }: { stages: Stage[]; version: number; onOpen: (id: string) => void }) {
  const [leads, setLeads] = useState<LeadSummary[] | null>(null);

  useEffect(() => {
    api.focus().then(setLeads, () => setLeads([]));
  }, [version]);

  if (!leads) return null;
  if (leads.length === 0) return <p className="empty">Nothing in the open pipeline yet.</p>;

  const stageName = (id: string) => stages.find((s) => s.id === id)?.name ?? id;
  const pressing = leads.filter((l) => l.attention).length;

  return (
    <div className="focus">
      <p className="lede">
        {pressing === 0 ? "Nothing is overdue or gone quiet." : `${pressing} need${pressing === 1 ? "s" : ""} attention.`}{" "}
        The rest of the open pipeline follows, closest to a signed contract first.
      </p>
      <ol className="focus-list">
        {leads.map((lead) => (
          <li key={lead.id}>
            <button className="focus-row" onClick={() => onOpen(lead.id)}>
              <span className={`badge ${lead.attention ?? "none"}`}>{lead.attention ? ATTENTION_LABEL[lead.attention] : ""}</span>
              <span className="focus-main">
                <span className="focus-name">{lead.name}</span>
                <span className={`focus-action${lead.next_action ? "" : " is-default"}`}>
                  {lead.effective_next_action ?? "No next action set"}
                </span>
              </span>
              <span className="focus-stage">{stageName(lead.stage_id)}</span>
              <span className="focus-when">
                {lead.next_action_due
                  ? `Due ${formatDate(lead.next_action_due)}`
                  : lead.follow_up_on
                    ? `Back ${formatDate(lead.follow_up_on)}`
                    : ""}
              </span>
              <span className="focus-age">{formatDays(lead.days_in_stage)}</span>
            </button>
          </li>
        ))}
      </ol>
    </div>
  );
}
