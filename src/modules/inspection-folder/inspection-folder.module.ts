import { Module } from '@nestjs/common';
import { InspectionFolderController } from './inspection-folder.controller';
import { InspectionFolderService } from './inspection-folder.service';

@Module({
  controllers: [InspectionFolderController],
  providers: [InspectionFolderService],
  exports: [InspectionFolderService],
})
export class InspectionFolderModule {}
