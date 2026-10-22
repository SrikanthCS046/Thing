import {
  Body,
  Controller,
  Delete,
  Get,
  HttpException,
  Param,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';

import type { ChatCitation } from '../../ai/ai-client.interface';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { SkipResponseWrap } from '../../common/decorators/skip-response-wrap.decorator';
import type { AuthUser } from '../../common/interfaces/jwt-payload.interface';
import { ChatService } from './chat.service';
import { ChatDto } from './dto/chat.dto';

@ApiTags('chat')
@ApiBearerAuth()
@Controller()
export class ChatController {
  constructor(private readonly chatService: ChatService) {}

  @SkipResponseWrap()
  @Post('workspaces/:workspaceId/chat')
  async chat(
    @CurrentUser() user: AuthUser,
    @Param('workspaceId') workspaceId: string,
    @Body() dto: ChatDto,
  ) {
    try {
      let conversationId = '';
      let citations: ChatCitation[] = [];
      let memory = {
        hasSummary: false,
        recentTurns: 0,
      };
      let answer = '';

      for await (const event of this.chatService.streamChat(
        user.id,
        workspaceId,
        dto.message,
        dto.conversationId,
      )) {
        if (event.type === 'meta') {
          conversationId = event.conversationId;
          citations = event.citations;
          memory = event.memory;
        }

        if (event.type === 'token') {
          answer += event.content;
        }
      }

      return {
        conversationId,
        citations,
        memory,
        answer,
      };
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Chat failed';

      throw new HttpException(message, 502);
    }
  }

  @Get('workspaces/:workspaceId/conversations')
  list(
    @CurrentUser() user: AuthUser,
    @Param('workspaceId') workspaceId: string,
  ) {
    return this.chatService.listConversations(user.id, workspaceId);
  }

  @Get('conversations/:id')
  getOne(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.chatService.getConversation(user.id, id);
  }

  @Get('conversations/:id/memory')
  getMemory(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.chatService.getMemory(user.id, id);
  }

  @Delete('conversations/:id')
  remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.chatService.deleteConversation(user.id, id);
  }
}
