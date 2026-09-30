import { Injectable } from '@nestjs/common';
import { Lane } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { QuotasService } from '../quotas/quotas.service';
import { dateOnly } from '../common/utils';

@Injectable()
export class ReportsService {
  constructor(private prisma: PrismaService, private quotas: QuotasService) {}

  /** Totals for one queue day. */
  async daily(dayId: number) {
    const day = await this.prisma.queueDay.findUniqueOrThrow({ where: { id: dayId } });
    const tickets = await this.prisma.ticket.findMany({
      where: { queueDayId: dayId },
      include: { lines: { include: { agent: { select: { id: true, code: true, name: true } } } } },
    });

    const byStatus: Record<string, number> = {};
    const agents = new Map<string, { agentId: string; code: string; name: string; booked: number; loaded: number }>();
    let bookedQty = 0;
    let loadedQty = 0;
    for (const t of tickets) {
      byStatus[t.status] = (byStatus[t.status] ?? 0) + 1;
      if (t.status === 'CANCELLED') continue;
      bookedQty += t.totalQty;
      for (const l of t.lines) {
        loadedQty += l.qtyLoaded ?? 0;
        const a = agents.get(l.agentId) ?? { agentId: l.agentId, code: l.agent.code, name: l.agent.name, booked: 0, loaded: 0 };
        a.booked += l.qtyBooked;
        a.loaded += l.qtyLoaded ?? 0;
        agents.set(l.agentId, a);
      }
    }
    return {
      day, tickets: tickets.length, byStatus, bookedQty, loadedQty,
      carriedTickets: tickets.filter((t) => t.carryCount > 0).length,
      byAgent: [...agents.values()],
    };
  }

  /** Quota statement + recent lines for one agent. */
  async agent(agentId: string, date?: string) {
    const agent = await this.prisma.agent.findUniqueOrThrow({ where: { id: agentId } });
    const d = date ? dateOnly(date) : dateOnly(new Date());
    const quota = [];
    for (const lane of ['DOMESTIC', 'INDUSTRIAL'] as Lane[]) {
      const a = await this.quotas.availability(this.prisma, agentId, lane, d);
      if (a) quota.push(a);
    }
    const lines = await this.prisma.ticketLine.findMany({
      where: { agentId },
      include: { ticket: { select: { id: true, bookingNo: true, status: true, lane: true, queueDay: { select: { opDate: true } } } } },
      orderBy: { id: 'desc' },
      take: 50,
    });
    return { agent, quota, recentLines: lines };
  }

  /** Remaining quota of every agent for a lane. */
  async quota(lane: Lane, date?: string) {
    const d = date ? dateOnly(date) : dateOnly(new Date());
    const quotas = await this.prisma.agentQuota.findMany({
      where: { fillType: lane, periodStart: { lte: d }, periodEnd: { gte: d } },
      include: { agent: { select: { id: true, code: true, name: true } } },
      orderBy: { agentId: 'asc' },
    });
    const rows = [];
    for (const q of quotas) {
      const a = await this.quotas.availability(this.prisma, q.agentId, lane, d);
      rows.push({ agent: q.agent, ...a });
    }
    return rows;
  }
}
