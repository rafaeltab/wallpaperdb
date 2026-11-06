// Read-only GitHub issue / project 7 snapshot. Workflow states and relationships in the canvas are simulated.
export type IssueMetadata = {
  number: number;
  title: string;
  url: string;
  labels: { name: string; color: string }[];
  priority: string | null;
  size: string | null;
};
