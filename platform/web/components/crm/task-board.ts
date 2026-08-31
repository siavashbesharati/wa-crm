import { TASK_STATUSES, type CrmTask } from "./shared";

export type TaskBoardOrderUpdate = {
  id: string;
  status: string;
  board_order: number;
};

export function sortTasksForBoard(tasks: CrmTask[]): CrmTask[] {
  const rank = new Map<string, number>(TASK_STATUSES.map((s, i) => [s, i]));
  return [...tasks].sort((a, b) => {
    const sa = rank.get(a.status) ?? TASK_STATUSES.length;
    const sb = rank.get(b.status) ?? TASK_STATUSES.length;
    if (sa !== sb) return sa - sb;
    const oa = a.board_order ?? 0;
    const ob = b.board_order ?? 0;
    if (oa !== ob) return oa - ob;
    return (a.title || "").localeCompare(b.title || "", "fa");
  });
}

export function tasksInStatus(tasks: CrmTask[], status: string): CrmTask[] {
  return sortTasksForBoard(tasks).filter((t) => t.status === status);
}

export function buildTaskBoardReorder(
  tasks: CrmTask[],
  dragId: string,
  targetStatus: string,
  targetId: string | null,
  insertBefore: boolean
): { next: CrmTask[]; updates: TaskBoardOrderUpdate[] } {
  const dragged = tasks.find((t) => t.id === dragId);
  if (!dragged) return { next: tasks, updates: [] };

  const sourceStatus = dragged.status;
  let columnItems = tasksInStatus(tasks, targetStatus).filter((t) => t.id !== dragId);

  let insertIndex = columnItems.length;
  if (targetId) {
    const targetIndex = columnItems.findIndex((t) => t.id === targetId);
    if (targetIndex >= 0) {
      insertIndex = insertBefore ? targetIndex : targetIndex + 1;
    }
  }

  const moved: CrmTask = { ...dragged, status: targetStatus };
  columnItems.splice(insertIndex, 0, moved);

  const updates: TaskBoardOrderUpdate[] = columnItems.map((t, i) => ({
    id: t.id,
    status: targetStatus,
    board_order: i
  }));

  if (sourceStatus !== targetStatus) {
    const sourceItems = tasksInStatus(tasks, sourceStatus).filter((t) => t.id !== dragId);
    for (let i = 0; i < sourceItems.length; i += 1) {
      updates.push({
        id: sourceItems[i].id,
        status: sourceStatus,
        board_order: i
      });
    }
  }

  const updateMap = new Map(updates.map((u) => [u.id, u]));
  const next = tasks.map((t) => {
    const u = updateMap.get(t.id);
    return u ? { ...t, status: u.status, board_order: u.board_order } : t;
  });
  return { next, updates };
}
