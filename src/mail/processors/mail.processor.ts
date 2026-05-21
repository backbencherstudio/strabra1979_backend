import { MailerService } from '@nestjs-modules/mailer';
import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';

@Processor('mail-queue')
export class MailProcessor extends WorkerHost {
  private readonly logger = new Logger(MailProcessor.name);
  constructor(private mailerService: MailerService) {
    super();
  }

  @OnWorkerEvent('active')
  onActive(job: Job) {
    console.log(
      `Processing job ${job.id} of type ${job.name} with data ${job.data}...`,
    );
  }

  @OnWorkerEvent('completed')
  onCompleted(job: Job, result: any) {
    this.logger.log(`Job ${job.id} with name ${job.name} completed`);
  }

  async process(job: Job): Promise<any> {
    this.logger.log(`Processing job ${job.id} with name ${job.name}`);
    try {
      switch (job.name) {
        case 'sendMemberInvitation':
          this.logger.log('Sending member invitation email');
          await this.mailerService.sendMail({
            to: job.data.to,
            from: job.data.from,
            subject: job.data.subject,
            template: job.data.template,
            context: job.data.context,
          });
          break;
        case 'sendOtpCodeToEmail':
          this.logger.log('Sending OTP code to email');
          await this.mailerService.sendMail({
            to: job.data.to,
            from: job.data.from,
            subject: job.data.subject,
            template: job.data.template,
            context: job.data.context,
          });
          break;
        case 'sendVerificationLink':
          this.logger.log('Sending verification link');
          await this.mailerService.sendMail({
            to: job.data.to,
            subject: job.data.subject,
            template: job.data.template,
            context: job.data.context,
          });
          break;

        case 'sendDashboardInvitation':
          this.logger.log(
            `Sending dashboard invitation email to ${job.data.to}`,
          );
          this.logger.log(`Template: ${job.data.template}`);
          this.logger.log(
            `Full context:`,
            JSON.stringify(job.data.context, null, 2),
          );

          try {
            const result = await this.mailerService.sendMail({
              to: job.data.to,
              subject: job.data.subject,
              template: job.data.template,
              context: job.data.context,
            });
            this.logger.log(
              `Email sent successfully. MessageId: ${result.messageId}`,
            );
          } catch (error: any) {
            this.logger.error(`Failed to send email: ${error.message}`);
            this.logger.error(`Error stack: ${error.stack}`);
            this.logger.error(`Error code: ${error.code}`);
            this.logger.error(`Response: ${error.response}`);

            // Log the template content for debugging
            const fs = require('fs');
            const templatePath = 'src/mail/templates/dashboard-invite.ejs';
            const templateContent = fs.readFileSync(templatePath, 'utf8');
            this.logger.error(
              `Template content: ${templateContent.substring(0, 500)}...`,
            );

            throw error;
          }
          break;

        case 'sendWelcomeUser':
        case 'sendWelcomeAdminCreated':
          this.logger.log('Sending user notification email');
          await this.mailerService.sendMail({
            to: job.data.to,
            subject: job.data.subject,
            template: job.data.template,
            context: job.data.context,
          });
          break;
        case 'sendDashboardAssigned':
        case 'sendDashboardUnassigned':
          await this.mailerService.sendMail({
            to: job.data.to,
            subject: job.data.subject,
            template: job.data.template,
            context: job.data.context,
          });
          break;

        case 'sendInspectionAssigned':
          await this.mailerService.sendMail({
            to: job.data.to,
            subject: job.data.subject,
            template: job.data.template,
            context: job.data.context,
          });
          break;

        case 'sendAccountActivated':
          this.logger.log('Sending account activated email');
          await this.mailerService.sendMail({
            to: job.data.to,
            subject: job.data.subject,
            template: job.data.template,
            context: job.data.context,
          });
          break;

        case 'sendAccountDeactivated':
          this.logger.log('Sending account deactivated email');
          await this.mailerService.sendMail({
            to: job.data.to,
            subject: job.data.subject,
            template: job.data.template,
            context: job.data.context,
          });
          break;

        case 'sendAccountDeleted':
          this.logger.log('Sending account deleted email');
          await this.mailerService.sendMail({
            to: job.data.to,
            subject: job.data.subject,
            template: job.data.template,
            context: job.data.context,
          });
          break;
        case 'sendAccessRevoked':
          this.logger.log(`Sending access revoked email to ${job.data.to}`);
          await this.mailerService.sendMail({
            to: job.data.to,
            subject: job.data.subject,
            template: job.data.template,
            context: job.data.context,
          });
          break;
        default:
          this.logger.log('Unknown job name');
          return;
      }
    } catch (error) {
      this.logger.error(
        `Error processing job ${job.id} with name ${job.name}`,
        error,
      );
      throw error;
    }
  }
}
