import { useEffect, useState } from "react";
import type { LeadSummary, Stage } from "../shared/types";
import { api } from "./api";
import { formatDate } from "./format";

interface ArchiveProps {
  stages: Stage[];
  version: number;
  onOpen: (id: string) => void;
  act: (change: () => Promise<unknown>) => Promise<void>;
}

/** Leads taken off the board but kept, newest first. */
export function Archive({ stages, version, onOpen, act }: ArchiveProps) {
  const [leads, setLeads] = useState<LeadSummary[] | null>(null);

  useEffect(() => {
    api.archived().then(setLeads, () => setLeads([]));
  }, [version]);

  if (!leads) return null;
  if (leads.length === 0) {
    return <p className="empty">Nothing archived. Archive a lead from the bottom of its panel to keep it without it sitting on the board.</p>;
  }

  const stageName = (id: string) => stages.find((s) => s.id === id)?.name ?? "a retired stage";

  return (
    <div className="focus">
      <p className="lede">Off the board and out of the funnel numbers, but kept in full. Restore one to put it back where it was.</p>
      <ol className="focus-list">
        {leads.map((lead) => (
          <li key={lead.id} className="archive-row">
            <button className="focus-row" onClick={() => onOpen(lead.id)}>
              <span className="focus-main">
                <span className="focus-name">{lead.name}</span>
                {lead.summary && <span className="focus-action">{lead.summary}</span>}
              </span>
              <span className="focus-stage">Was in {stageName(lead.stage_id)}</span>
              <span className="focus-when">Archived {formatDate(lead.archived_at!)}</span>
            </button>
            <button className="ghost small" onClick={() => act(() => api.restoreLead(lead.id))}>
              Restore
            </button>
          </li>
        ))}
      </ol>
    </div>
  );
}
