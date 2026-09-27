const DIFF_MARKER = 'DIFF LINES (fileIndex, hunkIndex, side, lineNumber):';
const HUNK_HEADER = /^.+ \(fileIndex=\d+, hunkIndex=\d+\) /;

/** Keep the checklist and line anchors in every smaller model request. */
export function splitReviewPrompt(prompt: string, maxBodyChars = 12_000): string[] {
  const marker = prompt.indexOf(DIFF_MARKER);
  if (marker < 0) return [prompt];
  const prefix = prompt.slice(0, marker + DIFF_MARKER.length);
  const lines = prompt.slice(marker + DIFF_MARKER.length).split('\n');
  const chunks: string[] = [];
  let body = '';
  let header = '';
  const flush = () => { if (body.trim()) chunks.push(`${prefix}\n${body}`); body = ''; };
  for (const line of lines) {
    if (HUNK_HEADER.test(line)) header = line;
    if (!line.trim() && !body) continue;
    const addition = `${line}\n`;
    if (body && body.length + addition.length > maxBodyChars) {
      flush();
      if (header && line !== header) body = `${header}\n`;
    }
    body += addition;
  }
  flush();
  return chunks.length > 1 ? chunks : [prompt];
}
