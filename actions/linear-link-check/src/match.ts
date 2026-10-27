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

export type LinkSource = 'branch' | 'title' | 'body';

export type CheckResult =
  | { status: 'exempt'; reason: string }
  | { status: 'linked'; source: LinkSource; key: string }
  | { status: 'unlinked' };

const GENERIC_TEAM = '[A-Z][A-Z0-9]+';

// Linear's magic words. Closing words close the issue on merge; the others only link it.
const CLOSING_WORDS = [
  'close', 'closes', 'closed', 'closing',
  'fix', 'fixes', 'fixed', 'fixing',
  'resolve', 'resolves', 'resolved', 'resolving',
  'complete', 'completes', 'completed', 'completing',
];
const NON_CLOSING_WORDS = [
  'ref', 'refs', 'references',
  'part of', 'related to', 'contributes to',
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

function teamPattern(teamKeys: string[]): string {
  if (teamKeys.length === 0) return GENERIC_TEAM;
  return `(?:${teamKeys.map((key) => escapeRegExp(key.toUpperCase())).join('|')})`;
}

/** Regex source for an issue key, bounded so that e.g. XARV-123 does not match ARV. */
function keyPattern(teamKeys: string[]): string {
  return `\\b${teamPattern(teamKeys)}-\\d+\\b`;
}

export function findKeyInBranch(branch: string, teamKeys: string[]): string | undefined {
  const match = new RegExp(keyPattern(teamKeys), 'i').exec(branch);
  return match?.[0].toUpperCase();
}

export function findKeyInTitle(title: string, teamKeys: string[]): string | undefined {
  return new RegExp(keyPattern(teamKeys)).exec(title)?.[0];
}

/**
 * Finds the first issue key that directly follows a magic word in the body.
 * A bare key without a magic word does not count, since Linear ignores it.
 * The key may also be given as a Linear issue URL.
 */
export function findKeyInBody(body: string, teamKeys: string[]): string | undefined {
  const words = MAGIC_WORDS.map((word) => word.replace(' ', '\\s+')).join('|');
  const urlPrefix = String.raw`(?:https?://linear\.app/[\w-]+/issue/)?`;
  // Magic words are case-insensitive; the key itself is checked case-sensitively below.
  const candidate = new RegExp(String.raw`\b(?:${words})\b[\s:]*${urlPrefix}(\S+)`, 'gi');
  const key = new RegExp(`^${keyPattern(teamKeys)}`);
  for (const match of body.matchAll(candidate)) {
    const found = key.exec(match[1] ?? '');
    if (found) return found[0];
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
