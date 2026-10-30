'use strict';
/* MiniMax chat-completions client for "Paste & parse" on timeline notes.
 * Stdlib only: global fetch + AbortController (Node >= 18).
 *
 * The API key lives in the config object handed to configure() at server
 * startup and is never logged, returned, or embedded in an error message.
 * Every failure surfaces as an Error with a machine-readable .code:
 *   llm_timeout | llm_failed | llm_unparsable | llm_rate_limited
 */

const DATE_KEY_RE = /^\d{4}-\d{2}-\d{2}$/;

const DEFAULTS = {
  enabled: true,
  baseUrl: 'https://api.minimax.io/v1',
  model: 'MiniMax-M3.1-Flash',
  apiKey: '',
  timeoutMs: 25000,
  maxInputChars: 20000,
  maxItemsPerRequest: 200,
  requestsPerHourPerUser: 30,
  // Sent as `thinking` when set. Omitted by default: MiniMax-M3.1-Flash
  // REQUIRES adaptive thinking and rejects {"type":"disabled"} with a 400.
  thinking: null,
  // Headroom for adaptive-thinking tokens (reasoning counts toward the
  // completion budget), beyond the ~small extraction output itself.
  maxCompletionTokens: 4096,
};

let config = null;

/** Merge the file's llm section over the defaults; null when unusable. */
function normaliseConfig(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const l = raw.llm && typeof raw.llm === 'object' ? raw.llm : null;
  if (!l) return null;
  const cfg = { ...DEFAULTS, ...l };
  if (cfg.enabled !== true || typeof cfg.apiKey !== 'string' || !cfg.apiKey) return null;
  if (typeof cfg.baseUrl !== 'string' || !/^https?:\/\//.test(cfg.baseUrl)) return null;
  return cfg;
}

/** Called once at startup; returns the normalised config (or null when unusable). */
function configure(raw) {
  config = normaliseConfig(raw);
  return config;
}

function isConfigured() {
  return config != null;
}

/** The safe subset for debug logging — never the key. */
function describeConfig() {
  if (!config) return { enabled: false };
  return { enabled: true, baseUrl: config.baseUrl, model: config.model, hasKey: true };
}

function err(code, message) {
  const e = new Error(message || code);
  e.code = code;
  return e;
}

function isRealDate(s, todayKey) {
  if (typeof s !== 'string' || !DATE_KEY_RE.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  if (dt.getFullYear() !== y || dt.getMonth() !== m - 1 || dt.getDate() !== d) return false;
  // within ±100 years of today
  const [ty] = todayKey.split('-').map(Number);
  return Math.abs(y - ty) <= 100;
}

function systemPrompt(today, weekday) {
  return [
    'You are a date extractor. Read the user\u2019s pasted text and return ONLY a JSON object',
    '{"items":[{"date":"YYYY-MM-DD","text":"...","guessed":false}]} \u2014 no prose, no code fences.',
    `Today is ${today} (${weekday}). Resolve relative dates from it.`,
    'Handle, in English and Chinese: today / yesterday / the day before yesterday / \u4eca\u5929 / \u6628\u5929 / \u524d\u5929;',
    'last Friday / \u4e0a\u5468\u4e94 / \u661f\u671f\u4e09 / \u5468\u4e09; Oct 20, October 20 / 10\u670820\u65e5 / 10\u670820\u53f7 / 2026\u5e7410\u670820\u65e5;',
    '20/10; next week; bare times like 3pm (append the time to the enclosing date\u2019s text, never make it a date).',
    'Rules: split multi-date pastes into separate items; one item per discrete thought;',
    'keep the author\u2019s wording, only trimming and joining wrapped lines;',
    `when an item has no determinable date use ${today} and set "guessed": true;`,
    'never invent dates; never drop text.',
  ].join('\n');
}

/**
 * Parse pasted text into dated items via MiniMax's OpenAI-compatible
 * chat-completions API. Returns { items: [{date, text, guessed}] }.
 */
async function parseTimelineText({ text, today, weekday }) {
  if (!config) throw err('llm_failed', 'LLM parsing is not configured');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.timeoutMs);
  let resp;
  try {
    resp = await fetch(`${config.baseUrl.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        model: config.model,
        messages: [
          { role: 'system', content: systemPrompt(today, weekday) },
          { role: 'user', content: String(text) },
        ],
        max_completion_tokens: config.maxCompletionTokens,
        temperature: 0.1,
        ...(config.thinking ? { thinking: config.thinking } : {}),
      }),
    });
  } catch (e) {
    clearTimeout(timer);
    if (e && e.name === 'AbortError') throw err('llm_timeout', 'The AI request timed out');
    throw err('llm_failed', 'Could not reach the AI service');
  }
  clearTimeout(timer);

  if (resp.status === 429) throw err('llm_rate_limited', 'The AI service is rate-limiting requests');
  if (!resp.ok) {
    // Pull the platform's own reason out of the error body when present
    // (e.g. "insufficient balance (1008)") — response bodies cannot echo
    // the request or the key, so this is safe to show.
    let detail = '';
    try {
      const e = await resp.json();
      if (e && e.error && typeof e.error.message === 'string') detail = e.error.message;
    } catch { /* not JSON */ }
    throw err('llm_failed', `The AI service returned HTTP ${resp.status}${detail ? `: ${detail}` : ''}`);
  }

  let data;
  try {
    data = await resp.json();
  } catch {
    throw err('llm_unparsable', 'The AI response was not JSON');
  }
  // MiniMax reports application errors inside a 200 via base_resp.
  if (data && data.base_resp && data.base_resp.status_code !== 0) {
    const msg = typeof data.base_resp.status_msg === 'string' ? data.base_resp.status_msg : '';
    throw err('llm_failed', msg ? `The AI service reported: ${msg}` : 'The AI service reported an error');
  }
  const content = data && data.choices && data.choices[0] && data.choices[0].message &&
    typeof data.choices[0].message.content === 'string' ? data.choices[0].message.content : null;
  if (content == null) throw err('llm_unparsable', 'The AI response had no message content');

  // Defensive extraction: strip code fences, take the outermost JSON object.
  let candidate = content.replace(/```[a-z]*\n?/gi, '').replace(/```/g, '').trim();
  const first = candidate.indexOf('{');
  const last = candidate.lastIndexOf('}');
  if (first < 0 || last <= first) throw err('llm_unparsable', 'The AI response contained no JSON object');
  let parsed;
  try {
    parsed = JSON.parse(candidate.slice(first, last + 1));
  } catch {
    throw err('llm_unparsable', 'The AI response was not valid JSON');
  }
  const rawItems = parsed && Array.isArray(parsed.items) ? parsed.items : null;
  if (!rawItems || rawItems.length === 0) throw err('llm_unparsable', 'The AI response contained no items');

  const items = [];
  for (const it of rawItems.slice(0, config.maxItemsPerRequest)) {
    if (!it || typeof it !== 'object') continue;
    if (!isRealDate(it.date, today)) continue;
    if (typeof it.text !== 'string') continue;
    const t = it.text.trim().slice(0, 4000);
    if (!t) continue;
    items.push({ date: it.date, text: t, guessed: it.guessed === true });
  }
  if (items.length === 0) throw err('llm_unparsable', 'The AI response had no usable items');
  return { items };
}

module.exports = { configure, isConfigured, describeConfig, parseTimelineText, normaliseConfig, DEFAULTS };
