import { Module } from '@nestjs/common';
import { PropertyDashboardController } from './property-dashboard.controller';
import { PropertyDashboardService } from './property-dashboard.service';

@Module({
  controllers: [PropertyDashboardController],
  providers: [PropertyDashboardService],
  exports: [PropertyDashboardService],
})
export class PropertyDashboardModule {}
