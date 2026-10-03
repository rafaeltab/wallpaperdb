export interface LayoutItem {
  id: string;
  width: number;
  height: number;
}
export interface GridLayoutOptions {
  items: LayoutItem[];
  gridWidth: number;
  expandedItemId?: string | null;
  viewportCenter?: { x: number; y: number } | null;
  marginOffset?: number;
}
export interface GridLayout {
  slots: number[];
  height: number;
}
