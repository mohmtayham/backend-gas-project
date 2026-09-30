import { Body, Controller, Get, Param, ParseIntPipe, Post, Query } from '@nestjs/common';
import { IsInt, IsOptional, IsString } from 'class-validator';
import { ManifestsService } from './manifests.service';
import { toInt } from '../common/utils';

class GenerateManifestDto {
  @IsInt() dayId: number;
  @IsOptional() @IsString() actor?: string;
}

@Controller('manifests')
export class ManifestsController {
  constructor(private manifests: ManifestsService) {}

  @Get()
  list(@Query('dayId') dayId?: string) {
    return this.manifests.list(toInt(dayId, 'dayId'));
  }

  @Get(':id')
  get(@Param('id', ParseIntPipe) id: number) {
    return this.manifests.get(id);
  }

  /** Ready-to-paste WhatsApp text, split into parts when long. */
  @Get(':id/whatsapp')
  whatsapp(@Param('id', ParseIntPipe) id: number) {
    return this.manifests.whatsapp(id);
  }

  /** Create a new manifest version from the current order of the day. */
  @Post('generate')
  generate(@Body() dto: GenerateManifestDto) {
    return this.manifests.generate(dto.dayId, dto.actor);
  }
}
