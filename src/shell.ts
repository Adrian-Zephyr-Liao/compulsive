export function quoteZsh(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

export function formatCdCommand(absolutePath: string): string {
  return `cd -- ${quoteZsh(absolutePath)}`;
}
