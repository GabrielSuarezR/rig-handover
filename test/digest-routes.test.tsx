import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import type { RigConfig } from '../src/config.js';

const runsDir = mkdtempSync(join(tmpdir(), 'rig-digest-routes-'));

const config: RigConfig = {
  adapter: 'shim',
  installed: '2026-10-29T14:06:00+01:00',
  beatEverySeconds: 60,
  runsDir,
};

const line = (at: string, job: string, status: string, owner: string | null, error?: string) =>
  JSON.stringify(error === undefined ? { at, job, status, owner } : { at, job, status, owner, error }) + '\n';

beforeAll(() => {
  // 2026-11-01: notes/backup has no owner; lane/sync retries 3 times, then ok. Listed out of order on purpose.
  writeFileSync(
    join(runsDir, '2026-11-01.jsonl'),
    line('2026-11-01T01:00:00+01:00', 'notes/backup', 'ok', null) +
      line('2026-11-01T01:05:00+01:00', 'lane/sync', 'retry', 'rook', 'lock held') +
      line('2026-11-01T01:10:00+01:00', 'lane/sync', 'retry', 'rook', 'lock held') +
      line('2026-11-01T01:15:00+01:00', 'lane/sync', 'retry', 'rook', 'lock held') +
      line('2026-11-01T01:20:00+01:00', 'lane/sync', 'ok', 'rook'),
  );
  writeFileSync(join(runsDir, '2026-11-02.jsonl'), '');
  writeFileSync(
    join(runsDir, '2026-11-03.jsonl'),
    line('2026-11-03T01:00:00+01:00', 'lane/sync', 'ok', 'rook') +
      line('2026-11-03T02:00:00+01:00', 'digest/render', 'ok', null) +
      '{"at":"2026-11-03T01:00:00+01:00","job":"x/y\n',
  );
});

// Job names in the order they appear in the JSON rows.
async function jsonJobs(night: string): Promise<string[]> {
  const res = await createApp(config).request(`/api/digest/${night}`);
  expect(res.status).toBe(200);
  const body = (await res.json()) as { rows: { job: string }[] };
  return body.rows.map((r) => r.job);
}

describe('GET /digest/:night', () => {
  it('200 with one row per job, null owner as —, and a warn row', async () => {
    const res = await createApp(config).request('/digest/2026-11-01');
    const html = await res.text();
    expect(res.status).toBe(200);
    expect(html).toContain('notes/backup');
    expect(html).toContain('lane/sync');
    expect(html).toContain('—');
    expect(html).toMatch(/class="[^"]*\bwarn\b[^"]*"/);
  });

  it('404 for a night with no file', async () => {
    const res = await createApp(config).request('/digest/2026-01-01');
    expect(res.status).toBe(404);
  });

  it('says "nothing ran" for an empty night', async () => {
    const res = await createApp(config).request('/digest/2026-11-02');
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('nothing ran');
  });

  it('200 and says how many lines could not be read', async () => {
    const res = await createApp(config).request('/digest/2026-11-03');
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('1 line could not be read');
  });
});

describe('GET /api/digest/:night', () => {
  it('200 with rows sorted by job', async () => {
    const res = await createApp(config).request('/api/digest/2026-11-01');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { night: string; rows: { job: string; owner: string | null }[] };
    expect(body.night).toBe('2026-11-01');
    expect(body.rows).toHaveLength(2);
    expect(body.rows.map((r) => r.job)).toEqual(['lane/sync', 'notes/backup']);
    expect(body.rows[1]?.owner).toBeNull();
  });

  it('404 with an error body for a night with no file', async () => {
    const res = await createApp(config).request('/api/digest/2026-01-01');
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error?: unknown; night?: unknown };
    expect(body.error).toBeDefined();
    expect(body.night).toBe('2026-01-01');
  });

  it('200 with no rows for an empty night', async () => {
    const res = await createApp(config).request('/api/digest/2026-11-02');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { rows: unknown[] };
    expect(body.rows).toEqual([]);
  });

  it('200 and counts the bad line', async () => {
    const res = await createApp(config).request('/api/digest/2026-11-03');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { badLines: number };
    expect(body.badLines).toBe(1);
  });
});

describe('page and JSON agree', () => {
  it('list the same jobs in the same order for 2026-11-01', async () => {
    const jobs = await jsonJobs('2026-11-01');
    const html = await (await createApp(config).request('/digest/2026-11-01')).text();
    let from = 0;
    for (const job of jobs) {
      const at = html.indexOf(job, from);
      expect(at, `${job} missing or out of order in page`).toBeGreaterThanOrEqual(from);
      from = at + job.length;
    }
  });
});
