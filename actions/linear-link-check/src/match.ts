// Pure matching logic for the Linear link check. No GitHub API or I/O here,
// so every rule can be covered by table-driven tests.

export interface PullRequestInfo {
  branch: string;
  baseBranch: string;
  title: string;
  body: string;
  author: string;
  labels: string[];
}

export interface CheckConfig {
  /** Allowed Linear team keys, e.g. ["ARV"]. Empty means any key-shaped token. */
  teamKeys: string[];
  /** Base branches the check is enforced on. Empty means every branch. */
  targetBranches: string[];
  /** Label that exempts a PR. Empty disables the label exemption. */
  skipLabel: string;
}

/** Raw action inputs, as strings. An empty string means "use the default". */
export interface RawInputs {
  teamKeys: string;
  targetBranches: string;
  skipLabel: string;
}

export type LinkSource = 'branch' | 'title' | 'body';

export type CheckResult =
  | { status: 'exempt'; reason: string }
  | { status: 'linked'; source: LinkSource; key: string }
  | { status: 'unlinked' };

// The only place the defaults are defined. action.yml and the reusable
// workflow leave the inputs empty so these apply.
export const DEFAULT_TEAM_KEYS = ['ARV', 'OSS', 'KIN'];
export const DEFAULT_TARGET_BRANCHES = ['main', 'production'];
/** Input value that disables a list filter: any team key, or every base branch. */
export const ANY = '*';

const GENERIC_TEAM = '[A-Z][A-Z0-9]+';
// A key must not touch a letter or digit on either side, so XARV-123 and
// ARV-123x do not count. Underscores and other punctuation are separators.
const BEFORE_KEY = '(?<![A-Za-z0-9])';
const AFTER_KEY = '(?![A-Za-z0-9])';

// Linear's magic words. Closing words close the issue on merge; the others only link it.
export const CLOSING_WORDS = [
  'close', 'closes', 'closed', 'closing',
  'fix', 'fixes', 'fixed', 'fixing',
  'resolve', 'resolves', 'resolved', 'resolving',
  'complete', 'completes', 'completed', 'completing',
  'implement', 'implements', 'implemented', 'implementing',
];
export const NON_CLOSING_WORDS = [
  'ref', 'refs', 'references',
  'part of', 'related to', 'relates to', 'contributes to',
  'toward', 'towards',
];
export const MAGIC_WORDS = [...CLOSING_WORDS, ...NON_CLOSING_WORDS];

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Splits a comma-separated input into trimmed, non-empty entries. */
export function parseList(value: string): string[] {
  return value
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

/** Applies the defaults: empty means the default list, "*" means no filter. */
function resolveList(value: string, defaults: string[]): string[] {
  const list = parseList(value);
  if (list.length === 0) return defaults;
  if (list.includes(ANY)) return [];
  return list;
}

export function resolveConfig(inputs: RawInputs): CheckConfig {
  return {
    teamKeys: resolveList(inputs.teamKeys, DEFAULT_TEAM_KEYS).map((key) => key.toUpperCase()),
    targetBranches: resolveList(inputs.targetBranches, DEFAULT_TARGET_BRANCHES),
    skipLabel: inputs.skipLabel.trim(),
  };
}

/**
 * Regex for an issue key. With team keys, the key matches in any case, as in
 * Linear. Without them, only uppercase keys count outside the branch name, so
 * that ordinary words like "utf-8" are not taken for keys.
 */
function keyRegExp(teamKeys: string[], anyCase: boolean, flags = ''): RegExp {
  const team =
    teamKeys.length === 0 ? GENERIC_TEAM : `(?:${teamKeys.map((key) => escapeRegExp(key)).join('|')})`;
  const caseFlag = teamKeys.length > 0 || anyCase ? 'i' : '';
  return new RegExp(`${BEFORE_KEY}${team}-\\d+${AFTER_KEY}`, caseFlag + flags);
}

export function findKeyInBranch(branch: string, teamKeys: string[]): string | undefined {
  return keyRegExp(teamKeys, true).exec(branch)?.[0].toUpperCase();
}

export function findKeyInTitle(title: string, teamKeys: string[]): string | undefined {
  return keyRegExp(teamKeys, false).exec(title)?.[0].toUpperCase();
}

/** Removes HTML comments, which GitHub does not render and Linear ignores. */
function stripComments(body: string): string {
  return body.replace(/<!--[\s\S]*?(?:-->|$)/g, ' ');
}

// One key in a magic-word list: optionally bold or italic, optionally a Linear issue URL.
const LIST_ITEM = /^[*_]*(?:https?:\/\/linear\.app\/[\w-]+\/issue\/)?([A-Za-z][A-Za-z0-9]*-\d+)(?![A-Za-z0-9])[*_]*/;
const LIST_SEPARATOR = /^\s*(?:,|&|\band\b)\s*/i;

/**
 * Finds the first allowed issue key in a list that directly follows a magic
 * word in the body, e.g. "Fixes ENG-1, ARV-2" gives ARV-2.
 * A bare key without a magic word does not count, since Linear ignores it.
 */
export function findKeyInBody(body: string, teamKeys: string[]): string | undefined {
  const text = stripComments(body);
  const words = MAGIC_WORDS.map((word) => word.replace(' ', '\\s+')).join('|');
  const magicWord = new RegExp(String.raw`\b(?:${words})\b[\s:]*`, 'gi');
  const allowed = keyRegExp(teamKeys, false);
  for (const match of text.matchAll(magicWord)) {
    let rest = text.slice(match.index + match[0].length);
    for (;;) {
      const item = LIST_ITEM.exec(rest);
      if (!item) break;
      const candidate = item[1] ?? '';
      if (allowed.exec(candidate)?.[0] === candidate) return candidate.toUpperCase();
      rest = rest.slice(item[0].length);
      const separator = LIST_SEPARATOR.exec(rest);
      if (!separator) break;
      rest = rest.slice(separator[0].length);
    }
  }
  return undefined;
}

function isBot(author: string): boolean {
  return author.toLowerCase().endsWith('[bot]');
}

export function checkPullRequest(pr: PullRequestInfo, config: CheckConfig): CheckResult {
  if (isBot(pr.author)) {
    return { status: 'exempt', reason: `author ${pr.author} is a bot` };
  }
  const skipLabel = config.skipLabel.trim().toLowerCase();
  if (skipLabel && pr.labels.some((label) => label.toLowerCase() === skipLabel)) {
    return { status: 'exempt', reason: `PR has the "${config.skipLabel}" label` };
  }
  if (config.targetBranches.length > 0 && !config.targetBranches.includes(pr.baseBranch)) {
    return { status: 'exempt', reason: `base branch ${pr.baseBranch} is not a target branch` };
  }

  const branchKey = findKeyInBranch(pr.branch, config.teamKeys);
  if (branchKey) return { status: 'linked', source: 'branch', key: branchKey };
  const titleKey = findKeyInTitle(pr.title, config.teamKeys);
  if (titleKey) return { status: 'linked', source: 'title', key: titleKey };
  const bodyKey = findKeyInBody(pr.body, config.teamKeys);
  if (bodyKey) return { status: 'linked', source: 'body', key: bodyKey };
  return { status: 'unlinked' };
}

