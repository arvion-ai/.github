import * as core from '@actions/core';
import * as github from '@actions/github';
import { changesNoFiles } from './changes.js';
import {
  checkPullRequest,
  CLOSING_WORDS,
  NON_CLOSING_WORDS,
  resolveConfig,
  type CheckConfig,
  type PullRequestInfo,
} from './match.js';

interface PullRequestPayload {
  title?: string;
  body?: string | null;
  user?: { login?: string };
  head?: { ref?: string; sha?: string };
  base?: { ref?: string; sha?: string };
  labels?: { name?: string }[];
}

function required<T>(value: T | undefined, field: string): T {
  if (value === undefined) throw new Error(`The pull_request payload has no ${field}.`);
  return value;
}

function readPullRequest(payload: PullRequestPayload): PullRequestInfo {
  return {
    branch: required(payload.head?.ref, 'head.ref'),
    baseBranch: required(payload.base?.ref, 'base.ref'),
    title: required(payload.title, 'title'),
    // GitHub sends a null body for an empty description.
    body: payload.body ?? '',
    author: required(payload.user?.login, 'user.login'),
    labels: (payload.labels ?? []).map((label) => required(label.name, 'labels[].name')),
  };
}

function readConfig(): CheckConfig {
  return resolveConfig({
    teamKeys: core.getInput('team-keys'),
    targetBranches: core.getInput('target-branches'),
    skipLabel: core.getInput('skip-label'),
  });
}

/**
 * Whether the PR changes no files, read through the GitHub API. An API error
 * counts as a change, so the PR fails as it would without this exemption.
 */
async function pullRequestChangesNoFiles(payload: PullRequestPayload): Promise<boolean> {
  try {
    const octokit = github.getOctokit(core.getInput('github-token', { required: true }));
    return await changesNoFiles(octokit.rest, {
      ...github.context.repo,
      baseSha: required(payload.base?.sha, 'base.sha'),
      headSha: required(payload.head?.sha, 'head.sha'),
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    core.warning(`Could not tell whether this PR changes any files, so it is checked as usual: ${message}`);
    return false;
  }
}

/** Empty means the default, true. */
function readEnforce(): boolean {
  return core.getInput('enforce') === '' || core.getBooleanInput('enforce');
}

async function writeFailureSummary(config: CheckConfig): Promise<void> {
  const key = `${config.teamKeys[0] ?? 'ABC'}-123`;
  const skipLabel = config.skipLabel.trim();
  const allowedKeys =
    config.teamKeys.length > 0
      ? `Allowed team keys: ${config.teamKeys.map((team) => `<code>${team}</code>`).join(', ')}.`
      : 'Any Linear issue key, for example <code>ABC-123</code>, is accepted.';
  const escapeHatch = skipLabel
    ? ` If this change really has no ticket, add the <code>${skipLabel}</code> label.`
    : ' If this change really has no ticket, ask an org admin to merge it through the ruleset bypass list.';
  const paragraph = (html: string): string => `<p>${html}</p>`;

  await core.summary
    .addHeading('This pull request is not linked to a Linear issue', 2)
    .addRaw(
      paragraph(
        'Every PR to a production branch must show up on its Linear issue. ' +
          'Link it in one of these ways, then push or edit the PR to re-run the check.',
      ),
      true,
    )
    .addHeading('Recommended: a magic word and the issue key in the PR description', 3)
    .addRaw(
      paragraph(
        `Add a line like <code>Part of ${key}</code> to link the PR without closing the issue. ` +
          `Use <code>Fixes ${key}</code> only if merging this PR finishes the issue, since it closes the issue on merge. ` +
          'A key on its own, without a magic word, is ignored by Linear.',
      ),
      true,
    )
    .addDetails(
      'Accepted magic words',
      `Closing: ${CLOSING_WORDS.join(', ')}. Non-closing: ${NON_CLOSING_WORDS.join(', ')}.`,
    )
    .addHeading('Also accepted: the issue key in the branch name or PR title', 3)
    .addRaw(
      paragraph(
        `For example the branch <code>yourname/${key.toLowerCase()}-short-title</code> ` +
          `or the title <code>${key}: Add billing export</code>. ` +
          'A key there can also link an unrelated Jira ticket with the same number, so prefer the description.',
      ),
      true,
    )
    .addRaw(paragraph(allowedKeys + escapeHatch), true)
    .write();
}

async function run(): Promise<void> {
  const payload = github.context.payload.pull_request as PullRequestPayload | undefined;
  if (!payload) {
    core.notice(`Skipping the Linear link check: ${github.context.eventName} is not a pull_request event.`);
    return;
  }

  const config = readConfig();
  const enforce = readEnforce();
  const result = checkPullRequest(readPullRequest(payload), config);

  switch (result.status) {
    case 'exempt':
      core.notice(`Linear link check skipped: ${result.reason}.`);
      return;
    case 'linked':
      core.info(`Linked to Linear issue ${result.key} via the PR ${result.source}.`);
      return;
    case 'unlinked': {
      // Asked only here, so a linked or exempt PR makes no API call.
      if (await pullRequestChangesNoFiles(payload)) {
        core.notice('Linear link check skipped: the PR changes no files.');
        return;
      }
      await writeFailureSummary(config);
      const message =
        'This PR is not linked to a Linear issue. See the job summary for how to link it.';
      if (enforce) {
        core.setFailed(message);
      } else {
        core.warning(`${message} (Not enforced yet, so the check passes.)`);
      }
      return;
    }
  }
}

run().catch((error: unknown) => {
  core.setFailed(error instanceof Error ? error.message : String(error));
});
