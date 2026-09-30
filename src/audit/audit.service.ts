import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { plain, Tx } from '../common/utils';

export interface AuditInput {
  action: string;
  entity: string;
  entityId?: string | number;
  actor?: string;
  before?: unknown;
  after?: unknown;
  reason?: string;
}

@Injectable()
export class AuditService {
  constructor(private prisma: PrismaService) {}

  /** Pass the transaction client so the audit row commits (or rolls back) with the change. */
  log(client: Tx, e: AuditInput) {
    return client.auditEvent.create({
      data: {
        action: e.action,
        entity: e.entity,
        entityId: e.entityId != null ? String(e.entityId) : null,
        actor: e.actor ?? null,
        beforeJson: plain(e.before),
        afterJson: plain(e.after),
        reason: e.reason ?? null,
      },
    });
  }

  list(q: { entity?: string; entityId?: string; action?: string; limit?: number }) {
    return this.prisma.auditEvent.findMany({
      where: { entity: q.entity, entityId: q.entityId, action: q.action },
      orderBy: { id: 'desc' },
      take: Math.min(q.limit ?? 50, 500),
    });
  }
}
