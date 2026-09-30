import { Module } from '@nestjs/common';
import { PrismaModule } from './prisma/prisma.module';
import { AuditModule } from './audit/audit.module';
import { SettingsModule } from './settings/settings.module';
import { HealthModule } from './health/health.module';
import { AgentsModule } from './agents/agents.module';
import { TransportersModule } from './transporters/transporters.module';
import { VehiclesModule } from './vehicles/vehicles.module';
import { BaysModule } from './bays/bays.module';
import { LinksModule } from './links/links.module';
import { QuotasModule } from './quotas/quotas.module';
import { DaysModule } from './days/days.module';
import { BookingsModule } from './bookings/bookings.module';
import { QueueModule } from './queue/queue.module';
import { GateModule } from './gate/gate.module';
import { ManifestsModule } from './manifests/manifests.module';
import { ReportsModule } from './reports/reports.module';

@Module({
  imports: [
    PrismaModule, AuditModule, SettingsModule, HealthModule,
    AgentsModule, TransportersModule, VehiclesModule, BaysModule, LinksModule, QuotasModule,
    DaysModule, BookingsModule, QueueModule, GateModule, ManifestsModule, ReportsModule,
  ],
})
export class AppModule {}
