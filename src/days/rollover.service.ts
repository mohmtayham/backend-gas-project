import { HttpStatus, Injectable } from '@nestjs/common';
import { QueueDay } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import { AuditService } from '../audit/audit.service';
import { QuotasService } from '../quotas/quotas.service';
import { ManifestsService } from '../manifests/manifests.service';
import { AppError } from '../common/app-error';
import { addDays, lockDay, Tx, TX_OPTS } from '../common/utils';
import { CloseDayDto } from './dto/day.dto';

interface PlanItem {
  ticketId: number;
  bookingNo: number;
  status: string;
  decision: 'CARRY' | 'CANCEL';
  reason?: string;
  newPosition?: number;
}

/**
 * End-of-day policy matrix:
 *  BOOKED (never reached)      -> carry to front
 *  SHELVED (late, unserved)    -> setting late_unserved_policy      (CARRY_TO_FRONT | CANCEL)
 *  SKIPPED/ABSENT (no show)    -> setting absent_all_day_policy     (CANCEL | CARRY_TO_FRONT)
 *  CALLED/LOADING              -> close blocked (or force with a reason)
 */
@Injectable()
export class RolloverService {
  constructor(
    private prisma: PrismaService,
    private settings: SettingsService,
    private audit: AuditService,
    private quotas: QuotasService,
    private manifests: ManifestsService,
  ) {}

  private async buildPlan(client: Tx, day: QueueDay, force: boolean) {
    const [latePolicy, absentPolicy, maxCarry] = await Promise.all([
      this.settings.get('late_unserved_policy', client),
      this.settings.get('absent_all_day_policy', client),
      this.settings.int('max_carry_days', client),
    ]);
    const tickets = await client.ticket.findMany({
      where: { queueDayId: day.id, status: { notIn: ['COMPLETED', 'CANCELLED'] } },
      orderBy: [{ priorityGroup: 'asc' }, { position: 'asc' }],
    });

    const blocked: number[] = [];
    const plan: PlanItem[] = [];
    let pos = 0;
    for (const t of tickets) {
      let decision: 'CARRY' | 'CANCEL';
      let reason: string | undefined;
      let faulted = true;

      if (t.status === 'BOOKED') { decision = 'CARRY'; faulted = false; }
      else if (t.status === 'SHELVED') { decision = latePolicy === 'CANCEL' ? 'CANCEL' : 'CARRY'; reason = 'LATE_UNSERVED'; }
      else if (t.status === 'SKIPPED' || t.status === 'ABSENT') { decision = absentPolicy === 'CARRY_TO_FRONT' ? 'CARRY' : 'CANCEL'; reason = 'ABSENT_ALL_DAY'; }
      else { // CALLED / LOADING
        blocked.push(t.id);
        decision = 'CARRY';
        faulted = false;
      }

      if (decision === 'CARRY' && faulted && t.carryCount >= maxCarry) { decision = 'CANCEL'; reason = 'MAX_CARRY'; }
      plan.push({ ticketId: t.id, bookingNo: t.bookingNo, status: t.status, decision, reason: decision === 'CANCEL' ? reason : undefined, newPosition: decision === 'CARRY' ? ++pos : undefined });
    }
    return { plan, blocked, tickets };
  }

  /** Dry run: what would happen if the day were closed now. */
  async preview(dayId: number) {
    const day = await this.prisma.queueDay.findUniqueOrThrow({ where: { id: dayId } });
    const { plan, blocked } = await this.buildPlan(this.prisma, day, false);
    return {
      dayId, lane: day.lane, opDate: day.opDate, nextOpDate: addDays(day.opDate, 1),
      canClose: blocked.length === 0 && day.status !== 'CLOSED',
      blockedTicketIds: blocked,
      summary: { carry: plan.filter((p) => p.decision === 'CARRY').length, cancel: plan.filter((p) => p.decision === 'CANCEL').length },
      plan,
    };
  }

  async close(dayId: number, dto: CloseDayDto) {
    const result = await this.prisma.$transaction(async (tx) => {
      await lockDay(tx, dayId);
      const day = await tx.queueDay.findUniqueOrThrow({ where: { id: dayId } });
      if (day.status === 'CLOSED') throw new AppError('DAY_ALREADY_CLOSED', 'This day is already closed', HttpStatus.CONFLICT);

      const { plan, blocked } = await this.buildPlan(tx, day, !!dto.force);
      if (blocked.length && !dto.force)
        throw new AppError('DAY_HAS_ACTIVE_TICKETS', 'Some tickets are still CALLED/LOADING. Finish them or close with force + reason', HttpStatus.CONFLICT, { ticketIds: blocked });
      if (blocked.length && !dto.reason) throw new AppError('REASON_REQUIRED', 'A reason is required to force-close');

      const nextOpDate = addDays(day.opDate, 1);
      const nextDay = await tx.queueDay.upsert({
        where: { opDate_lane: { opDate: nextOpDate, lane: day.lane } },
        create: { opDate: nextOpDate, lane: day.lane },
        update: {},
      });
      const hadManifest = (await tx.manifest.count({ where: { queueDayId: nextDay.id } })) > 0;

      // carried tickets go to group 0 (front), after any group-0 tickets already there
      const lastFront = await tx.ticket.aggregate({ where: { queueDayId: nextDay.id, priorityGroup: 0 }, _max: { position: true } });
      let pos = lastFront._max.position ?? 0;

      for (const item of plan) {
        if (item.decision === 'CARRY') {
          await tx.ticket.update({
            where: { id: item.ticketId },
            data: {
              queueDayId: nextDay.id, priorityGroup: 0, position: ++pos, status: 'BOOKED',
              carryCount: { increment: 1 }, bayId: null, calledAt: null, loadingStartedAt: null, version: { increment: 1 },
            },
          });
        } else {
          await tx.ticket.update({
            where: { id: item.ticketId },
            data: { status: 'CANCELLED', cancelReason: item.reason, bayId: null, version: { increment: 1 } },
          });
          const lines = await tx.ticketLine.findMany({ where: { ticketId: item.ticketId } });
          for (const l of lines) await this.quotas.release(tx, l.id, `CANCEL_${item.reason}`, dto.actor ?? 'system');
        }
      }

      await tx.queueDay.update({ where: { id: dayId }, data: { status: 'CLOSED', closedAt: new Date() } });
      await this.audit.log(tx, { action: 'DAY_CLOSED', entity: 'QueueDay', entityId: dayId, actor: dto.actor, reason: dto.reason, after: { nextDayId: nextDay.id, plan } });

      const carried = plan.filter((p) => p.decision === 'CARRY').length;
      return { dayId, nextDayId: nextDay.id, nextOpDate, carried, cancelled: plan.length - carried, plan, hadManifest };
    }, TX_OPTS);

    // the next day's manifest was provisional until this day closed -> publish a new version
    let manifest = null;
    if (result.hadManifest) manifest = await this.manifests.generate(result.nextDayId, dto.actor);
    const { hadManifest, ...out } = result;
    return { ...out, newManifest: manifest };
  }
}
