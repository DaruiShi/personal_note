'use strict';
/* lib/llm platform fallback: MiniMax keys are platform-scoped, and a key on
 * the wrong platform (api.minimax.io vs api.minimaxi.com) fails with 401
 * "invalid api key". chat() must retry the sibling platform once on exactly
 * that signature, and produce an actionable message when both reject. */

const test = require('node:test');
const assert = require('node:assert/strict');
const llm = require('../lib/llm');

function miniResp(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
    body: { cancel: async () => {} },
  };
}

function invalidKey() {
  return miniResp(401, { type: 'error', error: { type: 'authorized_error', message: 'invalid api key (2049)', http_code: '401' } });
}

function goodCompletion(content) {
  return miniResp(200, {
    choices: [{ message: { content } }],
    usage: {},
    base_resp: { status_code: 0, status_msg: 'ok' },
  });
}

function configureWith(baseUrl) {
  llm.configure({
    llm: {
      enabled: true,
      baseUrl,
      model: 'MiniMax-M3.1-Flash',
      apiKey: 'stub-key',
      timeoutMs: 5000,
    },
  });
}

test('401 invalid-key on one platform retries the sibling and succeeds', async () => {
  const realFetch = global.fetch;
  const calls = [];
  global.fetch = async (url) => {
    calls.push(String(url));
    return String(url).includes('api.minimaxi.com')
      ? goodCompletion('{"items":[{"date":"2026-10-30","text":"ok"}]}')
      : invalidKey();
  };
  try {
    configureWith('https://api.minimax.io/v1'); // wrong platform for the "key"
    const out = await llm.parseTimelineText({ text: 'ok', today: '2026-10-30', weekday: 'Friday' });
    assert.deepEqual(out.items, [{ date: '2026-10-30', start: null, end: null, text: 'ok', guessed: false }]);
    assert.equal(calls.length, 2);
    assert.ok(calls[0].startsWith('https://api.minimax.io/v1/chat/completions'));
    assert.ok(calls[1].startsWith('https://api.minimaxi.com/v1/chat/completions'));
  } finally {
    global.fetch = realFetch;
    llm.configure(null);
  }
});

test('both platforms reject -> llm_failed with the baseUrl hint', async () => {
  const realFetch = global.fetch;
  const calls = [];
  global.fetch = async (url) => {
    calls.push(String(url));
    return invalidKey();
  };
  try {
    configureWith('https://api.minimaxi.com/v1');
    await assert.rejects(
      llm.parseTimelineText({ text: 'x', today: '2026-10-30', weekday: 'Friday' }),
      (e) => {
        assert.equal(e.code, 'llm_failed');
        assert.match(e.message, /rejected the key on both platforms/);
        assert.match(e.message, /api\.minimax\.cn\/v1 = mainland, https:\/\/api\.minimax\.io\/v1 = international/);
        return true;
      },
    );
    assert.equal(calls.length, 2);
  } finally {
    global.fetch = realFetch;
    llm.configure(null);
  }
});

test('a non-platform 401 (e.g. proxy auth) does NOT trigger the retry', async () => {
  const realFetch = global.fetch;
  const calls = [];
  global.fetch = async (url) => {
    calls.push(String(url));
    return miniResp(401, { error: { message: 'Bearer realm="proxy"' } });
  };
  try {
    configureWith('https://api.minimax.io/v1');
    await assert.rejects(
      llm.parseTimelineText({ text: 'x', today: '2026-10-30', weekday: 'Friday' }),
      (e) => {
        assert.equal(e.code, 'llm_failed');
        assert.doesNotMatch(e.message, /both platforms/);
        return true;
      },
    );
    assert.equal(calls.length, 1); // no sibling attempt
  } finally {
    global.fetch = realFetch;
    llm.configure(null);
  }
});

test('401 on an unknown host (custom proxy) does not retry', async () => {
  const realFetch = global.fetch;
  const calls = [];
  global.fetch = async (url) => {
    calls.push(String(url));
    return invalidKey();
  };
  try {
    configureWith('https://llm-proxy.example.com/v1');
    await assert.rejects(
      llm.parseTimelineText({ text: 'x', today: '2026-10-30', weekday: 'Friday' }),
      (e) => e.code === 'llm_failed',
    );
    assert.equal(calls.length, 1);
  } finally {
    global.fetch = realFetch;
    llm.configure(null);
  }
});
