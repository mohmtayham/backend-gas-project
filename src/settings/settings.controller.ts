import { Body, Controller, Get, Patch } from '@nestjs/common';
import { SettingsService } from './settings.service';

@Controller('settings')
export class SettingsController {
  constructor(private settings: SettingsService) {}

  @Get()
  all() {
    return this.settings.all();
  }

  /** Body example: { "auto_call_next": false, "late_unserved_policy": "CANCEL" } */
  @Patch()
  update(@Body() body: Record<string, unknown>) {
    return this.settings.update(body);
  }
}
