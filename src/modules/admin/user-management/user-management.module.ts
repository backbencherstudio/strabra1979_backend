import { Module } from '@nestjs/common';
import { UserManagementController } from './user-management.controller';
import { UserManagementService } from './user-management.service';
import { PrismaService } from 'src/prisma/prisma.service';

@Module({
  controllers: [UserManagementController],
  providers: [UserManagementService, PrismaService],
  exports: [UserManagementService],
})
export class UserManagementModule {}