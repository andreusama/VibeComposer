import { describe, it, expect, vi } from 'vitest';

// Same reasoning as baulProcessor.test.js: api.js's checkAndIncrementLimit
// touches localStorage, which doesn't exist under Vitest's node
// environment, and these tests aren't about rate limiting anyway. The stub
// mirrors callClaudeOnce's real request shape so the fetch-call assertions
// below still exercise it faithfully.
vi.mock('../utils/api.js', () => ({
  API_URL: '/api/claude',
  checkAndIncrementLimit: vi.fn(),
  callClaudeOnce: async ({ model, system, userContent, maxTokens }) => {
    const response = await fetch('/api/claude', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, max_tokens: maxTokens, thinking: { type: 'disabled' }, system, messages: [{ role: 'user', content: userContent }] }),
    });
    if (!response.ok) throw new Error(`API error ${response.status}`);
    const data = await response.json();
    return data.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
  },
}));

import { parseImportResponse, segmentImportedText, segmentImportedImage, MAX_IMPORT_CHARS } from './resourceImportProcessor.js';

function mockClaudeResponse(text) {
  global.fetch = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ content: [{ type: 'text', text }] }),
  });
}

describe('parseImportResponse', () => {
  it('parses a clean list of candidates', () => {
    const raw = JSON.stringify({
      items: [
        { body: 'no hay mal que por bien no venga', type: 'proverb', tags: ['esperanza'], origin: null },
        { body: 'la casa por la ventana', type: 'phrase', tags: [], origin: 'mensaje de Marta' },
      ],
    });
    expect(parseImportResponse(raw)).toEqual([
      { body: 'no hay mal que por bien no venga', type: 'proverb', tags: ['esperanza'], origin: null },
      { body: 'la casa por la ventana', type: 'phrase', tags: [], origin: 'mensaje de Marta' },
    ]);
  });

  it('strips markdown fences', () => {
    const raw = '```json\n' + JSON.stringify({ items: [{ body: 'x', type: null, tags: [], origin: null }] }) + '\n```';
    expect(parseImportResponse(raw)).toHaveLength(1);
  });

  it('accepts "lesson" as a valid type (craft insight, distinct from a literary metaphor)', () => {
    const raw = JSON.stringify({
      items: [{ body: 'la ESTRUCTURA es una selección de acontecimientos...', type: 'lesson', tags: ['estructura'], origin: 'pg 53' }],
    });
    expect(parseImportResponse(raw)).toEqual([
      { body: 'la ESTRUCTURA es una selección de acontecimientos...', type: 'lesson', tags: ['estructura'], origin: 'pg 53' },
    ]);
  });

  it('drops items with no real body, never invents type/tags/origin', () => {
    const raw = JSON.stringify({
      items: [
        { body: '   ', type: 'phrase', tags: [], origin: null },
        { body: 'real one', type: 'not-a-real-type', tags: ['a', 'b', 'c', 'd'], origin: 42 },
      ],
    });
    const result = parseImportResponse(raw);
    expect(result).toEqual([{ body: 'real one', type: null, tags: ['a', 'b', 'c'], origin: null }]);
  });

  it('returns an empty list for genuinely empty input (all noise, nothing worth keeping)', () => {
    expect(parseImportResponse(JSON.stringify({ items: [] }))).toEqual([]);
  });

  it('never throws on garbage, returns empty instead', () => {
    expect(parseImportResponse('not json at all')).toEqual([]);
    expect(parseImportResponse(undefined)).toEqual([]);
    expect(parseImportResponse('{"items": "not an array"}')).toEqual([]);
  });
});

describe('segmentImportedText', () => {
  it('returns no candidates for empty/whitespace input without calling the API', async () => {
    global.fetch = vi.fn();
    expect(await segmentImportedText('   ')).toEqual({ candidates: [], truncated: false });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('calls the API and returns parsed candidates', async () => {
    mockClaudeResponse(JSON.stringify({ items: [{ body: 'x', type: 'metaphor', tags: [], origin: null }] }));
    const result = await segmentImportedText('some pasted text');
    expect(result.truncated).toBe(false);
    expect(result.candidates).toEqual([{ body: 'x', type: 'metaphor', tags: [], origin: null }]);
  });

  it('truncates input over the cap and reports it', async () => {
    mockClaudeResponse(JSON.stringify({ items: [] }));
    const longText = 'a'.repeat(MAX_IMPORT_CHARS + 500);
    const result = await segmentImportedText(longText);
    expect(result.truncated).toBe(true);
    const sentBody = JSON.parse(global.fetch.mock.calls[0][1].body);
    expect(sentBody.messages[0].content.length).toBeLessThan(longText.length);
  });
});

describe('segmentImportedImage', () => {
  it('returns no candidates for a missing image without calling the API', async () => {
    global.fetch = vi.fn();
    expect(await segmentImportedImage({})).toEqual({ candidates: [], truncated: false });
    expect(await segmentImportedImage()).toEqual({ candidates: [], truncated: false });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('sends an image content block and returns parsed candidates', async () => {
    mockClaudeResponse(JSON.stringify({ items: [{ body: 'la vida es sueño', type: 'metaphor', tags: [], origin: null }] }));
    const result = await segmentImportedImage({ base64: 'ZmFrZQ==', mimeType: 'image/png' });
    expect(result).toEqual({ truncated: false, candidates: [{ body: 'la vida es sueño', type: 'metaphor', tags: [], origin: null }] });
    const sentBody = JSON.parse(global.fetch.mock.calls[0][1].body);
    const blocks = sentBody.messages[0].content;
    expect(blocks[0]).toEqual({ type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'ZmFrZQ==' } });
    expect(blocks[1].type).toBe('text');
  });

  it('defaults to image/jpeg when no mimeType is given', async () => {
    mockClaudeResponse(JSON.stringify({ items: [] }));
    await segmentImportedImage({ base64: 'ZmFrZQ==' });
    const sentBody = JSON.parse(global.fetch.mock.calls[0][1].body);
    expect(sentBody.messages[0].content[0].source.media_type).toBe('image/jpeg');
  });
});
