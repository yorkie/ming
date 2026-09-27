const DIFF_MARKER = 'DIFF LINES (fileIndex, hunkIndex, side, lineNumber):';
const HUNK_HEADER = /^.+ \(fileIndex=\d+, hunkIndex=\d+\) /;

/** Keep the checklist and line anchors in every smaller model request. */
export function splitReviewPrompt(prompt: string, maxBodyChars = 12_000, force = false): string[] {
  const marker = prompt.indexOf(DIFF_MARKER);
  if (marker < 0) return [prompt];
  const prefix = prompt.slice(0, marker + DIFF_MARKER.length);
  const lines = prompt.slice(marker + DIFF_MARKER.length).split('\n');
  const bodyLimit = force ? Math.min(maxBodyChars, Math.max(1, Math.floor(lines.join('\n').length / 2))) : maxBodyChars;
  const chunks: string[] = [];
  let body = '';
  let header = '';
  let hasDiffLine = false;
  const flush = () => { if (hasDiffLine) chunks.push(`${prefix}\n${body}`); body = ''; hasDiffLine = false; };
  for (const line of lines) {
    if (HUNK_HEADER.test(line)) header = line;
    if (!line.trim() && !body) continue;
    const addition = `${line}\n`;
    if (body && hasDiffLine && body.length + addition.length > bodyLimit) {
      flush();
      if (header && line !== header) body = `${header}\n`;
    }
    body += addition;
    if (/^(LEFT|RIGHT):\d+ /.test(line)) hasDiffLine = true;
  }
  flush();
  return chunks.length > 1 ? chunks : [prompt];
}
