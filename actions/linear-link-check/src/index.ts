import * as core from '@actions/core';
import * as github from '@actions/github';
import { checkPullRequest, parseList, type CheckConfig, type PullRequestInfo } from './match.js';

interface PullRequestPayload {
  title?: string;
  body?: string | null;
  user?: { login?: string };
  head?: { ref?: string };
  base?: { ref?: string };
  labels?: { name?: string }[];
}

function readPullRequest(payload: PullRequestPayload): PullRequestInfo {
  return {
    branch: payload.head?.ref ?? '',
    baseBranch: payload.base?.ref ?? '',
    title: payload.title ?? '',
    body: payload.body ?? '',
    author: payload.user?.login ?? '',
    labels: (payload.labels ?? []).map((label) => label.name ?? ''),
  };
}

function readConfig(): CheckConfig {
  return {
    teamKeys: parseList(core.getInput('team-keys')).map((key) => key.toUpperCase()),
    targetBranches: parseList(core.getInput('target-branches')),
    skipLabel: core.getInput('skip-label'),
  };
}

async function writeFailureSummary(config: CheckConfig): Promise<void> {
  const key = `${config.teamKeys[0] ?? 'ARV'}-123`;
  const skipLabel = config.skipLabel.trim();
  const allowedKeys =
    config.teamKeys.length > 0
      ? `Allowed team keys: ${config.teamKeys.map((team) => `<code>${team}</code>`).join(', ')}.`
      : 'Any Linear issue key, for example <code>ABC-123</code>, is accepted.';
  const escapeHatch = skipLabel
    ? ` If this change really has no ticket, add the <code>${skipLabel}</code> label.`
    : '';
  const paragraph = (html: string): string => `<p>${html}</p>`;

  await core.summary
    .addHeading('This pull request is not linked to a Linear issue', 2)
    .addRaw(
      paragraph(
        'Every PR to a production branch must show up on its Linear issue. ' +
          'Link it in any one of these ways, then push or edit the PR to re-run the check.',
      ),
      true,
    )
    .addHeading('1. Use the issue key in the branch name', 3)
    .addRaw(
      paragraph(
        `For example <code>yourname/${key.toLowerCase()}-short-title</code>. ` +
          'In Linear, open the issue and press <kbd>Cmd/Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>.</kbd> ' +
          'to copy its git branch name.',
      ),
      true,
    )
    .addHeading('2. Put the issue key in the PR title', 3)
    .addRaw(paragraph(`For example <code>${key}: Add billing export</code>.`), true)
    .addHeading('3. Add a magic word and the issue key to the PR description', 3)
    .addRaw(
      paragraph(
        `For example <code>Fixes ${key}</code> to close the issue on merge, ` +
          `or <code>Part of ${key}</code> to link it without closing. ` +
          'A key on its own, without a magic word, is ignored by Linear.',
      ),
      true,
    )
    .addDetails(
      'Accepted magic words',
      'Closing: close(s/d), closing, fix(es/ed), fixing, resolve(s/d), resolving, ' +
        'complete(s/d), completing. Non-closing: ref, refs, references, part of, related to, ' +
        'contributes to.',
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
  const enforce = core.getBooleanInput('enforce');
  const result = checkPullRequest(readPullRequest(payload), config);

  switch (result.status) {
    case 'exempt':
      core.notice(`Linear link check skipped: ${result.reason}.`);
      return;
    case 'linked':
      core.info(`Linked to Linear issue ${result.key} via the PR ${result.source}.`);
      return;
    case 'unlinked': {
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
