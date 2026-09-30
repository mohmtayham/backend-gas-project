import { Module } from '@nestjs/common';
import { DaysController } from './days.controller';
import { DaysService } from './days.service';
import { RolloverService } from './rollover.service';
import { ManifestsModule } from '../manifests/manifests.module';
import { QuotasModule } from '../quotas/quotas.module';

@Module({
  imports: [ManifestsModule, QuotasModule],
  controllers: [DaysController],
  providers: [DaysService, RolloverService],
  exports: [DaysService],
})
export class DaysModule {}
