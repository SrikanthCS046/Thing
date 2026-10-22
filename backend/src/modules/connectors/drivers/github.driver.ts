import { Connector, ConnectorContext, ConnectorRemoteItem } from '../connector.interface';
import { fetchJson, isoDate, optionalBoolean, optionalNumber, requiredString } from './http.util';

type GithubRepo = { default_branch: string; html_url: string; full_name: string; updated_at: string };
type GithubTree = { tree: { path: string; mode: string; type: string; sha: string; size?: number; url: string }[]; truncated: boolean };
type GithubContent = { content?: string; encoding?: string; html_url: string; download_url?: string; size: number };
type GithubCommit = { sha: string; html_url: string; commit: { message: string; author?: { name?: string; date?: string }; committer?: { name?: string; date?: string } } };
type GithubPr = { number: number; title: string; body?: string; state: string; html_url: string; updated_at: string; user?: { login?: string }; merged_at?: string | null; diff_url?: string };
type GithubPrFile = { filename: string; status: string; additions: number; deletions: number; patch?: string };

export class GithubConnectorDriver implements Connector {
  readonly type = 'GITHUB';
  private readonly api = 'https://api.github.com';

  private token(config: Record<string, unknown>) {
    return requiredString(config, 'token', 'GITHUB_TOKEN');
  }

  private headers(config: Record<string, unknown>) {
    return {
      Authorization: `Bearer ${this.token(config)}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': process.env.GITHUB_API_VERSION || '2022-11-28',
      'User-Agent': 'VedaFlux/1.0',
    };
  }

  private repoParts(config: Record<string, unknown>) {
    const repo = requiredString(config, 'repo', 'GITHUB_REPO');
    const owner = requiredString(config, 'owner', 'GITHUB_OWNER');
    return { owner, repo };
  }

  async connect(ctx: ConnectorContext): Promise<void> {
    await this.testConnection(ctx);
  }
  async disconnect(_ctx: ConnectorContext): Promise<void> {}

  async testConnection(ctx: ConnectorContext): Promise<boolean> {
    const { owner, repo } = this.repoParts(ctx.config);
    await fetchJson<GithubRepo>(`${this.api}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`, { headers: this.headers(ctx.config) });
    return true;
  }

  async sync(ctx: ConnectorContext) {
    const { owner, repo } = this.repoParts(ctx.config);
    const config = ctx.config;
    const repoInfo = await fetchJson<GithubRepo>(`${this.api}/repos/${owner}/${repo}`, { headers: this.headers(config) });
    const branch = String(config.branch || repoInfo.default_branch);
    const tree = await fetchJson<GithubTree>(`${this.api}/repos/${owner}/${repo}/git/trees/${encodeURIComponent(branch)}?recursive=1`, { headers: this.headers(config) });
    const maxFiles = optionalNumber(config, 'maxFiles', 200, 1, 1000);
    const includeCommits = optionalBoolean(config, 'includeCommits', true);
    const includePullRequests = optionalBoolean(config, 'includePullRequests', true);
    const allowed = String(config.extensions || '.ts,.tsx,.js,.jsx,.py,.java,.go,.rs,.cpp,.c,.h,.hpp,.cs,.php,.rb,.md,.json,.yml,.yaml,.sql,.sh,.env.example').split(',').map((x) => x.trim().toLowerCase()).filter(Boolean);

    const items: ConnectorRemoteItem[] = [];
    const files = tree.tree.filter((x) => x.type === 'blob' && allowed.some((ext) => x.path.toLowerCase().endsWith(ext))).slice(0, maxFiles);
    for (const file of files) {
      try {
        const content = await fetchJson<GithubContent>(`${this.api}/repos/${owner}/${repo}/contents/${file.path}?ref=${encodeURIComponent(branch)}`, { headers: { ...this.headers(config), Accept: 'application/vnd.github+json' } });
        let text = '';
        if (content.encoding === 'base64' && content.content) text = Buffer.from(content.content.replace(/\n/g, ''), 'base64').toString('utf8');
        if (text && text.length > 2_000_000) text = text.slice(0, 2_000_000);
        if (!text) continue;
        items.push({
          externalId: `file:${file.path}`,
          name: `GitHub · ${file.path}`,
          content: `Repository: ${repoInfo.full_name}\nBranch: ${branch}\nPath: ${file.path}\nURL: ${content.html_url}\n\n${text}`,
          mimeType: 'text/plain',
          metadata: { source: 'github', kind: 'code', owner, repo, path: file.path, branch, sourceUrl: content.html_url, sha: file.sha },
        });
      } catch {
        // Skip an unreadable file and continue the repository sync.
      }
    }

    if (includeCommits) {
      const commits = await fetchJson<GithubCommit[]>(`${this.api}/repos/${owner}/${repo}/commits?sha=${encodeURIComponent(branch)}&per_page=${optionalNumber(config, 'maxCommits', 50, 1, 100)}`, { headers: this.headers(config) });
      for (const commit of commits) {
        items.push({
          externalId: `commit:${commit.sha}`,
          name: `GitHub Commit · ${commit.sha.slice(0, 7)} · ${commit.commit.message.split('\n')[0]}`,
          content: `Repository: ${repoInfo.full_name}\nCommit: ${commit.sha}\nURL: ${commit.html_url}\nAuthor: ${commit.commit.author?.name || ''}\nDate: ${commit.commit.author?.date || ''}\n\n${commit.commit.message}`,
          mimeType: 'text/plain',
          externalUpdatedAt: isoDate(commit.commit.author?.date || commit.commit.committer?.date),
          metadata: { source: 'github', kind: 'commit', owner, repo, sha: commit.sha, sourceUrl: commit.html_url },
        });
      }
    }

    if (includePullRequests) {
      const prs = await fetchJson<GithubPr[]>(`${this.api}/repos/${owner}/${repo}/pulls?state=all&sort=updated&direction=desc&per_page=${optionalNumber(config, 'maxPullRequests', 50, 1, 100)}`, { headers: this.headers(config) });
      for (const pr of prs) {
        let patches = '';
        try {
          const files = await fetchJson<GithubPrFile[]>(`${this.api}/repos/${owner}/${repo}/pulls/${pr.number}/files?per_page=100`, { headers: this.headers(config) });
          patches = files.slice(0, 100).map((f) => `\nFILE: ${f.filename} (${f.status}, +${f.additions}/-${f.deletions})\n${f.patch || '[patch unavailable]'}`).join('\n');
        } catch {
          patches = '\n[PR file patches unavailable]';
        }
        items.push({
          externalId: `pr:${pr.number}`,
          name: `GitHub PR #${pr.number} · ${pr.title}`,
          content: `Repository: ${repoInfo.full_name}\nPull Request: #${pr.number}\nState: ${pr.state}\nAuthor: ${pr.user?.login || ''}\nUpdated: ${pr.updated_at}\nMerged: ${pr.merged_at || ''}\nURL: ${pr.html_url}\nDiff: ${pr.diff_url || ''}\n\n${pr.body || '(no description)'}\n\nChanged files and patches:${patches}`,
          mimeType: 'text/plain',
          externalUpdatedAt: isoDate(pr.updated_at),
          metadata: { source: 'github', kind: 'pull_request', owner, repo, number: pr.number, sourceUrl: pr.html_url },
        });
      }
    }

    const nextCursor = JSON.stringify({ branch, treeSha: tree.tree[0]?.sha || null, syncedAt: new Date().toISOString() });
    return { items, deletedExternalIds: [], nextCursor };
  }
}
