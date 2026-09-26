export type FileTreeNode = {
  name: string;
  path: string;
  kind: 'directory' | 'file';
  count: number;
  children: FileTreeNode[];
  fileIndex?: number;
};

export function buildFileTree(paths: string[]): FileTreeNode[] {
  const root: FileTreeNode = { name: '', path: '', kind: 'directory', count: 0, children: [] };
  const childMaps = new WeakMap<FileTreeNode, Map<string, FileTreeNode>>();
  paths.forEach((path, fileIndex) => {
    const segments = path.split('/').filter(Boolean);
    let parent = root;
    parent.count++;
    for (let index = 0; index < segments.length; index++) {
      const name = segments[index];
      const kind = index === segments.length - 1 ? 'file' : 'directory';
      let siblings = childMaps.get(parent);
      if (!siblings) { siblings = new Map(); childMaps.set(parent, siblings); }
      const key = `${kind}:${name}`;
      let child = siblings.get(key);
      if (!child) {
        child = { name, path: parent.path ? `${parent.path}/${name}` : name, kind, count: 0, children: [], ...(kind === 'file' ? { fileIndex } : {}) };
        parent.children.push(child);
        siblings.set(key, child);
      }
      child.count++;
      parent = child;
    }
  });
  const sort = (nodes: FileTreeNode[]) => {
    nodes.sort((a, b) => a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === 'directory' ? -1 : 1);
    nodes.forEach(node => sort(node.children));
  };
  sort(root.children);
  return root.children;
}

export function filterFileTree(nodes: FileTreeNode[], query: string): FileTreeNode[] {
  const term = query.trim().toLowerCase();
  if (!term) return nodes;
  const filter = (node: FileTreeNode): FileTreeNode | null => {
    if (node.kind === 'file') return node.path.toLowerCase().includes(term) ? node : null;
    const children = node.children.map(filter).filter((child): child is FileTreeNode => child !== null);
    return children.length ? { ...node, children, count: children.reduce((count, child) => count + child.count, 0) } : null;
  };
  return nodes.map(filter).filter((node): node is FileTreeNode => node !== null);
}

export function compactDirectory(node: FileTreeNode): { label: string; node: FileTreeNode } {
  const parts = [node.name];
  while (node.kind === 'directory' && node.children.length === 1 && node.children[0].kind === 'directory') {
    node = node.children[0];
    parts.push(node.name);
  }
  return { label: parts.join('/'), node };
}
