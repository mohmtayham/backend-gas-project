import { HttpStatus, Injectable } from '@nestjs/common';
import { ActorRole, Lane, Prisma, TicketStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import { AuditService } from '../audit/audit.service';
import { QuotasService } from '../quotas/quotas.service';
import { AppError } from '../common/app-error';
import { ACTIVE_STATUSES, groupByAgent, isWindowOpen, lockDay, Tx, TX_OPTS } from '../common/utils';
import { TICKET_INCLUDE } from '../common/ticket-include';
import { BookingLineDto, CancelBookingDto, CreateBookingDto, UpdateBookingDto } from './dto/booking.dto';

@Injectable()
export class BookingsService {
  constructor(
    private prisma: PrismaService,
    private settings: SettingsService,
    private audit: AuditService,
    private quotas: QuotasService,
  ) {}

  // ───────────────────────── create ─────────────────────────
  async create(dto: CreateBookingDto) {
    const role = dto.bookedByRole ?? 'STAFF';
    const actorName = dto.actorId ?? role.toLowerCase();

    return this.prisma.$transaction(async (tx) => {
      // 1) find the open window, then serialise everything on this day+lane
      const candidate = await tx.queueDay.findFirst({ where: { lane: dto.lane, status: 'BOOKING_OPEN' }, orderBy: { opDate: 'desc' } });
      if (!candidate) throw this.windowClosed(dto.lane);
      await lockDay(tx, candidate.id);
      const day = await tx.queueDay.findUniqueOrThrow({ where: { id: candidate.id } }); // re-read after the lock
      if (!isWindowOpen(day)) throw this.windowClosed(dto.lane);

      // 2) vehicle / transporter / capacity / type
      const vehicle = await this.loadVehicle(tx, dto.vehicleId, dto.transporterId);
      this.assertVehicleAllows(vehicle, dto.lane, dto.lines);

      // 3) one active ticket per vehicle per day
      if (await this.settings.bool('one_active_ticket_per_vehicle', tx)) {
        const busy = await tx.ticket.count({ where: { vehicleId: vehicle.id, queueDayId: day.id, status: { in: ACTIVE_STATUSES } } });
        if (busy) throw new AppError('VEHICLE_HAS_ACTIVE_TICKET', 'This vehicle already has an active ticket for this day', HttpStatus.CONFLICT);
      }

      // 4) who may book for whom + quota
      await this.checkParties(tx, role, dto.actorId, dto.transporterId, dto.lines);
      for (const [agentId, qty] of groupByAgent(dto.lines))
        await this.quotas.assertAvailable(tx, agentId, dto.lane, day.opDate, qty);

      // 5) server assigns booking number + queue position
      const lastPos = await tx.ticket.aggregate({ where: { queueDayId: day.id, priorityGroup: 1 }, _max: { position: true } });
      const lastNo = await tx.ticket.aggregate({ where: { originDayId: day.id }, _max: { bookingNo: true } });

      const ticket = await tx.ticket.create({
        data: {
          bookingNo: (lastNo._max.bookingNo ?? 0) + 1,
          originDayId: day.id, queueDayId: day.id, lane: dto.lane,
          priorityGroup: 1, position: (lastPos._max.position ?? 0) + 1, status: 'BOOKED',
          transporterId: dto.transporterId, vehicleId: vehicle.id,
          totalQty: dto.lines.reduce((s, l) => s + l.qty, 0),
          bookedByRole: role, actorId: dto.actorId,
          source: dto.source ?? (role === 'STAFF' ? 'STAFF' : 'MEMBER_APP'),
          sourceMessageAt: dto.messageAt ? new Date(dto.messageAt) : null,
          note: dto.note, createdBy: actorName,
          lines: { create: dto.lines.map((l) => ({ agentId: l.agentId, qtyBooked: l.qty })) },
        },
        include: { lines: true },
      });

      // 6) reserve quota + audit
      for (const line of ticket.lines) await this.quotas.reserve(tx, line, dto.lane, day.opDate, actorName);
      await this.audit.log(tx, { action: 'BOOKING_ADDED', entity: 'Ticket', entityId: ticket.id, actor: actorName, after: ticket });

      return tx.ticket.findUniqueOrThrow({ where: { id: ticket.id }, include: TICKET_INCLUDE });
    }, TX_OPTS);
  }

  // ───────────────────────── update ─────────────────────────
  async update(id: number, dto: UpdateBookingDto) {
    const role = dto.actorRole ?? 'STAFF';
    const actorName = dto.actorId ?? role.toLowerCase();

    return this.prisma.$transaction(async (tx) => {
      const pre = await tx.ticket.findUniqueOrThrow({ where: { id }, select: { queueDayId: true } });
      await lockDay(tx, pre.queueDayId);
      const t = await tx.ticket.findUniqueOrThrow({ where: { id }, include: { lines: true, queueDay: true } });

      this.assertOwner(t, role, dto.actorId);
      if (t.status !== 'BOOKED') throw new AppError('TICKET_NOT_EDITABLE', `Ticket is ${t.status}; only BOOKED tickets can be edited`, HttpStatus.CONFLICT);
      const open = isWindowOpen(t.queueDay);
      if (role !== 'STAFF' && !open) throw this.windowClosed(t.lane);
      if (role === 'STAFF' && !open && !dto.reason) throw new AppError('REASON_REQUIRED', 'Staff edits after the window closed need a reason');

      const vehicleId = dto.vehicleId ?? t.vehicleId;
      const newLines: BookingLineDto[] = dto.lines ?? t.lines.map((l) => ({ agentId: l.agentId, qty: l.qtyBooked }));

      const vehicle = await this.loadVehicle(tx, vehicleId, t.transporterId);
      this.assertVehicleAllows(vehicle, t.lane, newLines);
      if (vehicleId !== t.vehicleId && (await this.settings.bool('one_active_ticket_per_vehicle', tx))) {
        const busy = await tx.ticket.count({ where: { vehicleId, queueDayId: t.queueDayId, status: { in: ACTIVE_STATUSES } } });
        if (busy) throw new AppError('VEHICLE_HAS_ACTIVE_TICKET', 'This vehicle already has an active ticket for this day', HttpStatus.CONFLICT);
      }
      await this.checkParties(tx, role, dto.actorId, t.transporterId, newLines);

      if (dto.lines) {
        for (const l of t.lines) await this.quotas.release(tx, l.id, 'EDIT', actorName); // give old reservation back first
        for (const [agentId, qty] of groupByAgent(newLines))
          await this.quotas.assertAvailable(tx, agentId, t.lane, t.queueDay.opDate, qty);
        await tx.ticketLine.deleteMany({ where: { ticketId: id } });
        for (const l of newLines) {
          const line = await tx.ticketLine.create({ data: { ticketId: id, agentId: l.agentId, qtyBooked: l.qty } });
          await this.quotas.reserve(tx, line, t.lane, t.queueDay.opDate, actorName);
        }
      }

      const after = await tx.ticket.update({
        where: { id },
        data: {
          vehicleId, note: dto.note ?? t.note,
          totalQty: newLines.reduce((s, l) => s + l.qty, 0),
          version: { increment: 1 },
        },
        include: TICKET_INCLUDE,
      });
      await this.audit.log(tx, {
        action: 'BOOKING_UPDATED', entity: 'Ticket', entityId: id, actor: actorName, reason: dto.reason,
        before: { vehicleId: t.vehicleId, totalQty: t.totalQty, lines: t.lines }, after,
      });
      return after;
    }, TX_OPTS);
  }

  // ───────────────────────── cancel ─────────────────────────
  async cancel(id: number, dto: CancelBookingDto) {
    const role = dto.actorRole ?? 'STAFF';
    const actorName = dto.actorId ?? role.toLowerCase();

    return this.prisma.$transaction(async (tx) => {
      const pre = await tx.ticket.findUniqueOrThrow({ where: { id }, select: { queueDayId: true } });
      await lockDay(tx, pre.queueDayId);
      const t = await tx.ticket.findUniqueOrThrow({ where: { id }, include: { lines: true, queueDay: true } });

      this.assertOwner(t, role, dto.actorId);
      const staffAllowed: TicketStatus[] = ['BOOKED', 'SHELVED', 'SKIPPED', 'ABSENT'];
      if (role === 'STAFF') {
        if (!staffAllowed.includes(t.status)) throw new AppError('TICKET_NOT_EDITABLE', `Cannot cancel a ${t.status} ticket`, HttpStatus.CONFLICT);
        if (!dto.reason) throw new AppError('REASON_REQUIRED', 'A reason is required to cancel as staff');
      } else {
        if (t.status !== 'BOOKED') throw new AppError('TICKET_NOT_EDITABLE', `Only BOOKED tickets can be cancelled (this one is ${t.status})`, HttpStatus.CONFLICT);
        if (!isWindowOpen(t.queueDay)) throw this.windowClosed(t.lane);
      }

      for (const l of t.lines) await this.quotas.release(tx, l.id, 'CANCELLED', actorName);
      const after = await tx.ticket.update({
        where: { id },
        data: { status: 'CANCELLED', cancelReason: dto.reason ?? 'CANCELLED_BY_MEMBER', bayId: null, version: { increment: 1 } },
        include: TICKET_INCLUDE,
      });
      await this.audit.log(tx, { action: 'BOOKING_CANCELLED', entity: 'Ticket', entityId: id, actor: actorName, reason: dto.reason, before: { status: t.status }, after: { status: 'CANCELLED' } });
      return after;
    }, TX_OPTS);
  }

  // ───────────────────────── reads ─────────────────────────
  list(q: { dayId?: number; lane?: Lane; status?: TicketStatus; transporterId?: string; agentId?: string }) {
    return this.prisma.ticket.findMany({
      where: {
        queueDayId: q.dayId, lane: q.lane, status: q.status, transporterId: q.transporterId,
        ...(q.agentId ? { lines: { some: { agentId: q.agentId } } } : {}),
      },
      include: TICKET_INCLUDE,
      orderBy: [{ queueDayId: 'desc' }, { priorityGroup: 'asc' }, { position: 'asc' }],
      take: 500,
    });
  }

  /** "My bookings" without login: the client passes its role + id. */
  mine(role: ActorRole, actorId: string) {
    const where: Prisma.TicketWhereInput =
      role === 'AGENT' ? { lines: { some: { agentId: actorId } } } : role === 'TRANSPORTER' ? { transporterId: actorId } : {};
    return this.prisma.ticket.findMany({ where, include: TICKET_INCLUDE, orderBy: { createdAt: 'desc' }, take: 50 });
  }

  get(id: number) {
    return this.prisma.ticket.findUniqueOrThrow({ where: { id }, include: { ...TICKET_INCLUDE, queueDay: true } });
  }

  // ───────────────────────── rules ─────────────────────────
  private windowClosed(lane: Lane) {
    return new AppError('WINDOW_CLOSED', `Booking window for ${lane} is not open`, HttpStatus.CONFLICT);
  }

  private async loadVehicle(tx: Tx, vehicleId: string, transporterId: string) {
    const vehicle = await tx.vehicle.findUnique({ where: { id: vehicleId }, include: { transporter: true } });
    if (!vehicle) throw new AppError('VEHICLE_NOT_FOUND', 'Vehicle not found', HttpStatus.NOT_FOUND);
    if (vehicle.transporterId !== transporterId) throw new AppError('VEHICLE_NOT_OWNED', 'Vehicle does not belong to this transporter', HttpStatus.FORBIDDEN);
    if (!vehicle.isActive || !vehicle.transporter.isActive) throw new AppError('PARTY_INACTIVE', 'Vehicle or transporter is inactive', HttpStatus.CONFLICT);
    return vehicle;
  }

  private assertVehicleAllows(vehicle: { fillTypes: Lane[]; capacityQty: number }, lane: Lane, lines: BookingLineDto[]) {
    if (!vehicle.fillTypes.includes(lane))
      throw new AppError('TYPE_MISMATCH', `Vehicle is not allowed to load ${lane}`, HttpStatus.CONFLICT);
    const total = lines.reduce((s, l) => s + l.qty, 0);
    if (total > vehicle.capacityQty)
      throw new AppError('CAPACITY_EXCEEDED', `Total ${total} exceeds vehicle capacity ${vehicle.capacityQty}`, HttpStatus.CONFLICT, { capacity: vehicle.capacityQty, requested: total });
  }

  /** Who may book for whom (no login: the client declares its role, the server checks the ids). */
  private async checkParties(tx: Tx, role: ActorRole, actorId: string | undefined, transporterId: string, lines: BookingLineDto[]) {
    const agentIds = [...new Set(lines.map((l) => l.agentId))];
    const agents = await tx.agent.findMany({ where: { id: { in: agentIds } } });
    if (agents.length !== agentIds.length) throw new AppError('AGENT_NOT_FOUND', 'One or more agents do not exist', HttpStatus.NOT_FOUND);
    if (agents.some((a) => !a.isActive)) throw new AppError('PARTY_INACTIVE', 'One or more agents are inactive', HttpStatus.CONFLICT);

    if (role === 'AGENT') {
      if (!actorId || lines.some((l) => l.agentId !== actorId))
        throw new AppError('NOT_OWNER', 'An agent can only book his own quota', HttpStatus.FORBIDDEN);
    }
    if (role === 'TRANSPORTER') {
      if (actorId !== transporterId) throw new AppError('NOT_OWNER', 'A transporter can only book with his own trucks', HttpStatus.FORBIDDEN);
      const links = await tx.agentTransporterLink.findMany({ where: { transporterId, agentId: { in: agentIds }, status: 'APPROVED' } });
      const approved = new Set(links.map((l) => l.agentId));
      const missing = agentIds.filter((a) => !approved.has(a));
      if (missing.length) throw new AppError('LINK_NOT_APPROVED', 'Agent has not approved this transporter', HttpStatus.FORBIDDEN, { agentIds: missing });
    }
  }

  private assertOwner(t: { transporterId: string; lines: { agentId: string }[] }, role: ActorRole, actorId?: string) {
    if (role === 'STAFF') return;
    const ok =
      role === 'TRANSPORTER' ? actorId === t.transporterId : !!actorId && t.lines.length > 0 && t.lines.every((l) => l.agentId === actorId);
    if (!ok) throw new AppError('NOT_OWNER', 'This ticket does not belong to you', HttpStatus.FORBIDDEN);
  }
}
