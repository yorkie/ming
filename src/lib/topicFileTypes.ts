import type { Topic } from './aiReviewTypes';
import type { Review } from './reviewTypes';

const types: Record<string, string> = {
  rs: 'Rust', ts: 'TypeScript', tsx: 'TypeScript', js: 'JavaScript', jsx: 'JavaScript', mjs: 'JavaScript', cjs: 'JavaScript',
  vue: 'Vue', py: 'Python', go: 'Go', java: 'Java', kt: 'Kotlin', kts: 'Kotlin', swift: 'Swift',
  c: 'C', h: 'C', cc: 'C++', cpp: 'C++', cxx: 'C++', hpp: 'C++',
  md: 'Markdown', mdx: 'MDX', markdown: 'Markdown', rst: 'reStructuredText', adoc: 'AsciiDoc', txt: 'Text',
  css: 'CSS', scss: 'SCSS', less: 'Less', html: 'HTML', htm: 'HTML', svg: 'SVG',
  json: 'JSON', jsonc: 'JSON', yaml: 'YAML', yml: 'YAML', toml: 'TOML', xml: 'XML',
  sh: 'Shell', bash: 'Shell', zsh: 'Shell', sql: 'SQL',
};

// GitHub Linguist language colors: https://github.com/github-linguist/linguist/blob/main/lib/linguist/languages.yml
const colors: Record<string, string> = {
  Rust: '#dea584', TypeScript: '#3178c6', JavaScript: '#f1e05a', Vue: '#41b883',
  Python: '#3572A5', Go: '#00ADD8', Java: '#b07219', Kotlin: '#A97BFF', Swift: '#F05138',
  C: '#555555', 'C++': '#f34b7d', Markdown: '#083fa1', MDX: '#fcb32c',
  AsciiDoc: '#73a0c5', reStructuredText: '#141414', CSS: '#663399', SCSS: '#c6538c',
  HTML: '#e34c26', SVG: '#ff9900', JSON: '#292929', YAML: '#cb171e', TOML: '#9c4221',
  XML: '#0060ac', Shell: '#89e051', SQL: '#e38c00', Dockerfile: '#384d54', Makefile: '#427819',
};

export function topicFileTypeColor(type: string): string { return colors[type] ?? '#d1d9e0'; }

function fileType(path: string): string {
  const name = path.split('/').pop()?.toLowerCase() ?? '';
  if (name === 'readme') return 'Text';
  if (name === 'dockerfile') return 'Dockerfile';
  if (name === 'makefile') return 'Makefile';
  const extension = name.includes('.') ? name.split('.').pop()! : '';
  return types[extension] ?? 'Other';
}

export function topicFileTypes(topic: Topic, review: Review | null): string[] {
  if (!review) return [];
  const result = new Set<string>();
  for (const id of topic.unitIds) {
    const match = /^f(\d+)(?:h\d+)?$/.exec(id);
    if (!match) continue;
    const file = review.files[Number(match[1])];
    if (file) result.add(fileType(file.path));
  }
  return [...result];
}
