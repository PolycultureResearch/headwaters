import { useCallback, useEffect, useMemo, useState } from "react";
import type { LeadSummary, Pipeline, User } from "../shared/types";
import { api } from "./api";
import { Archive } from "./Archive";
import { Board } from "./Board";
import { Focus } from "./Focus";
import { FunnelView } from "./Funnel";
import { LeadPanel } from "./LeadPanel";
import { People } from "./People";
import { StageSettings } from "./StageSettings";

type View = "board" | "focus" | "funnel" | "archive";
const VIEWS: { id: View; label: string }[] = [
  { id: "board", label: "Board" },
  { id: "focus", label: "Focus" },
  { id: "funnel", label: "Funnel" },
  { id: "archive", label: "Archive" },
];

function matches(lead: LeadSummary, needle: string): boolean {
  return [
    lead.name,
    lead.industry,
    lead.location,
    lead.origin,
    lead.origin_detail,
    lead.primary_contact,
    ...lead.certifications,
    ...lead.data_stack,
  ]
    .filter(Boolean)
    .some((value) => value!.toLowerCase().includes(needle));
}

export function App() {
  const [pipeline, setPipeline] = useState<Pipeline | null>(null);
  const [view, setView] = useState<View>("board");
  const [selected, setSelected] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [editingStages, setEditingStages] = useState(false);
  const [editingPeople, setEditingPeople] = useState(false);
  const [me, setMe] = useState<User | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Bumped after every change so views that load their own data know to reload.
  const [version, setVersion] = useState(0);

  const refresh = useCallback(async () => {
    try {
      setPipeline(await api.pipeline());
      setVersion((v) => v + 1);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  // Leads also change from outside this tab (Claude, over MCP), so reload whenever the tab is looked at again.
  useEffect(() => {
    refresh();
    const onVisible = () => document.visibilityState === "visible" && refresh();
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
    };
  }, [refresh]);

  useEffect(() => {
    api.me().then(setMe, () => setMe(null));
  }, []);

  useEffect(() => {
    if (!error) return;
    const timer = setTimeout(() => setError(null), 6000);
    return () => clearTimeout(timer);
  }, [error]);

  /** Runs a change, then reloads; failures surface as a message instead of being lost. */
  const act = useCallback(
    async (change: () => Promise<unknown>) => {
      try {
        await change();
      } catch (e) {
        setError((e as Error).message);
      }
      await refresh();
    },
    [refresh],
  );

  const moveLead = useCallback(
    (leadId: string, stageId: string) => {
      // Show the card in its new column straight away; the reload confirms it.
      setPipeline((current) =>
        current && {
          ...current,
          leads: current.leads.map((l) => (l.id === leadId ? { ...l, stage_id: stageId, days_in_stage: 0 } : l)),
        },
      );
      return act(() => api.moveLead(leadId, stageId));
    },
    [act],
  );

  const addLead = useCallback(
    async (stageId: string) => {
      const name = window.prompt("Company name")?.trim();
      if (!name) return;
      try {
        const lead = await api.createLead(name, stageId);
        setSelected(lead.id);
      } catch (e) {
        setError((e as Error).message);
      }
      await refresh();
    },
    [refresh],
  );

  const visibleLeads = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!pipeline) return [];
    return needle ? pipeline.leads.filter((lead) => matches(lead, needle)) : pipeline.leads;
  }, [pipeline, query]);

  if (!pipeline) return <div className="loading">{error ?? "Loading…"}</div>;

  return (
    <div className="app">
      <header className="topbar">
        <h1 className="wordmark">Polyculture Research</h1>
        <nav className="views" aria-label="Views">
          {VIEWS.map((v) => (
            <button key={v.id} className={view === v.id ? "active" : ""} aria-current={view === v.id} onClick={() => setView(v.id)}>
              {v.label}
            </button>
          ))}
        </nav>
        <div className="spacer" />
        <input
          className="search"
          type="search"
          placeholder="Filter"
          aria-label="Filter leads"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <button className="ghost" onClick={() => setEditingStages(true)}>
          Stages
        </button>
        {me?.role === "owner" && (
          <button className="ghost" onClick={() => setEditingPeople(true)}>
            People
          </button>
        )}
        <button className="primary" onClick={() => addLead(pipeline.stages[0].id)}>
          Add lead
        </button>
        <button className="ghost" title={me ? `Signed in as ${me.name}` : undefined} onClick={api.signOut}>
          Sign out
        </button>
      </header>

      <main className="content">
        {view === "board" && (
          <Board stages={pipeline.stages} leads={visibleLeads} onOpen={setSelected} onMove={moveLead} onAdd={addLead} />
        )}
        {view === "focus" && <Focus stages={pipeline.stages} version={version} onOpen={setSelected} />}
        {view === "funnel" && <FunnelView version={version} />}
        {view === "archive" && <Archive stages={pipeline.stages} version={version} onOpen={setSelected} act={act} />}
      </main>

      {selected && (
        <LeadPanel
          key={selected}
          leadId={selected}
          stages={pipeline.stages}
          origins={pipeline.origins}
          version={version}
          onClose={() => setSelected(null)}
          onChanged={refresh}
          onError={setError}
        />
      )}
      {editingStages && (
        <StageSettings
          stages={pipeline.stages}
          leads={pipeline.leads}
          onClose={() => setEditingStages(false)}
          act={act}
        />
      )}
      {editingPeople && <People onClose={() => setEditingPeople(false)} onError={setError} />}
      {error && (
        <div className="toast" role="alert">
          {error}
        </div>
      )}
    </div>
  );
}
