import { Module } from '@nestjs/common';
import { ActivityLogController } from './activity.controller';
import { ActivityLogService } from './activity.service';

@Module({
  controllers: [ActivityLogController],
  providers: [ActivityLogService],
})
export class ActivityLogModule {}
