import Prism, { type GrammarValue, type TokenStream } from 'prismjs';
import 'prismjs/components/prism-markup';
import 'prismjs/components/prism-css';
import 'prismjs/components/prism-javascript';
import 'prismjs/components/prism-typescript';
import 'prismjs/components/prism-jsx';
import 'prismjs/components/prism-tsx';
import 'prismjs/components/prism-json';
import 'prismjs/components/prism-rust';
import 'prismjs/components/prism-kotlin';
import 'prismjs/components/prism-swift';
import 'prismjs/components/prism-c';
import 'prismjs/components/prism-cpp';
import 'prismjs/components/prism-java';
import 'prismjs/components/prism-markdown';
import 'prismjs/components/prism-bash';
import 'prismjs/components/prism-yaml';
import 'prismjs/components/prism-python';
import 'prismjs/components/prism-go';
import 'prismjs/components/prism-toml';
import 'prismjs/components/prism-sql';

const vueGrammar = Prism.languages.extend('markup', {}) as Record<string, GrammarValue>;
vueGrammar.script = {
  pattern: /(<script\b[^>]*>)[\s\S]*?(?=<\/script\s*>)/i,
  lookbehind: true,
  greedy: true,
  inside: {
    'language-typescript': {
      pattern: /[\s\S]+/,
      inside: Prism.languages.typescript,
    },
  },
};
vueGrammar.interpolation = {
  pattern: /\{\{[\s\S]*?\}\}/,
  greedy: true,
  inside: {
    punctuation: /^\{\{|\}\}$/,
    expression: {
      pattern: /[\s\S]+/,
      inside: Prism.languages.typescript,
    },
  },
};
Prism.languages.vue = vueGrammar;

const languages: Record<string, string> = {
  ts: 'typescript', tsx: 'tsx', js: 'javascript', jsx: 'jsx', mjs: 'javascript', cjs: 'javascript',
  json: 'json', jsonc: 'javascript', rs: 'rust', kt: 'kotlin', kts: 'kotlin', swift: 'swift',
  c: 'c', h: 'cpp', cc: 'cpp', cpp: 'cpp', cxx: 'cpp', hpp: 'cpp', java: 'java',
  css: 'css', scss: 'css', html: 'markup', htm: 'markup', xml: 'markup', svg: 'markup', vue: 'vue',
  md: 'markdown', mdx: 'markdown', sh: 'bash', bash: 'bash', zsh: 'bash',
  yaml: 'yaml', yml: 'yaml', py: 'python', go: 'go', toml: 'toml', sql: 'sql',
};

const escapeHtml = (value: string) => value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);

function vueFragmentGrammar(lines: string[]): string {
  const first = lines.find(line => line.trim())?.trim() ?? '';
  if (!first || first.startsWith('<') || first.startsWith('{{')) return 'vue';
  if (/^(?:[.#][\w-]+|@(?:media|keyframes)\b|:root\b|[\w-]+\s*\{)/.test(first) || /^[\w-]+\s*:\s*[^=]/.test(first)) return 'css';
  return 'typescript';
}

export function highlightLines(path: string, sourceLines: string[]): string[] {
  if (!sourceLines.length) return [];
  const extension = path.split('/').pop()?.split('.').pop()?.toLowerCase() ?? '';
  const language = extension === 'vue' ? vueFragmentGrammar(sourceLines) : languages[extension];
  const grammar = Prism.languages[language];
  if (!grammar) return sourceLines.map(escapeHtml);

  const output = [''];
  const append = (value: string, classes: string[]) => {
    value.split('\n').forEach((part, index) => {
      if (index) output.push('');
      const html = classes.reduceRight((content, name) => `<span class="token ${escapeHtml(name)}">${content}</span>`, escapeHtml(part));
      output[output.length - 1] += html;
    });
  };
  const visit = (stream: TokenStream, classes: string[] = []) => {
    if (typeof stream === 'string') return append(stream, classes);
    if (Array.isArray(stream)) return stream.forEach(token => visit(token, classes));
    const alias = stream.alias ? Array.isArray(stream.alias) ? stream.alias : [stream.alias] : [];
    visit(stream.content, [...classes, [stream.type, ...alias].join(' ')]);
  };
  visit(Prism.tokenize(sourceLines.join('\n'), grammar));
  return output;
}
