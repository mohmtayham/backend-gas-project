import { Module } from '@nestjs/common';
import { GateController } from './gate.controller';
import { GateService } from './gate.service';
import { DaysModule } from '../days/days.module';
import { QuotasModule } from '../quotas/quotas.module';

@Module({ imports: [DaysModule, QuotasModule], controllers: [GateController], providers: [GateService] })
export class GateModule {}
