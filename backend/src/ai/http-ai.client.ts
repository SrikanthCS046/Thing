import { Injectable, Logger } from '@nestjs/common';
import {
  AiClient,
  ChatRequest,
  RetrievedChunk,
  TextChunkDraft,
} from './ai-client.interface';

@Injectable()
export class HttpAiClient implements AiClient {
  private readonly logger = new Logger(HttpAiClient.name);
  private readonly baseUrl = (process.env.AI_SERVICE_URL || 'http://127.0.0.1:8001').replace(/\/$/, '');

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    let response: Response;

    try {
      response = await fetch(url, {
        ...init,
        signal: AbortSignal.timeout(30_000),
        headers: {
          'content-type': 'application/json',
          ...(init?.headers || {}),
        },
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : String(error);

      this.logger.error(
        `AI service connection failed: ${url} - ${message}`,
      );

      throw new Error(
        `AI service is unreachable at ${url}. ` +
          `Make sure the Python AI service is running on port 8001. ` +
          `Original error: ${message}`,
      );
    }

    const raw = await response.text();

    if (!response.ok) {
      this.logger.error(
        `AI service error ${response.status} ${path}: ${raw.slice(0, 2000)}`,
      );

      throw new Error(
        `AI service ${response.status} at ${path}: ${raw.slice(0, 2000)}`,
      );
    }

    try {
      return (raw ? JSON.parse(raw) : {}) as T;
    } catch {
      throw new Error(`AI service returned invalid JSON from ${path}`);
    }
  }

  async extractText(input: { buffer: Buffer; mimeType: string; filename: string }): Promise<string> {
    const result = await this.request<{ text: string }>('/extract', {
      method: 'POST',
      body: JSON.stringify({
        filename: input.filename,
        mime_type: input.mimeType,
        content_base64: input.buffer.toString('base64'),
      }),
    });
    return result.text;
  }

  async chunkText(text: string): Promise<TextChunkDraft[]> {
    const result = await this.request<{ chunks: TextChunkDraft[] }>('/chunk', {
      method: 'POST',
      body: JSON.stringify({ text }),
    });
    return result.chunks;
  }

  async embed(texts: string[]): Promise<number[][]> {
    const result = await this.request<{ embeddings: number[][] }>('/embed', {
      method: 'POST',
      body: JSON.stringify({ texts }),
    });
    return result.embeddings;
  }

  async rerank(query: string, chunks: RetrievedChunk[]): Promise<RetrievedChunk[]> {
    if (!chunks.length) return [];
    const result = await this.request<{ chunks: RetrievedChunk[] }>('/rerank', {
      method: 'POST',
      body: JSON.stringify({ query, chunks }),
    });
    return result.chunks;
  }

  async *chatStream(request: ChatRequest): AsyncGenerator<string, void, unknown> {
    const result = await this.request<{ answer: string }>('/chat', {
      method: 'POST',
      body: JSON.stringify(request),
    });
    const parts = result.answer.match(/.{1,80}(?:\s+|$)/g) || [result.answer];
    for (const part of parts) yield part;
  }

  async summarizeConversation(request: {
    previousSummary: string | null;
    messages: { role: string; content: string }[];
  }): Promise<string> {
    const result = await this.request<{ summary: string }>('/summarize', {
      method: 'POST',
      body: JSON.stringify({ kind: 'conversation', ...request }),
    });
    return result.summary;
  }

  async summarizeKnowledge(request: {
    kind: string;
    title: string;
    text: string;
  }): Promise<string> {
    try {
      const result = await this.request<{ summary: string }>('/summarize', {
        method: 'POST',
        body: JSON.stringify(request),
      });
      return result.summary;
    } catch (error) {
      this.logger.error(error instanceof Error ? error.message : 'AI summary failed');
      throw error;
    }
  }
}
