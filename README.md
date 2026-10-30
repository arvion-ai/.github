# arvion-ai/.github

Org-wide defaults for arvion-ai: the org profile (`profile/`), the default pull request template, starter workflows (`workflow-templates/`), and shared actions (`actions/`).

## Linear link check

Every pull request into a production branch must be linked to a Linear issue, so it shows up on that issue through the Linear GitHub integration. The `linear-link` check fails a PR that Linear itself would not link.

### What the check does

A PR passes if any one of these is true. The rules mirror how Linear links PRs.

1. **The PR description contains a magic word followed by an issue key**, e.g. `Part of ARV-123`. This is the recommended form, and the PR template starts with it.
   - Use a non-closing word such as `Part of` when the PR is one part of the work. A closing word such as `Fixes` closes the issue when the PR merges.
   - Closing words: close, closes, closed, closing, fix, fixes, fixed, fixing, resolve, resolves, resolved, resolving, complete, completes, completed, completing, implement, implements, implemented, implementing, linear issue.
   - Non-closing words: ref, refs, references, part of, related to, relates to, contributes to, toward, towards.
   - Magic words and keys match in any case. The key may be bold or italic, given as a Linear issue URL, or be one of a list: `Fixes ENG-1, ARV-2` and `Fixes DES-5 and ARV-2` both link `ARV-2`.
   - A bare key without a magic word does **not** count, because Linear ignores it. Neither does a key in backticks or a Markdown link, or anything inside an HTML comment.
2. **The branch name contains an issue key**, in any case. Linear's generated branch names, such as `michal/arv-123-some-title`, already do. In Linear, press <kbd>Cmd/Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>.</kbd> on an issue to copy its branch name.
3. **The PR title contains an issue key**, in any case, e.g. `ARV-123: Add billing export`.

`skip ARV-123` or `ignore ARV-123` in the description makes Linear fully unlink the PR from that issue, even if the key is in the branch name or title. The check follows suit and does not count that key anywhere.

The Atlassian app is installed on our repos and Jira issue numbers overlap Linear's, so a key in a branch name or title can also link an unrelated Jira ticket. Prefer the description.

Keys must not touch a letter or digit: `XARV-123` and `ARV-123x` do not count as `ARV-123`, but `feature_ARV-123` does. Only the team keys in `team-keys` are accepted. With `team-keys: "*"`, any key counts, but outside the branch name only uppercase ones, so words like `utf-8` are not taken for keys. The check tests only the shape of the key, not whether the issue exists, since it has no Linear API access.

These PRs pass with a notice instead of being checked:

- PRs opened by a bot, i.e. any author whose login ends in `[bot]` (Dependabot, Renovate, GitHub Actions, and so on), but only where `exempt-bots` is `true`. By default a bot PR needs a key like any other.
- PRs with the `skip-label` label, if one is set. None is set by default: a label can be added by anyone with triage access, with no reason and no record. A PR that has no ticket yet gets one.
- PRs whose base branch is not in `target-branches`. By default the check runs on PRs into `main` and `production`, so release PRs need a Linear key too.
- PRs that change no files, i.e. whose head commit has the same tree as the merge base. After each release, GitHub offers to open such a PR from `production` into `main`: it carries only the release merge commits, and a squash merge would add an empty commit. Close it. The check tells from the git trees, not from the payload's `changed_files`, which GitHub can report as 0 for a PR that does change files.

When a PR fails, the job summary explains the three ways to link it. The check reads the PR from the event payload. Only for a PR that would fail does it call the GitHub API, read-only with the workflow's token, to tell whether the PR changes any files; if that call fails, the PR fails. It never comments on the PR. It re-runs when the PR is edited, labeled, unlabeled, or pushed to, so fixing the title, description, or label is enough.

An empty input uses the default. The defaults are defined once, in [`src/match.ts`](actions/linear-link-check/src/match.ts), except `github-token`'s, which is in `action.yml`.

| Input             | Default              | Meaning                                                                                    |
| ----------------- | -------------------- | ------------------------------------------------------------------------------------------ |
| `team-keys`       | `ARV,OSS,KIN`        | Comma-separated Linear team keys. `*` accepts any key matching `[A-Z][A-Z0-9]+-<number>`.  |
| `target-branches` | `main,production`    | Comma-separated base branches to enforce on. `*` enforces on all branches.                 |
| `skip-label`      | none                 | Label that exempts a PR. Empty disables the exemption.                                     |
| `exempt-bots`     | `false`              | When `true`, a PR opened by a bot passes without a key.                                    |
| `enforce`         | `true`               | When `false`, an unlinked PR gets a warning and the check still passes.                    |
| `github-token`    | the workflow's token | Reads a failing PR's commits to tell whether it changes any files. Needs `contents: read`. |

The pieces:

- [`actions/linear-link-check/`](actions/linear-link-check/) is the TypeScript action. The matching rules live in `src/match.ts`.
- [`.github/workflows/linear-link-check.yml`](.github/workflows/linear-link-check.yml) is the reusable workflow. Its job is named `linear-link`.
- [`workflow-templates/linear-link-check.yml`](workflow-templates/linear-link-check.yml) is the starter workflow that repos add.
- [`.github/PULL_REQUEST_TEMPLATE.md`](.github/PULL_REQUEST_TEMPLATE.md) is the org-wide default PR template, which starts with a `Part of ARV-___` line.

### Opting a repo in

1. In the repo, go to **Actions → New workflow** and pick **Linear link check** under "By arvion-ai".
2. Commit the file it creates at `.github/workflows/linear-link-check.yml`. To change a setting, uncomment the `with:` block, for example to set `enforce: false`.

The starter workflow also runs on `merge_group`, so the required check reports in repos that use a merge queue. Merge-queue runs pass with a notice, since the PR was already checked.

A repo that opts in this way should report the check as **`linear-link / linear-link`**: GitHub prefixes the reusable workflow's job name with the calling job's name. Confirm the name on a real PR before making it required.

### Making it required for all repos

Create an org ruleset under **Organization settings → Repository → Rulesets → New branch ruleset**:

1. Set **Enforcement status** to *Active*. Start with *Evaluate* if you want to watch it first; GitHub's docs list that mode as GitHub Enterprise only, so check that it is offered on our plan.
2. Under **Target repositories**, choose *All repositories*.
3. Under **Target branches**, add *Include default branch* and `production`, matching `target-branches`.
4. Enable **Require status checks to pass** and add the check `linear-link / linear-link`, the name a repo produces with the starter workflow. Leave the source as "any source", or pick GitHub Actions.
5. Under **Bypass list**, add whoever may merge without a ticket in an emergency, e.g. org admins. This replaces a skip label: only they can bypass, and GitHub records each bypass.

A required status check only works in repos that run the workflow. In a repo without it, the check never reports and PRs into `main` are blocked. Roll the starter workflow out to every repo before turning on this rule, or limit the ruleset's target repositories to those that have it.

### Alternative: "Require workflows to pass"

If our plan offers the ruleset rule **Require workflows to pass before merging** (GitHub Enterprise Cloud), use it instead of the status-check rule. Repos then don't need their own workflow file:

1. In the same ruleset, enable **Require workflows to pass before merging**.
2. Add the workflow: repository `arvion-ai/.github`, path `.github/workflows/linear-link-check.yml`, ref `main`.

GitHub then runs the workflow in every targeted repo through its `pull_request` trigger with the default inputs. The check appears as `linear-link`. To change the inputs for this path, change the defaults in `actions/linear-link-check/src/match.ts` and rebuild `dist/`. Repos that also added the starter workflow would run the check twice, so pick one approach.

### Recommended rollout

1. Add the starter workflow to repos with `enforce: false` in its `with:` block. For the "Require workflows" path, temporarily make an empty `enforce` mean false in `src/index.ts` instead.
2. For about a week, unlinked PRs get a warning annotation and a job summary, but nothing is blocked. Check who is getting warnings, whether any repos need extra team keys or target branches, and whether Scytale counts release PRs correctly.
3. Switch to `enforce: true` and turn on the ruleset.

### Developing the action

```sh
cd actions/linear-link-check
npm ci
npm test        # vitest
npm run lint    # eslint + tsc --noEmit
npm run build   # bundles src/ into dist/index.js
```

`dist/index.js` is committed because the runner executes it directly. Commit it together with every source change. CI fails if it is out of date.
