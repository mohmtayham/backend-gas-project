import { HttpStatus, Injectable } from '@nestjs/common';
import { Prisma, TicketStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import { AuditService } from '../audit/audit.service';
import { QuotasService } from '../quotas/quotas.service';
import { DaysService } from '../days/days.service';
import { AppError } from '../common/app-error';
import { lockDay, Tx, TX_OPTS } from '../common/utils';
import { TICKET_INCLUDE } from '../common/ticket-include';
import { CallNextDto, GateActionDto, LoadedDto } from './dto/gate.dto';

@Injectable()
export class GateService {
  constructor(
    private prisma: PrismaService,
    private settings: SettingsService,
    private audit: AuditService,
    private quotas: QuotasService,
    private days: DaysService,
  ) {}

  // ───── call next: first BOOKED/SHELVED by (priorityGroup, position) ─────
  async callNext(dto: CallNextDto) {
    const day = await this.days.resolveOperatingDay(dto.lane, dto.dayId);
    return this.prisma.$transaction(async (tx) => {
      await lockDay(tx, day.id); // two bays can never get the same ticket
      const d = await tx.queueDay.findUniqueOrThrow({ where: { id: day.id } });

      if (d.status === 'CLOSED') throw new AppError('DAY_CLOSED', 'This day is closed', HttpStatus.CONFLICT);
      if (d.status === 'BOOKING_OPEN') throw new AppError('WINDOW_STILL_OPEN', 'Close the booking window before calling tickets', HttpStatus.CONFLICT);
      if (d.linePausedAt) throw new AppError('LINE_PAUSED', `Line is paused: ${d.pauseReason ?? ''}`, HttpStatus.CONFLICT);

      const bay = await this.pickBay(tx, d.lane, dto.bayId);
      const next = await tx.ticket.findFirst({
        where: { queueDayId: d.id, status: { in: ['BOOKED', 'SHELVED'] } },
        orderBy: [{ priorityGroup: 'asc' }, { position: 'asc' }],
      });
      if (!next) return { ticket: null, message: 'NO_MORE' };

      const ticket = await tx.ticket.update({
        where: { id: next.id },
        data: { status: 'CALLED', bayId: bay?.id ?? null, calledAt: new Date(), version: { increment: 1 } },
        include: TICKET_INCLUDE,
      });
      if (d.status !== 'IN_PROGRESS') await tx.queueDay.update({ where: { id: d.id }, data: { status: 'IN_PROGRESS' } });
      await this.audit.log(tx, { action: 'CALLED', entity: 'Ticket', entityId: ticket.id, actor: dto.actor, after: { bayId: bay?.id ?? null, position: ticket.position, group: ticket.priorityGroup } });
      return { ticket, message: 'CALLED' };
    }, TX_OPTS);
  }

  // ───── present: CALLED -> LOADING ─────
  async start(id: number, dto: GateActionDto) {
    const ticket = await this.prisma.$transaction(async (tx) => {
      const { after } = await this.move(tx, id, ['CALLED'], { status: 'LOADING', loadingStartedAt: new Date() }, 'LOADING_STARTED', dto);
      return after;
    }, TX_OPTS);
    return { ticket };
  }

  // ───── loaded: LOADING -> COMPLETED (quota: reserved -> consumed) ─────
  async loaded(id: number, dto: LoadedDto) {
    const { after, before } = await this.prisma.$transaction(async (tx) => {
      const res = await this.move(tx, id, ['LOADING'], { status: 'COMPLETED', completedAt: new Date() }, 'LOADED', { actor: dto.actor });
      const lines = await tx.ticketLine.findMany({ where: { ticketId: id } });
      const byId = new Map((dto.lines ?? []).map((l) => [l.lineId, l.qtyLoaded]));
      for (const k of byId.keys()) if (!lines.some((l) => l.id === k)) throw new AppError('LINE_NOT_FOUND', `Line ${k} is not part of ticket ${id}`, HttpStatus.NOT_FOUND);

      for (const l of lines) {
        const loaded = byId.has(l.id) ? byId.get(l.id) : l.qtyBooked;
        if (loaded < 0 || loaded > l.qtyBooked)
          throw new AppError('INVALID_QTY', `Loaded quantity must be between 0 and ${l.qtyBooked}`, HttpStatus.BAD_REQUEST, { lineId: l.id });
        await tx.ticketLine.update({ where: { id: l.id }, data: { qtyLoaded: loaded } });
        await this.quotas.consume(tx, l.id, loaded, dto.actor ?? 'gate');
      }
      return { ...res, after: await tx.ticket.findUniqueOrThrow({ where: { id }, include: TICKET_INCLUDE }) };
    }, TX_OPTS);
    return { ticket: after, next: await this.autoCall(after.queueDayId, before.bayId) };
  }

  // ───── skip: CALLED -> SKIPPED (free the bay, auto-call the next) ─────
  async skip(id: number, dto: GateActionDto) {
    const { after, before } = await this.prisma.$transaction(
      (tx) => this.move(tx, id, ['CALLED'], { status: 'SKIPPED', bayId: null }, 'SKIPPED', dto),
      TX_OPTS,
    );
    return { ticket: after, next: await this.autoCall(after.queueDayId, before.bayId) };
  }

  // ───── late: SKIPPED -> SHELVED (end of today's queue) ─────
  async late(id: number, dto: GateActionDto) {
    return { ticket: await this.shelve(id, ['SKIPPED'], 'SHELVED_LATE', dto) };
  }

  // ───── absent: SKIPPED -> ABSENT ─────
  async absent(id: number, dto: GateActionDto) {
    const { after } = await this.prisma.$transaction((tx) => this.move(tx, id, ['SKIPPED'], { status: 'ABSENT', bayId: null }, 'ABSENT', dto), TX_OPTS);
    return { ticket: after };
  }

  // ───── restore: ABSENT -> SHELVED (reason required) ─────
  async restore(id: number, dto: GateActionDto) {
    if (!dto.reason) throw new AppError('REASON_REQUIRED', 'A reason is required to restore an absent ticket');
    return { ticket: await this.shelve(id, ['ABSENT'], 'RESTORED', dto) };
  }

  // ───────────────────────── helpers ─────────────────────────
  private async shelve(id: number, from: TicketStatus[], action: string, dto: GateActionDto) {
    return this.prisma.$transaction(async (tx) => {
      const pre = await tx.ticket.findUniqueOrThrow({ where: { id }, select: { queueDayId: true } });
      await lockDay(tx, pre.queueDayId);
      const last = await tx.ticket.aggregate({ where: { queueDayId: pre.queueDayId, priorityGroup: 2 }, _max: { position: true } });
      const { after } = await this.move(tx, id, from, { status: 'SHELVED', priorityGroup: 2, position: (last._max.position ?? 0) + 1, bayId: null }, action, dto);
      return after;
    }, TX_OPTS);
  }

  /** Guarded state change: checks the current status and the version, so a double click can never apply twice. */
  private async move(tx: Tx, id: number, from: TicketStatus[], data: Prisma.TicketUncheckedUpdateManyInput, action: string, dto: { actor?: string; reason?: string }) {
    const before = await tx.ticket.findUniqueOrThrow({ where: { id } });
    if (!from.includes(before.status))
      throw new AppError('INVALID_TRANSITION', `Ticket is ${before.status}; this action needs ${from.join(' or ')}`, HttpStatus.CONFLICT, { status: before.status });
    const r = await tx.ticket.updateMany({ where: { id, status: before.status, version: before.version }, data: { ...data, version: { increment: 1 } } });
    if (r.count === 0) throw new AppError('VERSION_CONFLICT', 'The ticket was changed by someone else. Reload and try again', HttpStatus.CONFLICT);
    const after = await tx.ticket.findUniqueOrThrow({ where: { id }, include: TICKET_INCLUDE });
    await this.audit.log(tx, { action, entity: 'Ticket', entityId: id, actor: dto.actor, reason: dto.reason, before: { status: before.status }, after: { status: after.status } });
    return { before, after };
  }

  /** Explicit bay, or the first free active bay of the lane. No bays defined => no bay (null). */
  private async pickBay(tx: Tx, lane: 'DOMESTIC' | 'INDUSTRIAL', bayId?: number) {
    const busy = async (id: number) => (await tx.ticket.count({ where: { bayId: id, status: { in: ['CALLED', 'LOADING'] } } })) > 0;

    if (bayId) {
      const bay = await tx.bayDef.findUniqueOrThrow({ where: { id: bayId } });
      if (bay.lane !== lane || !bay.isActive) throw new AppError('BAY_INVALID', 'Bay is inactive or belongs to another lane');
      if (await busy(bay.id)) throw new AppError('BAY_BUSY', `Bay ${bay.name} is busy`, HttpStatus.CONFLICT);
      return bay;
    }
    const bays = await tx.bayDef.findMany({ where: { lane, isActive: true }, orderBy: { id: 'asc' } });
    if (!bays.length) return null;
    for (const b of bays) if (!(await busy(b.id))) return b;
    throw new AppError('BAY_BUSY', 'All bays are busy', HttpStatus.CONFLICT);
  }

  private async autoCall(dayId: number, bayId: number | null) {
    if (!(await this.settings.bool('auto_call_next'))) return null;
    try {
      return await this.callNext({ dayId, bayId: bayId ?? undefined });
    } catch {
      return null; // paused line, busy bay, ... -> the operator will call manually
    }
  }
}
