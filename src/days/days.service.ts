import { HttpStatus, Injectable } from '@nestjs/common';
import { DayStatus, Lane } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import { AuditService } from '../audit/audit.service';
import { ManifestsService } from '../manifests/manifests.service';
import { AppError } from '../common/app-error';
import { dateOnly, lockDay, todayDate, TX_OPTS } from '../common/utils';
import { CloseDayDto, CreateDayDto, ExtendBookingDto, OpenBookingDto, PauseDto, ReopenDto } from './dto/day.dto';

@Injectable()
export class DaysService {
  constructor(
    private prisma: PrismaService,
    private settings: SettingsService,
    private audit: AuditService,
    private manifests: ManifestsService,
  ) {}

  list(q: { lane?: Lane; status?: DayStatus; from?: string; to?: string }) {
    return this.prisma.queueDay.findMany({
      where: {
        lane: q.lane,
        status: q.status,
        opDate: q.from || q.to ? { gte: q.from ? dateOnly(q.from) : undefined, lte: q.to ? dateOnly(q.to) : undefined } : undefined,
      },
      orderBy: [{ opDate: 'desc' }, { lane: 'asc' }],
    });
  }

  async get(id: number) {
    const day = await this.prisma.queueDay.findUniqueOrThrow({ where: { id } });
    const grouped = await this.prisma.ticket.groupBy({ by: ['status'], where: { queueDayId: id }, _count: true });
    return { ...day, counts: Object.fromEntries(grouped.map((g) => [g.status, g._count])) };
  }

  today(lane?: Lane) {
    return this.prisma.queueDay.findMany({ where: { opDate: todayDate(), lane }, orderBy: { lane: 'asc' } });
  }

  /** The day the gate works on: by id, or today's day of a lane. */
  async resolveOperatingDay(lane?: Lane, dayId?: number) {
    if (dayId) return this.prisma.queueDay.findUniqueOrThrow({ where: { id: dayId } });
    if (!lane) throw new AppError('LANE_REQUIRED', 'Provide lane or dayId');
    const day = await this.prisma.queueDay.findUnique({ where: { opDate_lane: { opDate: todayDate(), lane } } });
    if (!day) throw new AppError('DAY_NOT_FOUND', `No queue day for today (${lane}). Create it with POST /days`, HttpStatus.NOT_FOUND);
    return day;
  }

  /** Create the day if it does not exist yet (idempotent). */
  ensure(dto: CreateDayDto) {
    const opDate = dateOnly(dto.opDate);
    return this.prisma.queueDay.upsert({
      where: { opDate_lane: { opDate, lane: dto.lane } },
      create: { opDate, lane: dto.lane },
      update: {},
    });
  }

  private assertStatus(status: DayStatus, allowed: DayStatus[], action: string) {
    if (!allowed.includes(status))
      throw new AppError('INVALID_DAY_STATE', `Cannot ${action} while the day is ${status}`, HttpStatus.CONFLICT, { status, allowed });
  }

  // ───── booking window ─────
  async openBooking(id: number, dto: OpenBookingDto) {
    const day = await this.prisma.queueDay.findUniqueOrThrow({ where: { id } });
    this.assertStatus(day.status, ['PLANNED'], 'open booking');
    const now = new Date();
    const minutes = dto.minutes ?? (await this.settings.int('booking_window_minutes'));
    const closesAt = dto.closesAt ? new Date(dto.closesAt) : new Date(now.getTime() + minutes * 60_000);
    return this.prisma.$transaction(async (tx) => {
      const after = await tx.queueDay.update({ where: { id }, data: { status: 'BOOKING_OPEN', bookingOpensAt: now, bookingClosesAt: closesAt } });
      await this.audit.log(tx, { action: 'WINDOW_OPENED', entity: 'QueueDay', entityId: id, actor: dto.actor, after: { closesAt } });
      return after;
    });
  }

  async extendBooking(id: number, dto: ExtendBookingDto) {
    const day = await this.prisma.queueDay.findUniqueOrThrow({ where: { id } });
    this.assertStatus(day.status, ['BOOKING_OPEN'], 'extend booking');
    const base = day.bookingClosesAt && day.bookingClosesAt > new Date() ? day.bookingClosesAt : new Date();
    const closesAt = new Date(base.getTime() + dto.minutes * 60_000);
    return this.prisma.$transaction(async (tx) => {
      const after = await tx.queueDay.update({ where: { id }, data: { bookingClosesAt: closesAt } });
      await this.audit.log(tx, { action: 'WINDOW_EXTENDED', entity: 'QueueDay', entityId: id, actor: dto.actor, before: { closesAt: day.bookingClosesAt }, after: { closesAt } });
      return after;
    });
  }

  /** Freeze the list and generate the manifest. */
  async closeBooking(id: number, actor?: string) {
    const day = await this.prisma.$transaction(async (tx) => {
      await lockDay(tx, id); // wait for in-flight bookings to finish
      const d = await tx.queueDay.findUniqueOrThrow({ where: { id } });
      this.assertStatus(d.status, ['BOOKING_OPEN'], 'close booking');
      const after = await tx.queueDay.update({ where: { id }, data: { status: 'BOOKING_CLOSED', bookingClosesAt: new Date() } });
      await this.audit.log(tx, { action: 'WINDOW_CLOSED', entity: 'QueueDay', entityId: id, actor });
      return after;
    }, TX_OPTS);
    const manifest = await this.manifests.generate(id, actor);
    return { day, manifest };
  }

  async reopen(id: number, dto: ReopenDto) {
    const minutes = dto.minutes ?? (await this.settings.int('booking_window_minutes'));
    return this.prisma.$transaction(async (tx) => {
      await lockDay(tx, id);
      const d = await tx.queueDay.findUniqueOrThrow({ where: { id } });
      this.assertStatus(d.status, ['BOOKING_CLOSED'], 'reopen booking');
      const after = await tx.queueDay.update({ where: { id }, data: { status: 'BOOKING_OPEN', bookingClosesAt: new Date(Date.now() + minutes * 60_000) } });
      await this.audit.log(tx, { action: 'WINDOW_REOPENED', entity: 'QueueDay', entityId: id, actor: dto.actor, reason: dto.reason });
      return after;
    }, TX_OPTS);
  }

  // ───── line pause (توقف الخط) ─────
  async pauseLine(id: number, dto: PauseDto) {
    const day = await this.prisma.queueDay.findUniqueOrThrow({ where: { id } });
    this.assertStatus(day.status, ['PLANNED', 'BOOKING_CLOSED', 'IN_PROGRESS', 'BOOKING_OPEN'], 'pause the line');
    return this.prisma.$transaction(async (tx) => {
      const after = await tx.queueDay.update({ where: { id }, data: { linePausedAt: new Date(), pauseReason: dto.reason } });
      await this.audit.log(tx, { action: 'LINE_PAUSED', entity: 'QueueDay', entityId: id, actor: dto.actor, reason: dto.reason });
      return after;
    });
  }

  async resumeLine(id: number, actor?: string) {
    return this.prisma.$transaction(async (tx) => {
      const after = await tx.queueDay.update({ where: { id }, data: { linePausedAt: null, pauseReason: null } });
      await this.audit.log(tx, { action: 'LINE_RESUMED', entity: 'QueueDay', entityId: id, actor });
      return after;
    });
  }
}
