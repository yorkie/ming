export async function deepSeekRequestError(response: Response, stage: string): Promise<Error> {
  let detail = '';
  try {
    const body = await response.json() as { error?: { message?: unknown; code?: unknown } };
    const message = body?.error?.message;
    const code = body?.error?.code;
    if (typeof message === 'string') detail = message;
    else if (typeof code === 'string') detail = code;
  } catch { /* Keep the HTTP status when the provider did not return JSON. */ }
  return new Error(`DeepSeek ${stage} request failed (${response.status})${detail ? `: ${detail.slice(0, 600)}` : '.'}`);
}
