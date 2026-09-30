import { Module } from '@nestjs/common';
import { BaysController } from './bays.controller';
import { BaysService } from './bays.service';

@Module({ controllers: [BaysController], providers: [BaysService], exports: [BaysService] })
export class BaysModule {}
