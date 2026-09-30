import { Injectable } from '@nestjs/common';
import { createHash } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import { AuditService } from '../audit/audit.service';
import { TICKET_INCLUDE } from '../common/ticket-include';

const AR_DAYS = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
const AR_MONTHS = ['كانون الثاني', 'شباط', 'آذار', 'نيسان', 'أيار', 'حزيران', 'تموز', 'آب', 'أيلول', 'تشرين الأول', 'تشرين الثاني', 'كانون الأول'];
const LANE_AR = { DOMESTIC: 'منزلي', INDUSTRIAL: 'صناعي' };
const GROUP_HEADER = ['*مُرحّل من اليوم السابق*', '*حجوزات المساء*', '*متأخرون (شلف للآخر)*'];
const LINE = '━━━━━━━━━━━━━━━━━━';
const iso = (s: string | number) => `\u2066${s}\u2069`; // Unicode directional isolate (keeps plates/numbers intact in RTL)

@Injectable()
export class ManifestsService {
  constructor(private prisma: PrismaService, private settings: SettingsService, private audit: AuditService) {}

  list(dayId?: number) {
    return this.prisma.manifest.findMany({
      where: { queueDayId: dayId },
      select: { id: true, queueDayId: true, version: true, serial: true, generatedAt: true, contentHash: true, superseded: true },
      orderBy: { id: 'desc' },
    });
  }

  get(id: number) {
    return this.prisma.manifest.findUniqueOrThrow({ where: { id } });
  }

  /** Text split into WhatsApp-sized parts (default 40 lines per part). */
  async whatsapp(id: number) {
    const m = await this.get(id);
    const size = await this.settings.int('manifest_chunk_size');
    const lines = m.exportedText.split('\n');
    if (lines.length <= size) return { serial: m.serial, parts: [m.exportedText] };
    const n = Math.ceil(lines.length / size);
    const parts = Array.from({ length: n }, (_, i) => `الجزء ${i + 1}/${n}\n` + lines.slice(i * size, (i + 1) * size).join('\n'));
    return { serial: m.serial, parts };
  }

  /** Freeze the current order of the day as a new manifest version (older versions become superseded). */
  async generate(dayId: number, actor?: string) {
    const day = await this.prisma.queueDay.findUniqueOrThrow({ where: { id: dayId } });
    const tickets = await this.prisma.ticket.findMany({
      where: { queueDayId: dayId, status: { not: 'CANCELLED' } },
      orderBy: [{ priorityGroup: 'asc' }, { position: 'asc' }],
      include: TICKET_INCLUDE,
    });
    const last = await this.prisma.manifest.findFirst({ where: { queueDayId: dayId }, orderBy: { version: 'desc' } });
    const version = (last?.version ?? 0) + 1;

    const d = day.opDate;
    const ymd = d.toISOString().slice(0, 10).replace(/-/g, '');
    const serial = `G-${ymd}-${day.lane[0]}-v${version}`;

    const rows = tickets.map((t) => [t.priorityGroup, t.position, t.bookingNo, t.vehicle.plateNo, t.transporterId, t.lines.map((l) => [l.agentId, l.qtyBooked])]);
    const contentHash = createHash('sha256').update(JSON.stringify(rows)).digest('hex');
    const code = `${contentHash.slice(0, 4)}-${contentHash.slice(4, 8)}`.toUpperCase();

    const out: string[] = [
      `📋 *جدول الدور — ${LANE_AR[day.lane]}*`,
      `📅 ${AR_DAYS[d.getUTCDay()]} ${d.getUTCDate()} ${AR_MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`,
      `🔖 ${serial} · رمز التحقق ${code}`,
      LINE,
    ];
    let n = 0;
    let total = 0;
    let group = -1;
    for (const t of tickets) {
      if (t.priorityGroup !== group) {
        group = t.priorityGroup;
        out.push(GROUP_HEADER[group] ?? '');
      }
      n++;
      total += t.totalQty;
      const agents = t.lines.length === 1 ? t.lines[0].agent.name : t.lines.map((l) => `${l.agent.name} (${l.qtyBooked})`).join(' + ');
      const badge = t.carryCount > 0 ? ` (مُرحّل × ${t.carryCount} — كان دور ${t.bookingNo})` : t.priorityGroup === 2 ? ' (متأخر)' : '';
      out.push(`${n}) ${agents} — ${iso(t.vehicle.plateNo)} — ${t.transporter.name} — ${iso(t.totalQty)}${badge}`);
    }
    out.push(LINE, `المجموع: ${n} آلية — ${iso(total.toLocaleString('en-US'))} أسطوانة`);
    const exportedText = out.join('\n');

    return this.prisma.$transaction(async (tx) => {
      await tx.manifest.updateMany({ where: { queueDayId: dayId, superseded: false }, data: { superseded: true } });
      const m = await tx.manifest.create({ data: { queueDayId: dayId, version, serial, contentHash, exportedText } });
      await this.audit.log(tx, { action: 'MANIFEST_GENERATED', entity: 'Manifest', entityId: m.id, actor, after: { serial, tickets: n, total } });
      return m;
    });
  }
}
