import { Module } from '@nestjs/common';
import { PropertyAccessController } from './property-access.controller';
import { PropertyAccessService } from './property-access.service';

@Module({
  controllers: [PropertyAccessController],
  providers: [PropertyAccessService],
  exports: [PropertyAccessService],
})
export class PropertyAccessModule {}
