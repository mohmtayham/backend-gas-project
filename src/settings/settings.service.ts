import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AppError } from '../common/app-error';
import { Tx } from '../common/utils';

export const DEFAULT_SETTINGS: Record<string, string> = {
  booking_window_minutes: '60', // default length of a booking window
  one_active_ticket_per_vehicle: 'true',
  late_unserved_policy: 'CARRY_TO_FRONT', // CARRY_TO_FRONT | CANCEL  (shelved & unserved at close)
  absent_all_day_policy: 'CANCEL', // CANCEL | CARRY_TO_FRONT       (skipped/absent at close)
  max_carry_days: '2',
  auto_call_next: 'true',
  manifest_chunk_size: '40',
};

const POLICY_KEYS = ['late_unserved_policy', 'absent_all_day_policy'];

@Injectable()
export class SettingsService {
  constructor(private prisma: PrismaService, private audit: AuditService) {}

  async all(): Promise<Record<string, string>> {
    const rows = await this.prisma.setting.findMany();
    return { ...DEFAULT_SETTINGS, ...Object.fromEntries(rows.map((r) => [r.key, r.value])) };
  }

  async get(key: string, tx?: Tx): Promise<string> {
    const row = await (tx ?? this.prisma).setting.findUnique({ where: { key } });
    return row?.value ?? DEFAULT_SETTINGS[key];
  }
  async bool(key: string, tx?: Tx) {
    return (await this.get(key, tx)) === 'true';
  }
  async int(key: string, tx?: Tx) {
    return parseInt(await this.get(key, tx), 10);
  }

  async update(values: Record<string, unknown>) {
    for (const [key, raw] of Object.entries(values)) {
      if (!(key in DEFAULT_SETTINGS)) throw new AppError('UNKNOWN_SETTING', `Unknown setting: ${key}`);
      const value = String(raw);
      if (POLICY_KEYS.includes(key) && !['CARRY_TO_FRONT', 'CANCEL'].includes(value))
        throw new AppError('INVALID_SETTING', `${key} must be CARRY_TO_FRONT or CANCEL`);
    }
    await this.prisma.$transaction(async (tx) => {
      for (const [key, raw] of Object.entries(values)) {
        const value = String(raw);
        await tx.setting.upsert({ where: { key }, create: { key, value }, update: { value, changedAt: new Date() } });
        await this.audit.log(tx, { action: 'SETTING_CHANGED', entity: 'Setting', entityId: key, after: { value } });
      }
    });
    return this.all();
  }
}
