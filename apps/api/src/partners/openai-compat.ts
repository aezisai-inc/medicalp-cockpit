/** Detect OpenAI-compatible chat completions endpoints (OpenRouter / Nosana vLLM / OpenAI). */
export function isChatCompletionsUrl(url: string): boolean {
  return /\/chat\/completions\/?$/i.test(url.replace(/\?.*$/, ""));
}

export type ChatContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };

export type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string | ChatContentPart[];
};

export async function postChatCompletions(opts: {
  url: string;
  apiKey: string;
  messages: ChatMessage[];
  model?: string;
  timeoutMs?: number;
  maxTokens?: number;
}): Promise<{ ok: boolean; text: string; raw: unknown }> {
  const res = await fetch(opts.url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${opts.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: opts.model ?? "gpt-4o-mini",
      messages: opts.messages,
      temperature: 0.2,
      ...(typeof opts.maxTokens === "number" ? { max_tokens: opts.maxTokens } : {}),
    }),
    signal: AbortSignal.timeout(opts.timeoutMs ?? 25_000),
  });
  const raw = (await res.json().catch(() => ({}))) as {
    choices?: { message?: { content?: string } }[];
    error?: unknown;
  };
  const text = raw.choices?.[0]?.message?.content?.trim() ?? "";
  return { ok: res.ok && Boolean(text), text, raw };
}

/** AgentField / custom Control Plane style POST (non-chat-completions). */
export async function postControlPlane(opts: {
  url: string;
  apiKey: string;
  body: Record<string, unknown>;
  timeoutMs?: number;
}): Promise<{ ok: boolean; json: Record<string, unknown> }> {
  const res = await fetch(opts.url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${opts.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(opts.body),
    signal: AbortSignal.timeout(opts.timeoutMs ?? 25_000),
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { ok: res.ok, json };
}
