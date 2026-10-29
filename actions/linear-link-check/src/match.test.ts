import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_TARGET_BRANCHES,
  DEFAULT_TEAM_KEYS,
  MAGIC_WORDS,
  checkPullRequest,
  parseList,
  resolveConfig,
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
const repoRoot = join(import.meta.dirname, '..', '..', '..');

describe('branch name', () => {
  it.each([
    ['michal/arv-123-some-title', 'ARV-123'],
    ['michal/ARV-123-some-title', 'ARV-123'],
    ['arv-7', 'ARV-7'],
    ['feature/Arv-42', 'ARV-42'],
    ['feature_ARV-123', 'ARV-123'],
    ['me/arv-123_x', 'ARV-123'],
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
    ['arv-153: Add billing export', 'ARV-153'],
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
    ['part of arv-153', 'ARV-153'],
    ['Part of **ARV-153**', 'ARV-153'],
    ['Part of _ARV-153_', 'ARV-153'],
    ['Implements ARV-10', 'ARV-10'],
    ['Towards ARV-11', 'ARV-11'],
    ['Relates to ARV-12', 'ARV-12'],
    ['Fixes DES-5 and ARV-2', 'ARV-2'],
    ['Fixes ENG-1, ARV-2', 'ARV-2'],
    ['Fixes ENG-1 & ARV-2', 'ARV-2'],
    ['<!-- Closes ARV-1 -->\nPart of ARV-2', 'ARV-2'],
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
    ['placeholder from the PR template', 'Part of ARV-___'],
    ['key in backticks', 'Part of `ARV-153`'],
    ['key in a Markdown link', 'Part of [ARV-153](https://linear.app/arvion/issue/ARV-153)'],
    ['key inside an HTML comment', '<!--\nCloses ARV-123\n-->'],
    ['key inside an unclosed HTML comment', '<!--\nCloses ARV-123'],
    ['list ends before an allowed key', 'Fixes ENG-1 then ARV-2'],
  ])('%s does not link', (_name, body) => {
    expect(checkPullRequest(pr({ body }), config)).toEqual(unlinked);
  });
});

describe('skip and ignore', () => {
  it.each([
    ['branch key', { branch: 'me/arv-123-x', body: 'Ignore ARV-123' }],
    ['title key', { title: 'ARV-123: Add billing export', body: 'skip arv-123' }],
    ['body key', { body: 'Part of ARV-123\n\nIgnore: ARV-123' }],
    ['key in an ignored list', { branch: 'me/arv-2-x', body: 'Skip ARV-1, ARV-2' }],
  ])('unlinks an ignored %s', (_name, overrides) => {
    expect(checkPullRequest(pr(overrides), config)).toEqual(unlinked);
  });

  it('still links another key', () => {
    expect(checkPullRequest(pr({ branch: 'me/arv-1-x', body: 'Ignore ARV-1\nPart of ARV-2' }), config)).toEqual({
      status: 'linked',
      source: 'body',
      key: 'ARV-2',
    });
  });

  it('does not count an ignore word inside an HTML comment', () => {
    expect(checkPullRequest(pr({ branch: 'me/arv-1-x', body: '<!-- ignore ARV-1 -->' }), config)).toMatchObject({
      status: 'linked',
    });
  });
});

describe('PR template', () => {
  it('an untouched template does not link', () => {
    const body = readFileSync(join(repoRoot, '.github', 'PULL_REQUEST_TEMPLATE.md'), 'utf8');
    expect(checkPullRequest(pr({ body }), config)).toEqual(unlinked);
  });

  it('links once the placeholder is filled in', () => {
    const template = readFileSync(join(repoRoot, '.github', 'PULL_REQUEST_TEMPLATE.md'), 'utf8');
    const body = template.replace('ARV-___', 'ARV-42');
    expect(checkPullRequest(pr({ body }), config)).toEqual({ status: 'linked', source: 'body', key: 'ARV-42' });
  });
});

describe('README', () => {
  const readme = readFileSync(join(repoRoot, 'README.md'), 'utf8');

  it.each(MAGIC_WORDS)('lists the magic word "%s"', (word) => {
    expect(readme).toMatch(new RegExp(`[\\s,]${word}[,.]`));
  });

  it('lists the default team keys and target branches', () => {
    expect(readme).toContain(`\`${DEFAULT_TEAM_KEYS.join(',')}\``);
    expect(readme).toContain(`\`${DEFAULT_TARGET_BRANCHES.join(',')}\``);
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

  it('only takes uppercase keys outside the branch with the generic pattern', () => {
    const generic = { ...config, teamKeys: [] };
    expect(checkPullRequest(pr({ title: 'Fix utf-8 decoding' }), generic)).toEqual(unlinked);
    expect(checkPullRequest(pr({ body: 'Fixes utf-8 decoding' }), generic)).toEqual(unlinked);
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

describe('resolveConfig', () => {
  it('uses the defaults for empty inputs', () => {
    expect(resolveConfig({ teamKeys: '', targetBranches: '', skipLabel: '' })).toEqual({
      teamKeys: ['ARV', 'OSS', 'KIN'],
      targetBranches: ['main', 'production'],
      skipLabel: '',
    });
  });

  it('treats "*" as no filter', () => {
    expect(resolveConfig({ teamKeys: '*', targetBranches: '*', skipLabel: '' })).toMatchObject({
      teamKeys: [],
      targetBranches: [],
    });
  });

  it('uses given values', () => {
    expect(resolveConfig({ teamKeys: 'arv, ops', targetBranches: 'release', skipLabel: ' no-ticket ' })).toEqual({
      teamKeys: ['ARV', 'OPS'],
      targetBranches: ['release'],
      skipLabel: 'no-ticket',
    });
  });

  it('enforces on production by default', () => {
    const defaults = resolveConfig({ teamKeys: '', targetBranches: '', skipLabel: '' });
    expect(checkPullRequest(pr({ baseBranch: 'production' }), defaults)).toEqual(unlinked);
    expect(checkPullRequest(pr({ title: 'KIN-4: Release' }), defaults)).toMatchObject({ status: 'linked' });
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
