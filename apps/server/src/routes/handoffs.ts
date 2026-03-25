import type { FastifyInstance } from 'fastify';
import type { CreateHandoffRequest } from '@control-room/shared-types';
import { handoffService } from '../services/handoff-service.js';
import { messageService } from '../services/message-service.js';
import { orchestrator } from '../orchestrator/room-orchestrator.js';
import { roomChannel } from '../ws/room-channel.js';

export async function handoffRoutes(app: FastifyInstance) {
  app.post<{ Params: { roomId: string }; Body: CreateHandoffRequest }>(
    '/api/rooms/:roomId/handoffs',
    async (req, reply) => {
      const { roomId } = req.params;
      const { targetAgent, selectedMessageIds, userInstruction } = req.body;

      if (!selectedMessageIds?.length) {
        return reply.status(400).send({ error: 'Must select at least one message' });
      }

      // 1. Create handoff bundle
      const bundle = await handoffService.createBundle({
        roomId,
        targetAgent,
        selectedMessageIds,
        userInstruction,
      });

      // 2. Create visible handoff-summary message in chat
      await messageService.create({
        roomId,
        role: 'handoff-summary',
        content: `**Handoff to ${targetAgent}** (${selectedMessageIds.length} messages)\n\nTask: ${userInstruction}\n\nGoal: ${bundle.structuredSummary.goal}`,
        selectable: false,
      });

      // 3. Broadcast
      roomChannel.broadcast(roomId, { type: 'handoff.created', data: bundle });

      // 4. Compose handoff prompt and dispatch with triggerType='handoff'
      const handoffPrompt = [
        '[Handoff Task]',
        `Target: ${userInstruction}`,
        '',
        '[Structured Summary]',
        `Goal: ${bundle.structuredSummary.goal}`,
        bundle.structuredSummary.decisions.length > 0
          ? `Decisions:\n${bundle.structuredSummary.decisions.map((d) => `- ${d}`).join('\n')}`
          : '',
        bundle.structuredSummary.constraints.length > 0
          ? `Constraints:\n${bundle.structuredSummary.constraints.map((c) => `- ${c}`).join('\n')}`
          : '',
        '',
        '[Selected Transcript]',
        bundle.rawExcerpt,
      ]
        .filter(Boolean)
        .join('\n');

      orchestrator
        .handleUserMessage(roomId, handoffPrompt, targetAgent, undefined, 'handoff')
        .catch((err) => {
          app.log.error({ err, roomId }, 'Handoff dispatch error');
        });

      return bundle;
    },
  );
}
