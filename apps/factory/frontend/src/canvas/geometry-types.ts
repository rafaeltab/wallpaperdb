import type { Rect } from './routing';
import type { CanvasItem as Item } from './view-model';
export type Stage = 'planned' | 'working' | 'review' | 'unclassified';
export type Box = Rect & { item: Item };
export type Group = {
  key: string;
  parent?: number;
  stage: Stage;
  x: number;
  y: number;
  width: number;
  height: number;
  head: number;
  headingWidth: number;
  depth: number;
  collapsed: boolean;
  ids: number[];
};
export type StackRow = {
  item: Item;
  key: string;
  y: number;
  height: number;
  offset: number;
};
export type Panel = {
  key: string;
  name: string;
  ids: number[];
  x: number;
  y: number;
  width: number;
  height: number;
  stacked: boolean;
  rows: StackRow[];
  collapsed: boolean;
};
export type TitleMode = 'wrap' | 'ellipsis' | 'expand';
export type HighlightStyle = 'white' | 'status' | 'status-glow' | 'slate' | 'teal';
export type RelationshipMode = 'direct' | 'transitive' | 'all';
export type RelationshipDirection = 'both' | 'prerequisites' | 'dependants';
export type CanvasFocus = { id: number; instance: string };
export type LayoutOptions = {
  titleMode: TitleMode;
  expandedNames: Set<string>;
  hoverName?: string;
  collapsed?: Set<string>;
};
