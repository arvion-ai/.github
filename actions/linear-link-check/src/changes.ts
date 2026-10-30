// Tells whether a pull request changes any file, from git trees rather than
// from the payload's changed_files count, which GitHub can report as 0 for a
// PR that does change files.

/** The two GitHub API reads used here, typed narrowly so tests can fake them. */
export interface GitReads {
  repos: {
    compareCommitsWithBasehead(params: {
      owner: string;
      repo: string;
      basehead: string;
      per_page: number;
    }): Promise<{ data: { merge_base_commit: { commit: { tree: { sha: string } } } } }>;
  };
  git: {
    getCommit(params: { owner: string; repo: string; commit_sha: string }): Promise<{ data: { tree: { sha: string } } }>;
  };
}

export interface PullRequestCommits {
  owner: string;
  repo: string;
  baseSha: string;
  headSha: string;
}

/**
 * True when the head commit has the same tree as the merge base of the base
 * and head commits. The PR's diff is then empty, so a squash merge would add
 * an empty commit. A production-to-main PR after a release is like this: it
 * carries only the release merge commits.
 */
export async function changesNoFiles(api: GitReads, pr: PullRequestCommits): Promise<boolean> {
  const { owner, repo, baseSha, headSha } = pr;
  const [comparison, head] = await Promise.all([
    // per_page bounds the commit list in the response; only the merge base is read.
    api.repos.compareCommitsWithBasehead({ owner, repo, basehead: `${baseSha}...${headSha}`, per_page: 1 }),
    api.git.getCommit({ owner, repo, commit_sha: headSha }),
  ]);
  return comparison.data.merge_base_commit.commit.tree.sha === head.data.tree.sha;
}
