import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { readNight } from '../src/digest/read.js';

function tempRuns(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'rig-runs-'));
  for (const [name, text] of Object.entries(files)) writeFileSync(join(dir, name), text);
  return dir;
}

describe('readNight', () => {
  it('reads runs/2026-10-28.jsonl: 5 jobs, 1 bad line', () => {
    const night = readNight('runs', '2026-10-28');
    expect(night).not.toBeNull();
    if (!night) return;
    expect(night.night).toBe('2026-10-28');
    expect(night.badLines).toBe(1);
    expect(night.counts).toEqual({ ok: 10, retry: 4, fail: 1 });
    expect(night.rows.map((r) => r.job)).toEqual([
      'digest/render',
      'fixtures/refresh',
      'lane/sync',
      'notes/backup',
      'rig/rotate-logs',
    ]);

    const byJob = Object.fromEntries(night.rows.map((r) => [r.job, r]));
    expect(byJob['fixtures/refresh']).toEqual({
      job: 'fixtures/refresh',
      owner: 'rook',
      runs: 4,
      retries: 3,
      lastStatus: 'ok',
      lastError: 'upstream 503',
      firstAt: '2026-10-29T01:30:00+01:00',
      lastAt: '2026-10-29T01:37:00+01:00',
    });
    expect(byJob['lane/sync']).toMatchObject({
      runs: 8,
      retries: 1,
      lastStatus: 'ok',
      lastError: 'lock held',
      firstAt: '2026-10-28T23:00:06+01:00',
      lastAt: '2026-10-29T05:00:04+01:00',
    });
    expect(byJob['notes/backup']).toMatchObject({ lastStatus: 'fail', lastError: 'quota exceeded' });
    expect(byJob['rig/rotate-logs']).toMatchObject({ runs: 1, retries: 0, lastError: null });
  });

  it('keeps a row whose owner is null', () => {
    const dir = tempRuns({
      '2026-01-01.jsonl': '{"at":"2026-01-01T01:00:00+01:00","job":"a","status":"ok","owner":null}\n',
    });
    expect(readNight(dir, '2026-01-01')?.rows).toEqual([
      {
        job: 'a',
        owner: null,
        runs: 1,
        retries: 0,
        lastStatus: 'ok',
        lastError: null,
        firstAt: '2026-01-01T01:00:00+01:00',
        lastAt: '2026-01-01T01:00:00+01:00',
      },
    ]);
  });

  it('returns null for a missing file', () => {
    expect(readNight(tempRuns({}), '2026-01-01')).toBeNull();
  });

  it('gives no rows and no bad lines for an empty file', () => {
    const dir = tempRuns({ '2026-01-01.jsonl': '' });
    expect(readNight(dir, '2026-01-01')).toEqual({ night: '2026-01-01', rows: [],
      badLines: 0,
      counts: { ok: 0, retry: 0, fail: 0 },
    });
  });

  it('counts lines with bad JSON or bad fields, skips blank lines', () => {
    const ok = '{"at":"t","job":"a","status":"ok","owner":"x"}';
    const dir = tempRuns({
      '2026-01-01.jsonl': [
        ok,
        '',
        'not json',
        '{"at":"t","job":"a","status":"done","owner":"x"}',
        '{"at":"t","job":"a","status":"ok"}',
        '{"at":"t","status":"ok","owner":"x"}',
        '{"at":"t","job":"a","status":"ok","owner":"x","error":42}',
        '[]',
        '',
      ].join('\n'),
    });
    const night = readNight(dir, '2026-01-01');
    expect(night?.badLines).toBe(6);
    expect(night?.rows).toHaveLength(1);
  });
});
