import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';

import { CONNECTOR_SYNC_QUEUE } from '../../common/constants/rag.constants';
import {
  ConnectorSyncJobData,
  ConnectorSyncService,
} from './connector-sync.service';

@Processor(CONNECTOR_SYNC_QUEUE)
export class ConnectorSyncProcessor extends WorkerHost {
  private readonly logger = new Logger(ConnectorSyncProcessor.name);

  constructor(private readonly syncService: ConnectorSyncService) {
    super();
  }

  async process(job: Job<ConnectorSyncJobData>): Promise<unknown> {
    const connectorId = job.data.connectorId;

    this.logger.log(
      `Starting sync job ${job.id} for connector ${connectorId}`,
    );

    try {
      const result = await this.syncService.syncConnector(connectorId);

      this.logger.log(
        `Sync job ${job.id} completed: ${JSON.stringify(result)}`,
      );

      return result;
    } catch (error) {
      const message =
        error instanceof Error ? error.message : String(error);

      this.logger.error(
        `Sync job ${job.id} failed for connector ${connectorId}: ${message}`,
        error instanceof Error ? error.stack : undefined,
      );

      throw error;
    }
  }
}
