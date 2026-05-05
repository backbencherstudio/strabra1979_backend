import { Injectable } from '@nestjs/common';
import { Queue } from 'bullmq';
import { InjectQueue } from '@nestjs/bullmq';
import { MailerService } from '@nestjs-modules/mailer';
import appConfig from '../config/app.config';

@Injectable()
export class MailService {
  constructor(
    @InjectQueue('mail-queue') private queue: Queue,
    private mailerService: MailerService,
  ) {}

  async sendMemberInvitation({ user, member, url }) {
    try {
      const from = `${process.env.APP_NAME} <${appConfig().mail.from}>`;
      const subject = `${user.fname} is inviting you to ${appConfig().app.name}`;

      // add to queue
      await this.queue.add('sendMemberInvitation', {
        to: member.email,
        from: from,
        subject: subject,
        template: 'member-invitation',
        context: {
          user: user,
          member: member,
          url: url,
        },
      });
    } catch (error) {
      console.log(error);
    }
  }

  // send otp code for email verification
  async sendOtpCodeToEmail({ name, email, otp }) {
    try {
      const from = `${process.env.APP_NAME} <${appConfig().mail.from}>`;
      const subject = 'Email Verification';

      // add to queue
      await this.queue.add('sendOtpCodeToEmail', {
        to: email,
        from: from,
        subject: subject,
        template: 'email-verification',
        context: {
          name: name,
          otp: otp,
        },
      });
    } catch (error) {
      console.log(error);
    }
  }

  async sendVerificationLink(params: {
    email: string;
    name: string;
    token: string;
    type: string;
  }) {
    try {
      const verificationLink = `${appConfig().app.client_app_url}/verify-email?token=${params.token}&email=${params.email}&type=${params.type}`;

      // add to queue
      await this.queue.add('sendVerificationLink', {
        to: params.email,
        subject: 'Verify Your Email',
        template: './verification-link',
        context: {
          name: params.name,
          verificationLink,
        },
      });
    } catch (error) {
      console.log(error);
    }
  }

  async sendDashboardInvitation(params: {
    email: string;
    inviterName: string;
    propertyName: string;
    propertyAddress?: string;
    signupLink: string;
    platformName: string;
  }) {
    try {
      await this.queue.add('sendDashboardInvitation', {
        to: params.email,
        subject: `${params.inviterName} invited you to a property dashboard`,
        template: 'dashboard-invite',
        context: {
          inviterName: params.inviterName,
          propertyName: params.propertyName,
          propertyAddress: params.propertyAddress ?? null,
          signupLink: params.signupLink,
          platformName: params.platformName,
        },
      });
    } catch (error) {
      console.error('sendDashboardInvitation error:', error);
    }
  }

  async sendWelcomeUser(params: {
    email: string;
    username: string;
    role: string;
    loginUrl: string;
    requiresApproval: boolean;
    platformName: string;
  }) {
    await this.queue.add('sendWelcomeUser', {
      to: params.email,
      subject: `Welcome to ${params.platformName}`,
      template: 'welcome-user',
      context: { ...params },
    });
  }

  async sendWelcomeAdminCreated(params: {
    email: string;
    username: string;
    role: string;
    tempPassword: string;
    loginUrl: string;
    platformName: string;
  }) {
    await this.queue.add('sendWelcomeAdminCreated', {
      to: params.email,
      subject: `Your ${params.platformName} account is ready`,
      template: 'welcome-admin-created',
      context: { ...params },
    });
  }

  async sendAccountDeactivated(params: {
    email: string;
    username: string;
    platformName: string;
  }) {
    await this.queue.add('sendAccountDeactivated', {
      to: params.email,
      subject: `Your ${params.platformName} account has been deactivated`,
      template: 'account-deactivated',
      context: { ...params },
    });
  }

  async sendDashboardAssigned(params: {
    email: string;
    username: string;
    assignedBy: string;
    propertyName: string;
    propertyAddress?: string;
    dashboardUrl: string;
    platformName: string;
  }) {
    await this.queue.add('sendDashboardAssigned', {
      to: params.email,
      subject: `You've been assigned to ${params.propertyName}`,
      template: 'dashboard-assigned',
      context: { ...params },
    });
  }

  async sendDashboardUnassigned(params: {
    email: string;
    username: string;
    propertyName: string;
    propertyAddress?: string;
    platformName: string;
  }) {
    await this.queue.add('sendDashboardUnassigned', {
      to: params.email,
      subject: `Property assignment removed — ${params.propertyName}`,
      template: 'dashboard-unassigned',
      context: { ...params },
    });
  }

  async sendInspectionAssigned(params: {
    email: string;
    username: string;
    assignedBy: string;
    propertyName: string;
    propertyAddress?: string;
    scheduledAt: string;
    dashboardUrl: string;
    platformName: string;
  }) {
    try {
      await this.queue.add('sendInspectionAssigned', {
        to: params.email,
        subject: `New inspection assigned — ${params.propertyName}`,
        template: 'inspection-assigned',
        context: { ...params },
      });
    } catch (error) {
      console.error('sendInspectionAssigned error:', error);
    }
  }
}
