export function resolveCommitSha(
  env: Record<string, string | undefined> = process.env
): string {
  return (
    env.VERCEL_GIT_COMMIT_SHA ||
    env.CF_PAGES_COMMIT_SHA ||
    env.GITHUB_SHA ||
    'dev'
  );
}
