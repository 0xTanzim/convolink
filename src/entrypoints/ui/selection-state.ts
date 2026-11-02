export interface SelectionItem {
  readonly id: string;
  readonly label: string;
  readonly hint?: string;
}

export interface SelectionState {
  readonly items: readonly SelectionItem[];
  readonly query: string;
  readonly visible: readonly number[];
  readonly cursor: number;
}

export type SelectionAction =
  | { readonly type: "move"; readonly delta: number }
  | { readonly type: "character"; readonly value: string }
  | { readonly type: "backspace" }
  | { readonly type: "clear" };

function matches(item: SelectionItem, query: string): boolean {
  if (!query) return true;
  return `${item.label} ${item.id}`.toLowerCase().includes(query.toLowerCase());
}

function recompute(items: readonly SelectionItem[], query: string): readonly number[] {
  return items.reduce<number[]>((indexes, item, index) => {
    if (matches(item, query)) indexes.push(index);
    return indexes;
  }, []);
}

export function visibleItems(state: SelectionState): SelectionItem[] {
  return state.visible.map((index) => state.items[index]!).filter(Boolean);
}

export function createSelection(
  items: readonly SelectionItem[],
  initial?: SelectionItem,
): SelectionState {
  const index = initial ? items.findIndex((item) => item.id === initial.id) : 0;
  return {
    items,
    query: "",
    visible: recompute(items, ""),
    cursor: index >= 0 ? index : 0,
  };
}

export function selectedItem(state: SelectionState): SelectionItem | null {
  if (state.visible.length === 0) return null;
  const position = state.visible.indexOf(state.cursor);
  const index = position === -1 ? state.visible[0]! : state.cursor;
  return state.items[index] ?? null;
}

export function applyAction(state: SelectionState, action: SelectionAction): SelectionState {
  if (action.type === "character") {
    const query = state.query + action.value;
    const visible = recompute(state.items, query);
    const current = selectedItem(state);
    const keep = current ? visible.find((index) => state.items[index]?.id === current.id) : undefined;
    return { ...state, query, visible, cursor: keep ?? visible[0] ?? 0 };
  }

  if (action.type === "backspace") {
    const query = state.query.slice(0, -1);
    const visible = recompute(state.items, query);
    const current = selectedItem(state);
    const keep = current ? visible.find((index) => state.items[index]?.id === current.id) : undefined;
    return { ...state, query, visible, cursor: keep ?? visible[0] ?? 0 };
  }

  if (action.type === "clear") {
    return { ...state, query: "", visible: recompute(state.items, ""), cursor: 0 };
  }

  if (state.visible.length === 0) return state;
  const position = Math.max(0, state.visible.indexOf(state.cursor));
  const next = Math.min(Math.max(position + action.delta, 0), state.visible.length - 1);
  return { ...state, cursor: state.visible[next]! };
}
