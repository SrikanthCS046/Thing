import {
  Connector,
  ConnectorContext,
  ConnectorRemoteItem,
} from '../connector.interface';
import {
  isoDate,
  optionalBoolean,
  optionalNumber,
  requiredString,
} from './http.util';

type SlackChannel = {
  id: string;
  name?: string;
  is_member?: boolean;
  is_archived?: boolean;
};

type SlackUser = {
  id?: string;
  name?: string;
  real_name?: string;
  deleted?: boolean;
  is_bot?: boolean;
  profile?: {
    real_name?: string;
    display_name?: string;
    title?: string;
  };
};

type SlackMessage = {
  ts?: string;
  user?: string;
  text?: string;
  reply_count?: number;
};

type SlackResponse = {
  ok?: boolean;
  error?: string;
  needed?: string;
  provided?: string;
  channels?: SlackChannel[];
  messages?: SlackMessage[];
  members?: Array<string | SlackUser>;
  response_metadata?: { next_cursor?: string };
};

const sleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

export class SlackConnectorDriver implements Connector {
  readonly type = 'SLACK';
  private readonly api = 'https://slack.com/api';

  private token(config: Record<string, unknown>): string {
    return requiredString(config, 'token', 'SLACK_BOT_TOKEN');
  }

  private headers(config: Record<string, unknown>) {
    return {
      Authorization: `Bearer ${this.token(config)}`,
      'Content-Type': 'application/x-www-form-urlencoded; charset=utf-8',
    };
  }

  private async call<T extends SlackResponse>(
    method: string,
    config: Record<string, unknown>,
    args: Record<string, string> = {},
  ): Promise<T> {
    for (let attempt = 0; attempt < 3; attempt++) {
      let response: Response;

      try {
        response = await fetch(`${this.api}/${method}`, {
          method: 'POST',
          headers: this.headers(config),
          body: new URLSearchParams(args).toString(),
          signal: AbortSignal.timeout(60_000),
        });
      } catch (error) {
        throw new Error(
          `Slack ${method} request failed: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }

      const raw = await response.text();
      let data: SlackResponse;

      try {
        data = JSON.parse(raw) as SlackResponse;
      } catch {
        throw new Error(
          `Slack ${method} returned invalid JSON (HTTP ${response.status}).`,
        );
      }

      if (response.status === 429 || data.error === 'ratelimited') {
        if (attempt === 2) {
          throw new Error(`Slack ${method}: rate limit exceeded.`);
        }

        const retryAfter = Math.max(
          1,
          Number(response.headers.get('retry-after') || '60'),
        );

        await sleep(retryAfter * 1000);
        continue;
      }

      if (!response.ok || data.ok !== true) {
        const details = [
          data.error || `HTTP ${response.status}`,
          data.needed ? `Required scopes: ${data.needed}` : '',
          data.provided ? `Granted scopes: ${data.provided}` : '',
        ]
          .filter(Boolean)
          .join('. ');

        throw new Error(`Slack ${method}: ${details}`);
      }

      return data as T;
    }

    throw new Error(`Slack ${method} failed after retries.`);
  }

  private configuredIds(config: Record<string, unknown>): string[] {
    const ids = Array.isArray(config.channelIds)
      ? config.channelIds
          .filter((value): value is string => typeof value === 'string')
          .map((value) => value.trim())
          .filter(Boolean)
      : [];

    if (typeof config.channelId === 'string') {
      const id = config.channelId.trim();
      if (id) ids.push(id);
    }

    return [...new Set(ids)];
  }

  private async listChannels(
    config: Record<string, unknown>,
  ): Promise<SlackChannel[]> {
    const channels: SlackChannel[] = [];
    let cursor = '';

    for (let pageNumber = 0; pageNumber < 100; pageNumber++) {
      const result = await this.call<SlackResponse>(
        'conversations.list',
        config,
        {
          types: 'public_channel,private_channel',
          limit: '200',
          exclude_archived: 'true',
          ...(cursor ? { cursor } : {}),
        },
      );

      channels.push(...(result.channels || []));

      cursor = result.response_metadata?.next_cursor?.trim() || '';
      if (!cursor) return channels;
    }

    throw new Error('Slack channel listing exceeded 100 pages.');
  }

  private async listUsers(
    config: Record<string, unknown>,
  ): Promise<Map<string, SlackUser>> {
    const users = new Map<string, SlackUser>();
    let cursor = '';

    for (let pageNumber = 0; pageNumber < 100; pageNumber++) {
      const result = await this.call<SlackResponse>(
        'users.list',
        config,
        {
          limit: '200',
          ...(cursor ? { cursor } : {}),
        },
      );

      for (const item of result.members || []) {
        if (
          typeof item === 'object' &&
          item !== null &&
          typeof item.id === 'string'
        ) {
          users.set(item.id, item);
        }
      }

      cursor = result.response_metadata?.next_cursor?.trim() || '';
      if (!cursor) return users;
    }

    throw new Error('Slack user listing exceeded 100 pages.');
  }

  private async listChannelMemberIds(
    config: Record<string, unknown>,
    channelId: string,
  ): Promise<string[]> {
    const memberIds: string[] = [];
    let cursor = '';

    for (let pageNumber = 0; pageNumber < 100; pageNumber++) {
      const result = await this.call<SlackResponse>(
        'conversations.members',
        config,
        {
          channel: channelId,
          limit: '200',
          ...(cursor ? { cursor } : {}),
        },
      );

      for (const member of result.members || []) {
        if (typeof member === 'string') memberIds.push(member);
      }

      cursor = result.response_metadata?.next_cursor?.trim() || '';
      if (!cursor) return memberIds;
    }

    throw new Error(
      `Slack member listing exceeded 100 pages for ${channelId}.`,
    );
  }

  private displayName(userId: string, users: Map<string, SlackUser>) {
    const user = users.get(userId);

    return (
      user?.profile?.real_name ||
      user?.real_name ||
      user?.profile?.display_name ||
      user?.name ||
      userId
    );
  }

  private async threadReplies(
    config: Record<string, unknown>,
    channelId: string,
    timestamp: string,
  ): Promise<string> {
    const result = await this.call<SlackResponse>(
      'conversations.replies',
      config,
      {
        channel: channelId,
        ts: timestamp,
        limit: '15',
      },
    );

    return (result.messages || [])
      .filter((message) => message.ts && message.ts !== timestamp)
      .map(
        (message) =>
          `${message.user || 'Unknown'}: ${message.text || ''}`,
      )
      .join('\n');
  }

  async connect(ctx: ConnectorContext): Promise<void> {
    await this.testConnection(ctx);
  }

  async disconnect(_ctx: ConnectorContext): Promise<void> {}

  async testConnection(ctx: ConnectorContext): Promise<boolean> {
    await this.call<SlackResponse>('auth.test', ctx.config);

    const channels = await this.listChannels(ctx.config);
    const requestedIds = this.configuredIds(ctx.config);

    const usable = channels.filter(
      (channel) =>
        channel.is_member === true &&
        channel.is_archived !== true,
    );

    const selected = requestedIds.length
      ? usable.filter((channel) => requestedIds.includes(channel.id))
      : usable;

    if (requestedIds.length && selected.length !== requestedIds.length) {
      throw new Error(
        'Some configured Slack channel IDs are not accessible to the bot. ' +
          'Verify the IDs, channel membership, and OAuth scopes.',
      );
    }

    if (selected.length === 0) {
      throw new Error(
        'Slack authentication succeeded, but the bot has no joined ' +
          'channels available to read. Invite the bot to a channel, ' +
          'then test the connector again.',
      );
    }

    await this.call<SlackResponse>(
      'conversations.history',
      ctx.config,
      { channel: selected[0].id, limit: '1' },
    );

    if (optionalBoolean(ctx.config, 'includeMembers', true)) {
      await this.call<SlackResponse>(
        'users.list',
        ctx.config,
        { limit: '1' },
      );
      await this.call<SlackResponse>(
        'conversations.members',
        ctx.config,
        { channel: selected[0].id, limit: '1' },
      );
    }

    return true;
  }

  async sync(ctx: ConnectorContext) {
    const config = ctx.config;
    const channels = await this.listChannels(config);
    const requestedIds = this.configuredIds(config);

    let selected: SlackChannel[];

    if (requestedIds.length) {
      selected = requestedIds.map((id) => {
        const channel = channels.find((item) => item.id === id);

        if (!channel || channel.is_member !== true) {
          throw new Error(
            `Slack channel ${id} is not accessible to this bot. ` +
              'Invite the bot to that channel and verify its ID.',
          );
        }

        return channel;
      });
    } else {
      selected = channels.filter(
        (channel) =>
          channel.is_member === true &&
          channel.is_archived !== true,
      );
    }

    if (!selected.length) {
      throw new Error(
        'No accessible Slack channels. Invite the bot and run Sync again.',
      );
    }

    const maxMessages = optionalNumber(
      config,
      'maxMessagesPerChannel',
      15,
      1,
      500,
    );

    const oldestDays = optionalNumber(config, 'oldestDays', 30, 1, 3650);

    const includeThreads = optionalBoolean(
      config,
      'includeThreads',
      false,
    );

    const includeMembers = optionalBoolean(
      config,
      'includeMembers',
      true,
    );

    const oldest = String(Date.now() / 1000 - oldestDays * 86400);
    const items: ConnectorRemoteItem[] = [];
    const users = includeMembers
      ? await this.listUsers(config)
      : new Map<string, SlackUser>();

    for (const channel of selected) {
      const channelName = channel.name || channel.id;

      if (includeMembers) {
        const memberIds = await this.listChannelMemberIds(
          config,
          channel.id,
        );

        const roster = memberIds.map((id) => {
          const user = users.get(id);
          const title = user?.profile?.title;

          return (
            `- ${this.displayName(id, users)} (Slack ID: ${id})` +
            (title ? ` — ${title}` : '')
          );
        });

        items.push({
          externalId: `channel-members:${channel.id}`,
          name: `Slack #${channelName} — Channel Members`,
          content: [
            'Source: Slack',
            `Channel: #${channelName}`,
            `Channel ID: ${channel.id}`,
            `Members: ${memberIds.length}`,
            '',
            'Members of this Slack channel:',
            ...(roster.length ? roster : ['No members returned']),
          ].join('\n'),
          mimeType: 'text/plain',
          externalUpdatedAt: new Date(),
          metadata: {
            source: 'slack',
            kind: 'channel_members',
            channelId: channel.id,
            channelName,
          },
        });
      }

      let cursor = '';
      let fetched = 0;

      while (fetched < maxMessages) {
        const page = await this.call<SlackResponse>(
          'conversations.history',
          config,
          {
            channel: channel.id,
            limit: String(Math.min(15, maxMessages - fetched)),
            oldest,
            ...(cursor ? { cursor } : {}),
          },
        );

        const messages = page.messages || [];

        for (const message of messages) {
          if (!message.ts) continue;

          const timestamp = new Date(
            Number(message.ts) * 1000,
          ).toISOString();

          const permalink =
            `https://app.slack.com/archives/${channel.id}/p` +
            message.ts.replace('.', '');

          let replies = '';

          if (includeThreads && (message.reply_count || 0) > 0) {
            replies = await this.threadReplies(
              config,
              channel.id,
              message.ts,
            );
          }

          items.push({
            externalId: `message:${channel.id}:${message.ts}`,
            name: `Slack #${channelName} — ${timestamp}`,
            content: [
              'Source: Slack',
              `Channel: #${channelName}`,
              `Channel ID: ${channel.id}`,
              `Timestamp: ${timestamp}`,
              `Author: ${this.displayName(message.user || '', users)}`,
              `URL: ${permalink}`,
              '',
              `Message:\n${message.text || '(no text)'}`,
              replies ? `\nThread replies:\n${replies}` : '',
            ].join('\n'),
            mimeType: 'text/plain',
            externalUpdatedAt: isoDate(timestamp),
            metadata: {
              source: 'slack',
              kind: 'message',
              channelId: channel.id,
              channelName,
              ts: message.ts,
              sourceUrl: permalink,
            },
          });

          fetched++;

          if (fetched >= maxMessages) break;
        }

        const next = page.response_metadata?.next_cursor?.trim() || '';

        if (!next || next === cursor || messages.length === 0) break;

        cursor = next;
      }
    }

    return {
      items,
      deletedExternalIds: [],
      nextCursor: JSON.stringify({
        syncedAt: new Date().toISOString(),
        channels: selected.map((channel) => channel.id),
      }),
    };
  }
}
