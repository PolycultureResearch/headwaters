import type { Funnel, LeadDetail, LeadSummary, Note, Pipeline, Stage } from "../shared/types";

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const response = await fetch(`/api${path}`, {
    method,
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (response.status === 401) {
    window.location.href = `/login?next=${encodeURIComponent(window.location.pathname)}`;
    return new Promise<T>(() => {});
  }
  if (response.status === 204) return undefined as T;
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error((data as { error?: string } | null)?.error ?? "Something went wrong.");
  return data as T;
}

export type LeadPatch = Partial<
  Pick<
    LeadDetail,
    | "name"
    | "website"
    | "summary"
    | "next_action"
    | "next_action_due"
    | "priority"
    | "follow_up_on"
    | "headcount"
    | "annual_revenue_usd"
    | "location"
    | "industry"
    | "fit"
    | "certifications"
    | "data_stack"
    | "briefing"
  >
>;

export type ContactInput = {
  name: string;
  title?: string | null;
  email?: string | null;
  linkedin?: string | null;
  is_primary?: boolean;
};

export type StagePatch = Partial<Omit<Stage, "id" | "position">>;

export const api = {
  pipeline: () => request<Pipeline>("GET", "/pipeline"),
  focus: () => request<LeadSummary[]>("GET", "/focus"),
  funnel: () => request<Funnel>("GET", "/funnel"),
  lead: (id: string) => request<LeadDetail>("GET", `/leads/${id}`),
  createLead: (name: string, stage: string) => request<LeadDetail>("POST", "/leads", { name, stage }),
  updateLead: (id: string, patch: LeadPatch) => request<LeadDetail>("PATCH", `/leads/${id}`, patch),
  moveLead: (id: string, stage: string) => request<LeadDetail>("POST", `/leads/${id}/move`, { stage }),
  archiveLead: (id: string) => request<void>("DELETE", `/leads/${id}`),
  addNote: (id: string, body: string, kind: Note["kind"]) => request<Note>("POST", `/leads/${id}/notes`, { body, kind }),
  deleteNote: (noteId: string) => request<void>("DELETE", `/notes/${noteId}`),
  addContact: (id: string, contact: ContactInput) => request<LeadDetail>("POST", `/leads/${id}/contacts`, contact),
  updateContact: (contactId: string, patch: Partial<ContactInput>) =>
    request<LeadDetail>("PATCH", `/contacts/${contactId}`, patch),
  deleteContact: (contactId: string) => request<void>("DELETE", `/contacts/${contactId}`),
  createStage: (name: string) => request<Stage>("POST", "/stages", { name }),
  updateStage: (id: string, patch: StagePatch) => request<Stage>("PATCH", `/stages/${id}`, patch),
  reorderStages: (order: string[]) => request<Stage[]>("PUT", "/stages/order", { order }),
  archiveStage: (id: string) => request<void>("DELETE", `/stages/${id}`),
};
