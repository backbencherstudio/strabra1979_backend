import { MailerModule } from '@nestjs-modules/mailer';
import { Global, Module } from '@nestjs/common';
import { EjsAdapter } from '@nestjs-modules/mailer/dist/adapters/ejs.adapter';
import { MailService } from './mail.service';
import appConfig from '../config/app.config';
import { BullModule } from '@nestjs/bullmq';
import { MailProcessor } from './processors/mail.processor';

@Global()
@Module({
  imports: [
    MailerModule.forRootAsync({
      useFactory: () => ({
        transport: {
          host: appConfig().mail.host,
          port: +appConfig().mail.port,
          secure: false,
          auth: {
            user: appConfig().mail.user,
            pass: appConfig().mail.password,
          },
        },
        defaults: {
          from: appConfig().mail.from,
        },
        template: {
          dir: process.cwd() + '/dist/mail/templates/',
          adapter: new EjsAdapter(),
          options: {},
        },
      }),
    }),
    BullModule.registerQueue({
      name: 'mail-queue',
    }),
  ],
  providers: [MailService, MailProcessor],
  exports: [MailService],
})
export class MailModule {}
