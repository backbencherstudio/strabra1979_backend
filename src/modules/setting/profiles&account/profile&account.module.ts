import { Module } from '@nestjs/common';
import { ProfileController } from './profile&account.controller';
import { ProfileService } from './profile&account.service';

@Module({
  controllers: [ProfileController],
  providers: [ProfileService],
})
export class ProfileSettingModule {}
