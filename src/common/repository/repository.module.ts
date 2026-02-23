import { Global, Module } from '@nestjs/common';
import { PrismaModule } from 'src/prisma/prisma.module';
import { TransactionRepository } from './transaction/transaction.repository';

@Global()
@Module({
  imports: [PrismaModule],
  providers: [TransactionRepository],
  exports: [TransactionRepository],
})
export class RepositoryModule {}
