import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { VehiclesService } from './vehicles.service';
import { CreateVehicleDto, UpdateVehicleDto } from './dto/vehicle.dto';

@Controller('vehicles')
export class VehiclesController {
  constructor(private vehicles: VehiclesService) {}

  @Get()
  list(@Query('transporterId') transporterId?: string, @Query('q') q?: string) {
    return this.vehicles.list(transporterId, q);
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.vehicles.get(id);
  }

  @Post()
  create(@Body() dto: CreateVehicleDto) {
    return this.vehicles.create(dto);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateVehicleDto) {
    return this.vehicles.update(id, dto);
  }
}
