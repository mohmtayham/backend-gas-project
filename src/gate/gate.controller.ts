import { Body, Controller, Param, ParseIntPipe, Post } from '@nestjs/common';
import { GateService } from './gate.service';
import { CallNextDto, GateActionDto, LoadedDto } from './dto/gate.dto';

@Controller('gate')
export class GateController {
  constructor(private gate: GateService) {}

  /** نداء الدور */
  @Post('call-next')
  callNext(@Body() dto: CallNextDto) {
    return this.gate.callNext(dto);
  }

  /** حاضر – بدء التعبئة */
  @Post(':id/start')
  start(@Param('id', ParseIntPipe) id: number, @Body() dto: GateActionDto) {
    return this.gate.start(id, dto);
  }

  /** تم التحميل */
  @Post(':id/loaded')
  loaded(@Param('id', ParseIntPipe) id: number, @Body() dto: LoadedDto) {
    return this.gate.loaded(id, dto);
  }

  /** لم يحضر – تجاوز */
  @Post(':id/skip')
  skip(@Param('id', ParseIntPipe) id: number, @Body() dto: GateActionDto) {
    return this.gate.skip(id, dto);
  }

  /** متأخر – شلف للآخر */
  @Post(':id/late')
  late(@Param('id', ParseIntPipe) id: number, @Body() dto: GateActionDto) {
    return this.gate.late(id, dto);
  }

  /** غائب */
  @Post(':id/absent')
  absent(@Param('id', ParseIntPipe) id: number, @Body() dto: GateActionDto) {
    return this.gate.absent(id, dto);
  }

  /** استعادة (reason required) */
  @Post(':id/restore')
  restore(@Param('id', ParseIntPipe) id: number, @Body() dto: GateActionDto) {
    return this.gate.restore(id, dto);
  }
}
