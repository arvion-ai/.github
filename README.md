# arvion-ai/.github

Org-wide defaults for arvion-ai: the org profile (`profile/`), the default pull request template, starter workflows (`workflow-templates/`), and shared actions (`actions/`).

## Linear link check

Every pull request into a production branch must be linked to a Linear issue, so it shows up on that issue through the Linear GitHub integration. The `linear-link` check fails a PR that Linear itself would not link.

### What the check does

A PR passes if any one of these is true. The rules mirror how Linear links PRs.

1. **The branch name contains an issue key**, in any case. Linear's generated branch names, such as `michal/arv-123-some-title`, already do. In Linear, press <kbd>Cmd/Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>.</kbd> on an issue to copy its branch name.
2. **The PR title contains an issue key**, e.g. `ARV-123: Add billing export`.
3. **The PR description contains a magic word followed by an issue key**, e.g. `Fixes ARV-123`. The key may also be given as a Linear issue URL.
   - Closing words: close(s/d), closing, fix(es/ed), fixing, resolve(s/d), resolving, complete(s/d), completing.
   - Non-closing words: ref, refs, references, part of, related to, contributes to.
   - A bare key without a magic word does **not** count, because Linear ignores it.

Keys must be whole words: `XARV-123` does not count as `ARV-123`. Only the team keys in `team-keys` are accepted.

These PRs pass with a notice instead of being checked:

- PRs opened by a bot, i.e. any author whose login ends in `[bot]` (Dependabot, Renovate, GitHub Actions, and so on).
- PRs with the `no-ticket` label.
- PRs whose base branch is not in `target-branches`.

When a PR fails, the job summary explains the three ways to link it. The check reads the PR from the event payload. It needs no token and never comments on the PR. It re-runs when the PR is edited, labeled, unlabeled, or pushed to, so fixing the title, description, or label is enough.

| Input             | Default     | Meaning                                                                                                   |
| ----------------- | ----------- | --------------------------------------------------------------------------------------------------------- |
| `team-keys`       | `ARV`       | Comma-separated Linear team keys. Empty accepts any key matching `[A-Z][A-Z0-9]+-<number>`.               |
| `target-branches` | `main`      | Comma-separated base branches to enforce on. Empty enforces on all branches.                              |
| `skip-label`      | `no-ticket` | Label that exempts a PR. Empty disables the exemption.                                                    |
| `enforce`         | `true`      | When `false`, an unlinked PR gets a warning and the check still passes.                                   |

The pieces:

- [`actions/linear-link-check/`](actions/linear-link-check/) is the TypeScript action. The matching rules live in `src/match.ts`.
- [`.github/workflows/linear-link-check.yml`](.github/workflows/linear-link-check.yml) is the reusable workflow. Its job is named `linear-link`.
- [`workflow-templates/linear-link-check.yml`](workflow-templates/linear-link-check.yml) is the starter workflow that repos add.
- [`.github/PULL_REQUEST_TEMPLATE.md`](.github/PULL_REQUEST_TEMPLATE.md) is the org-wide default PR template, which starts with a `Closes ARV-___` line.

### Opting a repo in

1. In the repo, go to **Actions → New workflow** and pick **Linear link check** under "By arvion-ai".
2. Commit the file it creates at `.github/workflows/linear-link-check.yml`. To change a setting, uncomment the `with:` block, for example to set `enforce: false`.

A repo that opts in this way reports the check as **`linear-link / linear-link`**. GitHub prefixes the reusable workflow's job name with the calling job's name.

### Making it required for all repos

Create an org ruleset under **Organization settings → Repository → Rulesets → New branch ruleset**:

1. Set **Enforcement status** to *Active*. Start with *Evaluate* if you want to watch it first; that mode needs GitHub Enterprise.
2. Under **Target repositories**, choose *All repositories*.
3. Under **Target branches**, add *Include default branch*, or the pattern `main`.
4. Enable **Require status checks to pass** and add the check `linear-link / linear-link`, the name a repo produces with the starter workflow. Leave the source as "any source", or pick GitHub Actions.
5. Under **Bypass list**, add whoever may merge without a ticket in an emergency, e.g. org admins.

A required status check only works in repos that run the workflow. In a repo without it, the check never reports and PRs into `main` are blocked. Roll the starter workflow out to every repo before turning on this rule, or limit the ruleset's target repositories to those that have it.

### Alternative: "Require workflows to pass"

If our plan offers the ruleset rule **Require workflows to pass before merging** (GitHub Enterprise Cloud), use it instead of the status-check rule. Repos then don't need their own workflow file:

1. In the same ruleset, enable **Require workflows to pass before merging**.
2. Add the workflow: repository `arvion-ai/.github`, path `.github/workflows/linear-link-check.yml`, ref `main`.

GitHub then runs the workflow in every targeted repo through its `pull_request` trigger with the default inputs. The check appears as `linear-link`. To change the inputs for this path, change the defaults in `actions/linear-link-check/action.yml`. Repos that also added the starter workflow would run the check twice, so pick one approach.

### Recommended rollout

1. Add the starter workflow to repos with `enforce: false` in its `with:` block. For the "Require workflows" path, temporarily set the `enforce` default in `action.yml` to `'false'` instead.
2. For about a week, unlinked PRs get a warning annotation and a job summary, but nothing is blocked. Check who is getting warnings and whether any repos need extra team keys or target branches.
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
