import { Injectable } from '@nestjs/common';
import { Lane } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { DaysService } from '../days/days.service';
import { TICKET_INCLUDE } from '../common/ticket-include';

@Injectable()
export class QueueService {
  constructor(private prisma: PrismaService, private days: DaysService) {}

  /** The live board: ordered tickets + counters. Order = (priorityGroup, position). */
  async board(lane?: Lane, dayId?: number) {
    const day = await this.days.resolveOperatingDay(lane, dayId);
    const tickets = await this.prisma.ticket.findMany({
      where: { queueDayId: day.id },
      include: TICKET_INCLUDE,
      orderBy: [{ priorityGroup: 'asc' }, { position: 'asc' }],
    });
    const counts: Record<string, number> = {};
    let totalQty = 0;
    for (const t of tickets) {
      counts[t.status] = (counts[t.status] ?? 0) + 1;
      if (t.status !== 'CANCELLED') totalQty += t.totalQty;
    }
    return {
      day,
      counts,
      totalQty,
      current: tickets.filter((t) => t.status === 'CALLED' || t.status === 'LOADING'),
      next: tickets.find((t) => t.status === 'BOOKED' || t.status === 'SHELVED') ?? null,
      tickets,
    };
  }

  /** How many tickets are ahead of one ticket (members never see other people's names). */
  async position(ticketId: number) {
    const t = await this.prisma.ticket.findUniqueOrThrow({ where: { id: ticketId } });
    const waiting = t.status === 'BOOKED' || t.status === 'SHELVED';
    const ahead = waiting
      ? await this.prisma.ticket.count({
          where: {
            queueDayId: t.queueDayId,
            status: { in: ['BOOKED', 'SHELVED', 'CALLED', 'LOADING'] },
            OR: [{ priorityGroup: { lt: t.priorityGroup } }, { priorityGroup: t.priorityGroup, position: { lt: t.position } }],
          },
        })
      : 0;
    return { ticketId: t.id, bookingNo: t.bookingNo, status: t.status, priorityGroup: t.priorityGroup, position: t.position, ticketsAhead: ahead };
  }
}
