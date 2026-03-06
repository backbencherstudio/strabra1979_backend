import { Module } from '@nestjs/common';
import { DashboardTemplateController } from './templates.controller';
import { DashboardTemplateService } from './templates.service';

@Module({
  controllers: [DashboardTemplateController],
  providers: [DashboardTemplateService],
  exports: [DashboardTemplateService],
})
export class DashboardTemplateModule {}
