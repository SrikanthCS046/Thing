import { Injectable } from '@nestjs/common';
import { ConnectorType } from '../../generated/prisma/client';
import { Connector } from './connector.interface';
import { GithubConnectorDriver } from './drivers/github.driver';
import { JiraConnectorDriver } from './drivers/jira.driver';
import { SlackConnectorDriver } from './drivers/slack.driver';

@Injectable()
export class ConnectorRegistry {
  private readonly drivers = new Map<ConnectorType, Connector>();

  constructor() {
    this.drivers.set(ConnectorType.GITHUB, new GithubConnectorDriver());
    this.drivers.set(ConnectorType.JIRA, new JiraConnectorDriver());
    this.drivers.set(ConnectorType.SLACK, new SlackConnectorDriver());
  }

  get(type: ConnectorType): Connector {
    const driver = this.drivers.get(type);
    if (!driver) throw new Error(`No connector driver registered for ${type}. VedaFlux enables GitHub, Jira and Slack only.`);
    return driver;
  }

  listTypes(): ConnectorType[] { return [...this.drivers.keys()]; }
}
