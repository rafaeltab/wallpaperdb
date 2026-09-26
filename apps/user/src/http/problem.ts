export function problem(status: number, name: string, title: string, detail?: string) {
  return {
    type: `https://github.com/rafaeltab/wallpaperdb/blob/main/docs/problems/${name}.md`,
    title,
    status,
    ...(detail ? { detail } : {}),
  };
}
