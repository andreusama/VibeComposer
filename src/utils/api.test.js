import { describe, it, expect } from 'vitest';
import { throwIfQuotaRefused } from './api.js';

const res = (status, body) => new Response(JSON.stringify(body), { status });

describe('throwIfQuotaRefused', () => {
  it('lets a normal response through', async () => {
    await expect(throwIfQuotaRefused(res(200, {}))).resolves.toBeUndefined();
    await expect(throwIfQuotaRefused(res(500, {}))).resolves.toBeUndefined();
  });

  it('explains the daily cap (per-user or shared) instead of "API error 429"', async () => {
    await expect(throwIfQuotaRefused(res(429, { error: 'Daily limit reached — come back tomorrow.' })))
      .rejects.toThrow(/límite de hoy/);
  });

  it('tells a per-minute burst limit apart from the daily one', async () => {
    await expect(throwIfQuotaRefused(res(429, { error: 'Too many requests — try again in a minute.' })))
      .rejects.toThrow(/espera un minuto/);
  });

  it('reports an unavailable usage check as such, and survives a non-JSON body', async () => {
    await expect(throwIfQuotaRefused(res(503, { error: 'Usage check unavailable' }))).rejects.toThrow(/no está disponible/);
    await expect(throwIfQuotaRefused(new Response('oops', { status: 429 }))).rejects.toThrow(/espera un minuto/);
  });

  it('leaves the response body readable for callers when it does not throw', async () => {
    const r = res(200, { ok: 1 });
    await throwIfQuotaRefused(r);
    expect(await r.json()).toEqual({ ok: 1 });
  });
});
