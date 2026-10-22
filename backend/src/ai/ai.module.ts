import { Global, Module } from '@nestjs/common';
import { AI_CLIENT } from './ai-client.interface';
import { HttpAiClient } from './http-ai.client';

@Global()
@Module({
  providers: [HttpAiClient, { provide: AI_CLIENT, useExisting: HttpAiClient }],
  exports: [AI_CLIENT, HttpAiClient],
})
export class AiModule {}
