import { resolve } from 'node:path';
/** Namespace layout shared by runtime and read-only snapshot selection. */
export function jobStateDirectory(
  directory: string,
  issue: number,
  generation: number,
  rootIssue?: number
) {
  return generation === 0 && rootIssue === issue
    ? directory
    : resolve(directory, generation ? `issue-${issue}-generation-${generation}` : `issue-${issue}`);
}
