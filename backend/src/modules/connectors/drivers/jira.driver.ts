import { Connector, ConnectorContext, ConnectorRemoteItem } from '../connector.interface';
import { fetchJson, isoDate, optionalNumber, requiredString, textFromAdf } from './http.util';

type JiraSearch = { issues: any[]; nextPageToken?: string; isLast?: boolean };

export class JiraConnectorDriver implements Connector {
  readonly type = 'JIRA';

  private base(config: Record<string, unknown>) {
    return requiredString(config, 'baseUrl', 'JIRA_BASE_URL').replace(/\/$/, '');
  }
  private auth(config: Record<string, unknown>) {
    const email = requiredString(config, 'email', 'JIRA_EMAIL');
    const token = requiredString(config, 'apiToken', 'JIRA_API_TOKEN');
    return `Basic ${Buffer.from(`${email}:${token}`).toString('base64')}`;
  }
  private headers(config: Record<string, unknown>) { return { Authorization: this.auth(config), Accept: 'application/json', 'Content-Type': 'application/json' }; }

  async connect(ctx: ConnectorContext): Promise<void> { await this.testConnection(ctx); }
  async disconnect(_ctx: ConnectorContext): Promise<void> {}

  async testConnection(ctx: ConnectorContext): Promise<boolean> {
    await fetchJson(`${this.base(ctx.config)}/rest/api/3/myself`, { headers: this.headers(ctx.config) });
    return true;
  }

  async sync(ctx: ConnectorContext) {
    const config = ctx.config;
    const projectKey = typeof config.projectKey === 'string' ? config.projectKey.trim() : '';
    const defaultJql = projectKey ? `project = ${projectKey} ORDER BY updated DESC` : 'ORDER BY updated DESC';
    const jql = String(config.jql || defaultJql);
    const maxIssues = optionalNumber(config, 'maxIssues', 100, 1, 500);
    const items: ConnectorRemoteItem[] = [];
    let nextPageToken: string | undefined = undefined;

    while (items.length < maxIssues) {
      const url = new URL(`${this.base(config)}/rest/api/3/search/jql`);
      url.searchParams.set('jql', jql);
      url.searchParams.set('maxResults', String(Math.min(50, maxIssues - items.length)));
      url.searchParams.set('fields', 'summary,description,status,assignee,reporter,labels,priority,comment,updated,created,issuetype,project');
      if (nextPageToken) url.searchParams.set('nextPageToken', nextPageToken);
      const page = await fetchJson<JiraSearch>(url.toString(), { headers: this.headers(config) });
      for (const issue of page.issues || []) {
        const f = issue.fields || {};
        const comments = (f.comment?.comments || []).map((c: any) => `${c.author?.displayName || 'unknown'} (${c.created || ''}): ${textFromAdf(c.body)}`).join('\n');
        const content = [
          `Jira project: ${f.project?.key || ''}`,
          `Issue: ${issue.key}`,
          `Type: ${f.issuetype?.name || ''}`,
          `Status: ${f.status?.name || ''}`,
          `Priority: ${f.priority?.name || ''}`,
          `Assignee: ${f.assignee?.displayName || 'Unassigned'}`,
          `Reporter: ${f.reporter?.displayName || ''}`,
          `Created: ${f.created || ''}`,
          `Updated: ${f.updated || ''}`,
          `URL: ${this.base(config)}/browse/${issue.key}`,
          '',
          `Summary: ${f.summary || ''}`,
          `Description:\n${textFromAdf(f.description) || '(none)'}`,
          `Comments:\n${comments || '(none)'}`,
        ].join('\n');
        items.push({
          externalId: `issue:${issue.key}`,
          name: `Jira ${issue.key} · ${f.summary || ''}`,
          content,
          mimeType: 'text/plain',
          externalUpdatedAt: isoDate(f.updated),
          metadata: { source: 'jira', kind: 'issue', key: issue.key, projectKey: f.project?.key || projectKey, sourceUrl: `${this.base(config)}/browse/${issue.key}` },
        });
        if (items.length >= maxIssues) break;
      }
      if (page.isLast || !page.nextPageToken) break;
      nextPageToken = page.nextPageToken;
    }

    return { items, deletedExternalIds: [], nextCursor: JSON.stringify({ syncedAt: new Date().toISOString(), jql }) };
  }
}
