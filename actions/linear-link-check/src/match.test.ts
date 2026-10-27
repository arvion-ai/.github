import { describe, expect, it } from 'vitest';
import {
  MAGIC_WORDS,
  checkPullRequest,
  parseList,
  type CheckConfig,
  type CheckResult,
  type PullRequestInfo,
} from './match.js';

const config: CheckConfig = { teamKeys: ['ARV'], targetBranches: ['main'], skipLabel: 'no-ticket' };

function pr(overrides: Partial<PullRequestInfo>): PullRequestInfo {
  return {
    branch: 'feature/some-change',
    baseBranch: 'main',
    title: 'Some change',
    body: '',
    author: 'octocat',
    labels: [],
    ...overrides,
  };
}

const unlinked: CheckResult = { status: 'unlinked' };

describe('branch name', () => {
  it.each([
    ['michal/arv-123-some-title', 'ARV-123'],
    ['michal/ARV-123-some-title', 'ARV-123'],
    ['arv-7', 'ARV-7'],
    ['feature/Arv-42', 'ARV-42'],
  ])('%s links %s', (branch, key) => {
    expect(checkPullRequest(pr({ branch }), config)).toEqual({ status: 'linked', source: 'branch', key });
  });

  it.each([
    'michal/xarv-123-some-title',
    'michal/arv-123x',
    'michal/arv-',
    'michal/eng-123-some-title',
  ])('%s does not link', (branch) => {
    expect(checkPullRequest(pr({ branch }), config)).toEqual(unlinked);
  });
});

describe('PR title', () => {
  it.each([
    ['ARV-123: Add billing export', 'ARV-123'],
    ['Add billing export (ARV-9)', 'ARV-9'],
    ['[ARV-55] Add billing export', 'ARV-55'],
  ])('%s links %s', (title, key) => {
    expect(checkPullRequest(pr({ title }), config)).toEqual({ status: 'linked', source: 'title', key });
  });

  it.each(['XARV-123: Add billing export', 'ARV-123x', 'ENG-123: Add billing export', 'ARV 123'])(
    '%s does not link',
    (title) => {
      expect(checkPullRequest(pr({ title }), config)).toEqual(unlinked);
    },
  );
});

describe('PR body', () => {
  it.each(MAGIC_WORDS)('magic word "%s" links', (word) => {
    const body = `Some context.\n\n${word} ARV-123`;
    expect(checkPullRequest(pr({ body }), config)).toEqual({ status: 'linked', source: 'body', key: 'ARV-123' });
  });

  it.each([
    ['FIXES ARV-1', 'ARV-1'],
    ['Closes: ARV-2', 'ARV-2'],
    ['Part  of\nARV-3', 'ARV-3'],
    ['Fixes ARV-4, ARV-5', 'ARV-4'],
    ['Resolves ARV-6.', 'ARV-6'],
    ['Mentions ARV-1 in passing. Fixes ARV-7', 'ARV-7'],
    ['Fixes https://linear.app/arvion/issue/ARV-8/some-title', 'ARV-8'],
  ])('%j links %s', (body, key) => {
    expect(checkPullRequest(pr({ body }), config)).toEqual({ status: 'linked', source: 'body', key });
  });

  it.each([
    ['bare key', 'This touches ARV-123.'],
    ['key on its own line', 'ARV-123'],
    ['magic word not adjacent', 'Fixes the bug from ARV-123'],
    ['magic word inside another word', 'Prefixes ARV-123'],
    ['key embedded in a longer word', 'Fixes XARV-123'],
    ['non-allowed team', 'Fixes ENG-123'],
    ['placeholder from the PR template', 'Closes ARV-___'],
  ])('%s does not link', (_name, body) => {
    expect(checkPullRequest(pr({ body }), config)).toEqual(unlinked);
  });
});

describe('team keys', () => {
  it('accepts any of several allowed teams', () => {
    const multi = { ...config, teamKeys: ['ARV', 'OPS'] };
    expect(checkPullRequest(pr({ title: 'OPS-12: Rotate keys' }), multi)).toEqual({
      status: 'linked',
      source: 'title',
      key: 'OPS-12',
    });
  });

  it('falls back to the generic pattern when no team keys are set', () => {
    const generic = { ...config, teamKeys: [] };
    expect(checkPullRequest(pr({ body: 'Fixes ENG2-5' }), generic)).toEqual({
      status: 'linked',
      source: 'body',
      key: 'ENG2-5',
    });
    expect(checkPullRequest(pr({ title: 'Add billing export' }), generic)).toEqual(unlinked);
  });
});

describe('exemptions', () => {
  it.each(['dependabot[bot]', 'renovate[bot]', 'github-actions[bot]', 'some-app[bot]'])(
    'exempts bot author %s',
    (author) => {
      expect(checkPullRequest(pr({ author }), config).status).toBe('exempt');
    },
  );

  it('does not exempt a human whose name contains "bot"', () => {
    expect(checkPullRequest(pr({ author: 'robotics-dev' }), config)).toEqual(unlinked);
  });

  it.each([['no-ticket'], ['No-Ticket']])('exempts the skip label %s', (label) => {
    expect(checkPullRequest(pr({ labels: ['bug', label] }), config).status).toBe('exempt');
  });

  it('ignores labels when the skip label is empty', () => {
    expect(checkPullRequest(pr({ labels: ['no-ticket'] }), { ...config, skipLabel: '' })).toEqual(unlinked);
  });

  it('exempts a PR whose base is not a target branch', () => {
    expect(checkPullRequest(pr({ baseBranch: 'develop' }), config).status).toBe('exempt');
  });

  it('enforces on every branch when no target branches are set', () => {
    expect(checkPullRequest(pr({ baseBranch: 'develop' }), { ...config, targetBranches: [] })).toEqual(unlinked);
  });
});

describe('parseList', () => {
  it.each([
    ['ARV', ['ARV']],
    [' ARV, OPS ,', ['ARV', 'OPS']],
    ['', []],
  ])('%j parses to %j', (input, expected) => {
    expect(parseList(input)).toEqual(expected);
  });
});
