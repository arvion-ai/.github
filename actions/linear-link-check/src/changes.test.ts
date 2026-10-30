import { describe, expect, it } from 'vitest';
import { changesNoFiles, type GitReads } from './changes.js';

const pr = { owner: 'arvion-ai', repo: 'engine', baseSha: 'base111', headSha: 'head222' };

/** A fake API whose merge base and head commit have the given trees. Records each call. */
function api(mergeBaseTree: string, headTree: string): GitReads & { calls: unknown[] } {
  const calls: unknown[] = [];
  return {
    calls,
    repos: {
      compareCommitsWithBasehead: (params) => {
        calls.push(['compare', params]);
        return Promise.resolve({ data: { merge_base_commit: { commit: { tree: { sha: mergeBaseTree } } } } });
      },
    },
    git: {
      getCommit: (params) => {
        calls.push(['getCommit', params]);
        return Promise.resolve({ data: { tree: { sha: headTree } } });
      },
    },
  };
}

describe('changesNoFiles', () => {
  it('is true when the head commit has the merge base tree', async () => {
    await expect(changesNoFiles(api('tree-a', 'tree-a'), pr)).resolves.toBe(true);
  });

  it('is false when the trees differ', async () => {
    await expect(changesNoFiles(api('tree-a', 'tree-b'), pr)).resolves.toBe(false);
  });

  it('compares the merge base of base and head with the head commit', async () => {
    const fake = api('tree-a', 'tree-a');
    await changesNoFiles(fake, pr);
    expect(fake.calls).toEqual([
      ['compare', { owner: 'arvion-ai', repo: 'engine', basehead: 'base111...head222', per_page: 1 }],
      ['getCommit', { owner: 'arvion-ai', repo: 'engine', commit_sha: 'head222' }],
    ]);
  });

  it('passes an API error on to the caller', async () => {
    const failing = api('tree-a', 'tree-a');
    failing.git.getCommit = () => Promise.reject(new Error('Not Found'));
    await expect(changesNoFiles(failing, pr)).rejects.toThrow('Not Found');
  });
});
