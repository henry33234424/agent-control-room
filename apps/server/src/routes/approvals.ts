import type { FastifyInstance } from 'fastify';
import type { DecideApprovalRequest } from '@control-room/shared-types';
import { approvalService } from '../services/approval-service.js';

export async function approvalRoutes(app: FastifyInstance) {
  app.post<{ Params: { approvalId: string }; Body: DecideApprovalRequest }>(
    '/api/approvals/:approvalId/decide',
    async (req, reply) => {
      const { approvalId } = req.params;
      const { decision } = req.body;

      try {
        await approvalService.decide(approvalId, decision);
        return { ok: true };
      } catch (err) {
        return reply.status(400).send({
          error: err instanceof Error ? err.message : 'Failed to decide approval',
        });
      }
    },
  );
}
