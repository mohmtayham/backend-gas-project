import { Module } from '@nestjs/common';
import { QueueController } from './queue.controller';
import { QueueService } from './queue.service';
import { DaysModule } from '../days/days.module';

@Module({ imports: [DaysModule], controllers: [QueueController], providers: [QueueService], exports: [QueueService] })
export class QueueModule {}
