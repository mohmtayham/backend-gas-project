import { HttpStatus, Injectable } from '@nestjs/common';
import { Lane } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AppError } from '../common/app-error';
import { dateOnly, Tx } from '../common/utils';
import { CreateQuotaDto, UpdateQuotaDto } from './dto/quota.dto';

/**
 * Quota ledger:  available = quotaQty - reserved - consumed
 *  booking accepted  -> reserved  + qty
 *  loading completed -> reserved  - booked,  consumed + loaded
 *  ticket cancelled  -> reserved  - booked   (released)
 */
@Injectable()
export class QuotasService {
  constructor(private prisma: PrismaService, private audit: AuditService) {}

  // ───── master data ─────
  list(agentId?: string) {
    return this.prisma.agentQuota.findMany({
      where: { agentId },
      include: { agent: { select: { id: true, code: true, name: true } } },
      orderBy: [{ agentId: 'asc' }, { periodStart: 'desc' }],
    });
  }

  create(dto: CreateQuotaDto) {
    const periodStart = dateOnly(dto.periodStart);
    const periodEnd = dateOnly(dto.periodEnd);
    if (periodEnd < periodStart) throw new AppError('INVALID_PERIOD', 'periodEnd must be on or after periodStart');
    return this.prisma.agentQuota.create({ data: { ...dto, periodStart, periodEnd } });
  }

  async update(id: number, dto: UpdateQuotaDto) {
    return this.prisma.$transaction(async (tx) => {
      const before = await tx.agentQuota.findUniqueOrThrow({ where: { id } });
      const after = await tx.agentQuota.update({ where: { id }, data: { quotaQty: dto.quotaQty } });
      await this.audit.log(tx, {
        action: 'QUOTA_CHANGED', entity: 'AgentQuota', entityId: id,
        before: { quotaQty: before.quotaQty }, after: { quotaQty: after.quotaQty }, reason: dto.reason,
      });
      return after;
    });
  }

  // ───── ledger maths ─────
  findPeriod(tx: Tx, agentId: string, fillType: Lane, date: Date) {
    return tx.agentQuota.findFirst({
      where: { agentId, fillType, periodStart: { lte: date }, periodEnd: { gte: date } },
      orderBy: { periodStart: 'desc' },
    });
  }

  async availability(tx: Tx, agentId: string, fillType: Lane, date: Date) {
    const q = await this.findPeriod(tx, agentId, fillType, date);
    if (!q) return null;
    const r = await tx.quotaLedger.aggregate({
      where: { agentId, fillType, periodStart: q.periodStart },
      _sum: { reservedDelta: true, consumedDelta: true },
    });
    const reserved = r._sum.reservedDelta ?? 0;
    const consumed = r._sum.consumedDelta ?? 0;
    return {
      agentId, fillType,
      periodStart: q.periodStart, periodEnd: q.periodEnd,
      quotaQty: q.quotaQty, reserved, consumed,
      available: q.quotaQty - reserved - consumed,
    };
  }

  availabilityFor(agentId: string, fillType: Lane, date?: string) {
    return this.availability(this.prisma, agentId, fillType, date ? dateOnly(date) : dateOnly(new Date()));
  }

  async assertAvailable(tx: Tx, agentId: string, fillType: Lane, date: Date, qty: number) {
    const a = await this.availability(tx, agentId, fillType, date);
    if (!a) throw new AppError('NO_QUOTA', 'Agent has no quota for this fill type and date', HttpStatus.CONFLICT, { agentId, fillType });
    if (qty > a.available)
      throw new AppError('QUOTA_EXCEEDED', `Requested ${qty} but only ${a.available} is available`, HttpStatus.CONFLICT, {
        agentId, requested: qty, available: a.available,
      });
  }

  async reserve(tx: Tx, line: { id: number; agentId: string; qtyBooked: number }, fillType: Lane, date: Date, actor: string) {
    const q = await this.findPeriod(tx, line.agentId, fillType, date);
    await tx.quotaLedger.create({
      data: {
        agentId: line.agentId, fillType, periodStart: q.periodStart, ticketLineId: line.id,
        reservedDelta: line.qtyBooked, reason: 'BOOKING', createdBy: actor,
      },
    });
  }

  /** Give back whatever is still reserved for this line. */
  async release(tx: Tx, lineId: number, reason: string, actor: string) {
    const rows = await tx.quotaLedger.findMany({ where: { ticketLineId: lineId } });
    const reserved = rows.reduce((s, r) => s + r.reservedDelta, 0);
    if (!rows.length || reserved === 0) return;
    const f = rows[0];
    await tx.quotaLedger.create({
      data: { agentId: f.agentId, fillType: f.fillType, periodStart: f.periodStart, ticketLineId: lineId, reservedDelta: -reserved, reason, createdBy: actor },
    });
  }

  /** Loading finished: reserved -> consumed. The unloaded remainder simply becomes available again. */
  async consume(tx: Tx, lineId: number, loaded: number, actor: string) {
    const rows = await tx.quotaLedger.findMany({ where: { ticketLineId: lineId } });
    if (!rows.length) return;
    const reserved = rows.reduce((s, r) => s + r.reservedDelta, 0);
    const f = rows[0];
    await tx.quotaLedger.create({
      data: {
        agentId: f.agentId, fillType: f.fillType, periodStart: f.periodStart, ticketLineId: lineId,
        reservedDelta: -reserved, consumedDelta: loaded, reason: 'LOADED', createdBy: actor,
      },
    });
  }
}
