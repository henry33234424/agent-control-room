import type { ChatMessage, AgentKind, ChatMessageRole } from '@control-room/shared-types';
import { prisma } from '../db.js';
import { roomChannel } from '../ws/room-channel.js';
import { toMessageDto } from '../lib/dto.js';

export interface CreateMessageInput {
  roomId: string;
  sessionId?: string;
  agent?: AgentKind;
  role: ChatMessageRole;
  content: string;
  mentionTarget?: string;
  replyToMessageId?: string;
  selectable?: boolean;
  pinned?: boolean;
}

export class MessageService {
  async create(input: CreateMessageInput): Promise<ChatMessage> {
    const msg = await prisma.chatMessage.create({
      data: {
        roomId: input.roomId,
        sessionId: input.sessionId ?? null,
        agent: input.agent ?? null,
        role: input.role,
        mentionTarget: input.mentionTarget ?? null,
        replyToMessageId: input.replyToMessageId ?? null,
        content: input.content,
        contentFormat: 'markdown',
        selectable: input.selectable ?? true,
        pinned: input.pinned ?? false,
      },
    });

    const chatMsg = toMessageDto(msg);
    roomChannel.broadcast(input.roomId, { type: 'message.created', data: chatMsg });
    return chatMsg;
  }
}

export const messageService = new MessageService();
