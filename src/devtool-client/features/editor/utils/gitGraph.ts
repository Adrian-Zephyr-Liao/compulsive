export function gitGraph(commits: ReadonlyArray<{ id: string; parents: string[] }>) {
  let lanes: string[] = [];
  return commits.map((commit) => {
    let column = lanes.indexOf(commit.id);
    const incoming = column >= 0;
    if (!incoming) {
      column = lanes.length;
      lanes.push(commit.id);
    }
    const before = [...lanes];
    const next = lanes.filter((id) => id !== commit.id);
    for (const [index, parent] of commit.parents.entries())
      if (!next.includes(parent)) next.splice(Math.min(column + index, next.length), 0, parent);
    const edges = before
      .filter((id) => id !== commit.id)
      .map((id) => ({ from: before.indexOf(id), to: next.indexOf(id), parent: false }));
    for (const parent of commit.parents)
      edges.push({ from: column, to: next.indexOf(parent), parent: true });
    lanes = next;
    return {
      id: commit.id,
      column,
      incoming,
      width: Math.max(before.length, next.length, 1) * 12 + 8,
      edges,
    };
  });
}
