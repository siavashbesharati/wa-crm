import { STAGES, type Lead } from "./shared";

export type EditForm = {
  name: string;
  phone: string;
  group_id: string;
  chat_type: string;
  stage: string;
  notes: string;
  tags: string;
  bot_paused: boolean;
  assignee_id: string;
};

export type BoardOrderUpdate = {
  id: string;
  stage: string;
  board_order: number;
};

export function emptyForm(): EditForm {
  return {
    name: "",
    phone: "",
    group_id: "",
    chat_type: "pv",
    stage: STAGES[0],
    notes: "",
    tags: "",
    bot_paused: false,
    assignee_id: ""
  };
}

export function toEditForm(l: Lead): EditForm {
  return {
    name: l.name || "",
    phone: l.phone || "",
    group_id: l.group_id || "",
    chat_type: l.chat_type === "group" ? "group" : "pv",
    stage: l.stage || STAGES[0],
    notes: l.notes || "",
    tags: (l.tags || []).join(", "),
    bot_paused: !!l.bot_paused,
    assignee_id: l.assignee_id || ""
  };
}

export function sortLeadsForBoard(leads: Lead[]): Lead[] {
  const stageRank = new Map(STAGES.map((s, i) => [s, i]));
  return [...leads].sort((a, b) => {
    const sa = stageRank.get(a.stage) ?? STAGES.length;
    const sb = stageRank.get(b.stage) ?? STAGES.length;
    if (sa !== sb) return sa - sb;
    const oa = a.board_order ?? 0;
    const ob = b.board_order ?? 0;
    if (oa !== ob) return oa - ob;
    return a.name.localeCompare(b.name, "fa");
  });
}

export function leadsInStage(leads: Lead[], stage: string): Lead[] {
  return sortLeadsForBoard(leads).filter((l) => l.stage === stage);
}

export function buildBoardReorder(
  leads: Lead[],
  dragId: string,
  targetStage: string,
  targetId: string | null,
  insertBefore: boolean
): { next: Lead[]; updates: BoardOrderUpdate[] } {
  const dragged = leads.find((l) => l.id === dragId);
  if (!dragged) return { next: leads, updates: [] };

  const sourceStage = dragged.stage;
  let columnItems = leadsInStage(leads, targetStage).filter((l) => l.id !== dragId);

  let insertIndex = columnItems.length;
  if (targetId) {
    const targetIndex = columnItems.findIndex((l) => l.id === targetId);
    if (targetIndex >= 0) {
      insertIndex = insertBefore ? targetIndex : targetIndex + 1;
    }
  }

  const movedLead: Lead = { ...dragged, stage: targetStage };
  columnItems.splice(insertIndex, 0, movedLead);

  const updates: BoardOrderUpdate[] = columnItems.map((l, i) => ({
    id: l.id,
    stage: targetStage,
    board_order: i
  }));

  if (sourceStage !== targetStage) {
    const sourceItems = leadsInStage(leads, sourceStage).filter((l) => l.id !== dragId);
    for (let i = 0; i < sourceItems.length; i += 1) {
      updates.push({
        id: sourceItems[i].id,
        stage: sourceStage,
        board_order: i
      });
    }
  }

  const updateMap = new Map(updates.map((u) => [u.id, u]));
  const next = leads.map((l) => {
    const u = updateMap.get(l.id);
    return u ? { ...l, stage: u.stage, board_order: u.board_order } : l;
  });
  return { next, updates };
}
