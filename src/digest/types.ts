// Plan morning-digest § 1. The contract every part of § 2 builds against.

export type RunStatus = 'ok' | 'retry' | 'fail';

// One line of runs/<night>.jsonl, after parsing.
export type RunLine = {
  at: string;
  job: string;
  status: RunStatus;
  owner: string | null;
  error?: string;
};

// One row per job for the night.
export type DigestRow = {
  job: string;
  owner: string | null; // null renders as "—"
  runs: number; // lines for this job
  retries: number; // lines with status "retry"
  lastStatus: RunStatus;
  lastError: string | null; // error of the last line that had one
  firstAt: string; // as in the log, offset kept
  lastAt: string;
};

// A night read from disk. Rows sorted by job. Bad lines are counted, never thrown.
export type Night = {
  night: string; // YYYY-MM-DD
  rows: DigestRow[];
  badLines: number;
  counts: { ok: number; retry: number; fail: number }; // parsed lines by status
};

// Returns null when runs/<night>.jsonl does not exist. An empty file gives rows: [].
export type ReadNight = (runsDir: string, night: string) => Night | null;
