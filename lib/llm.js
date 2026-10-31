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
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

const DEFAULTS = {
  enabled: true,
  baseUrl: 'https://api.minimax.cn/v1',
  model: 'MiniMax-M3.1-Flash',
  apiKey: '',
  timeoutMs: 25000,
  maxInputChars: 20000,
  maxItemsPerRequest: 200,
  requestsPerHourPerUser: 30,
  suggestPerHourPerUser: 60,
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
    'You are a date and time extractor. Read the user\u2019s pasted text and return ONLY a JSON object',
    '{"items":[{"date":"YYYY-MM-DD","start":"HH:MM","end":"HH:MM","text":"...","guessed":false}]}',
    '\u2014 no prose, no code fences. "start"/"end" are optional 24-hour HH:MM times.',
    `Today is ${today} (${weekday}). Resolve relative dates from it.`,
    'Handle, in English and Chinese: today / yesterday / the day before yesterday / \u4eca\u5929 / \u6628\u5929 / \u524d\u5929;',
    'last Friday / \u4e0a\u5468\u4e94 / \u661f\u671f\u4e09 / \u5468\u4e09; Oct 20, October 20 / 10\u670820\u65e5 / 10\u670820\u53f7 / 2026\u5e7410\u670820\u65e5;',
    '20/10; next week.',
    'Times: detect clocks and ranges \u2014 14:00, 9:30am, 3pm-5pm, 14:00-16:00, 2\u70b9\u52304\u70b9,',
    '\u4e0b\u53482\u70b9\u5230\u56db\u70b9, \u4e0a\u53939\u70b9. A range sets start and end; a single clock sets start only;',
    'convert to 24-hour HH:MM; never set end without start; a time belongs to its line\u2019s date,',
    'never becomes a date itself.',
    'Rules: split multi-date pastes into separate items; one item per discrete thought;',
    'keep the author\u2019s wording, only trimming and joining wrapped lines;',
    `when an item has no determinable date use ${today} and set "guessed": true;`,
    'never invent dates or times; never drop text.',
  ].join('\n');
}

/**
 * Parse pasted text into dated items via MiniMax's OpenAI-compatible
 * chat-completions API. Returns { items: [{date, text, guessed}] }.
 */
/**
 * One chat-completions round trip: AbortController timeout, Bearer auth,
 * 429 / !ok (with the upstream error message), base_resp check, and the
 * message content extracted and returned as a string. No `thinking` field
 * unless configured (MiniMax-M3.1-Flash requires adaptive thinking).
 *
 * MiniMax runs two platforms with platform-scoped keys — international
 * (api.minimax.io) and mainland (api.minimaxi.com / api.minimax.chat) —
 * and a key on the wrong one fails with 401 "invalid api key". Keys carry
 * no visible marker of which platform they belong to, so on exactly that
 * upstream signature the request is retried once against the sibling
 * platform before failing. A truly invalid key still fails, with a
 * message naming the baseUrl fix.
 */
const SIBLING_HOSTS = {
  'api.minimax.io': 'api.minimaxi.com',
  'api.minimaxi.com': 'api.minimax.io',
  'api.minimax.chat': 'api.minimax.io',
  'api.minimax.cn': 'api.minimax.io',
};

async function chat(messages, { temperature, maxTokens }) {
  if (!config) throw err('llm_failed', 'LLM parsing is not configured');
  const base = config.baseUrl.replace(/\/$/, '');
  const body = JSON.stringify({
    model: config.model,
    messages,
    max_completion_tokens: maxTokens,
    temperature,
    ...(config.thinking ? { thinking: config.thinking } : {}),
  });
  const attempt = async (url) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), config.timeoutMs);
    try {
      return await fetch(url, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${config.apiKey}`,
        },
        body,
      });
    } catch (e) {
      if (e && e.name === 'AbortError') throw err('llm_timeout', 'The AI request timed out');
      throw err('llm_failed', 'Could not reach the AI service');
    } finally {
      clearTimeout(timer);
    }
  };

  let resp = await attempt(`${base}/chat/completions`);

  if (resp.status === 429) throw err('llm_rate_limited', 'The AI service is rate-limiting requests');
  if (resp.status === 401) {
    let detail401 = '';
    let bodyText = '';
    try {
      bodyText = await resp.text();
      const e = JSON.parse(bodyText);
      if (e && e.error && typeof e.error.message === 'string') detail401 = e.error.message;
    } catch { /* not JSON */ }
    const host = new URL(base).host;
    const sibling = SIBLING_HOSTS[host];
    if (sibling && /invalid api key/i.test(detail401)) {
      const retried = await attempt(`https://${sibling}${new URL(base).pathname}/chat/completions`);
      if (retried.ok) {
        resp = retried;
      } else {
        retried.body?.cancel?.().catch?.(() => {});
        throw err('llm_failed',
          `The AI service rejected the key on both platforms (HTTP 401: ${detail401}). ` +
          `Check llm.apiKey, or set llm.baseUrl to the platform the key belongs to ` +
          `(https://api.minimax.cn/v1 = mainland, https://api.minimax.io/v1 = international).`);
      }
    } else {
      throw err('llm_failed', `The AI service returned HTTP 401${detail401 ? `: ${detail401}` : ''}`);
    }
  }
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
  return content;
}

/** Defensive JSON-object extraction: strip fences, slice braces, parse. */
function parseJsonObject(content) {
  const candidate = content.replace(/```[a-z]*\n?/gi, '').replace(/```/g, '').trim();
  const first = candidate.indexOf('{');
  const last = candidate.lastIndexOf('}');
  if (first < 0 || last <= first) throw err('llm_unparsable', 'The AI response contained no JSON object');
  try {
    const parsed = JSON.parse(candidate.slice(first, last + 1));
    if (!parsed || typeof parsed !== 'object') throw new Error();
    return parsed;
  } catch {
    throw err('llm_unparsable', 'The AI response was not valid JSON');
  }
}

async function parseTimelineText({ text, today, weekday }) {
  const content = await chat(
    [
      { role: 'system', content: systemPrompt(today, weekday) },
      { role: 'user', content: String(text) },
    ],
    { temperature: 0.1, maxTokens: config.maxCompletionTokens },
  );

  const parsed = parseJsonObject(content);
  const rawItems = parsed && Array.isArray(parsed.items) ? parsed.items : null;
  if (!rawItems || rawItems.length === 0) throw err('llm_unparsable', 'The AI response contained no items');

  const items = [];
  for (const it of rawItems.slice(0, config.maxItemsPerRequest)) {
    if (!it || typeof it !== 'object') continue;
    if (!isRealDate(it.date, today)) continue;
    if (typeof it.text !== 'string') continue;
    const t = it.text.trim().slice(0, 4000);
    if (!t) continue;
    // times: valid HH:MM or dropped; end only with start, never before it
    const start = TIME_RE.test(it.start || '') ? it.start : null;
    let end = TIME_RE.test(it.end || '') ? it.end : null;
    if (!start || (end && end < start)) end = null;
    items.push({ date: it.date, start, end, text: t, guessed: it.guessed === true });
  }
  if (items.length === 0) throw err('llm_unparsable', 'The AI response had no usable items');
  return { items };
}

/**
 * Generate a title and/or tags for one card's content. Only the card's
 * content is sent; the result is cleaned and clamped here so callers can
 * trust it. A requested field with no usable output -> llm_unparsable.
 */
async function suggestMetadata({ content, needTitle, needTags, maxTags = 5 }) {
  const system = [
    'You are a metadata generator. Return ONLY a JSON object, no prose, no code fences,',
    'shaped {"title":"...","tags":["..."]}.',
    'The title is at most 60 characters, no surrounding quotes, no trailing period,',
    'in the SAME LANGUAGE as the content, and must not restate the first sentence verbatim.',
    'Tags are 3-5 short lowercase phrases (no #, no duplicates, nothing generic like',
    '"note" or "misc"), in the same language as the content.',
    'Omit "title" when only tags are requested and vice versa.',
    'Never invent facts that are not in the content.',
  ].join(' ');
  const content0 = await chat(
    [
      { role: 'system', content: system },
      { role: 'user', content: String(content) },
    ],
    { temperature: 0.3, maxTokens: config.maxCompletionTokens },
  );
  const parsed = parseJsonObject(content0);

  const out = {};
  if (needTitle) {
    let t = typeof parsed.title === 'string' ? parsed.title : '';
    t = t.trim().replace(/^["'\u201c\u2018]+|["'\u201d\u2019]+$/g, '');
    t = t.replace(/[.。]\s*$/, '').trim().slice(0, 200);
    if (!t) throw err('llm_unparsable', 'The AI response had no usable title');
    out.title = t;
  }
  if (needTags) {
    const seen = new Set();
    const tags = [];
    for (let t of Array.isArray(parsed.tags) ? parsed.tags : []) {
      if (typeof t !== 'string') continue;
      t = t.replace(/^#+/, '').trim().toLowerCase().slice(0, 32);
      if (!t) continue;
      if (seen.has(t)) continue;
      seen.add(t);
      tags.push(t);
      if (tags.length >= maxTags) break;
    }
    if (tags.length === 0) throw err('llm_unparsable', 'The AI response had no usable tags');
    out.tags = tags;
  }
  return out;
}

module.exports = { configure, isConfigured, describeConfig, parseTimelineText, suggestMetadata, normaliseConfig, DEFAULTS };
