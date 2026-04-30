import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  SubscribeMessage,
  MessageBody,
  ConnectedSocket,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { JwtService } from '@nestjs/jwt';
import { Logger } from '@nestjs/common';
import appConfig from 'src/config/app.config';

@WebSocketGateway({
  // cors: { origin: appConfig().cors.origins },
  // cors: '*',
  // namespace: '/notifications', // ws://yourserver/notifications
  namespace: '/notifications',
  cors: {
    origin: true,
    credentials: true,
  },
})
export class NotificationGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(NotificationGateway.name);
  private userSockets = new Map<string, Set<string>>();

  constructor(private readonly jwtService: JwtService) {}

  afterInit() {
    this.logger.log('✅ Notification Gateway initialized');
  }

  async handleConnection(client: Socket) {
    try {
      const token =
        client.handshake?.auth?.token ||
        client.handshake?.headers?.authorization?.replace('Bearer ', '') ||
        (client.handshake?.query?.token as string);

      if (!token) {
        client.emit('error', { message: 'Unauthorized: No token provided' });
        client.disconnect();
        return;
      }

      const payload = this.jwtService.verify(token, {
        secret: process.env.JWT_SECRET,
      });

      const userId = payload.userId ?? payload.sub ?? payload.id;
      client.data.userId = userId;
      client.data.role = payload.role;

      if (!this.userSockets.has(userId)) {
        this.userSockets.set(userId, new Set());
      }
      this.userSockets.get(userId).add(client.id);

      // Personal room — user:clxyz001
      client.join(`user:${userId}`);

      // Role room — role:ADMIN | role:PROPERTY_MANAGER | etc.
      if (payload.role) {
        client.join(`role:${payload.role}`);
      }

      this.logger.log(
        `🟢 Connected: ${userId} [${payload.role}] (${client.id})`,
      );
    } catch {
      client.emit('error', { message: 'Unauthorized: Invalid token' });
      client.disconnect();
    }
  }

  handleDisconnect(client: Socket) {
    const userId = client.data?.userId;
    if (userId) {
      this.userSockets.get(userId)?.delete(client.id);
      if (this.userSockets.get(userId)?.size === 0) {
        this.userSockets.delete(userId);
      }
      this.logger.log(`🔴 Disconnected: ${userId} (${client.id})`);
    }
  }

  // Client marks a single notification as read
  @SubscribeMessage('notification:mark_read')
  handleMarkRead(
    @MessageBody() data: { notificationId: string },
    @ConnectedSocket() client: Socket,
  ) {
    // Service handles DB update — gateway just acknowledges
    client.emit('notification:marked_read', {
      notificationId: data.notificationId,
    });
  }

  // ─── Send to a single user ─────────────────────────────────────────────────
  sendToUser(userId: string, event: string, payload: any) {
    this.server.to(`user:${userId}`).emit(event, {
      ...payload,
      timestamp: new Date().toISOString(),
    });
  }

  // ─── Send to multiple users ────────────────────────────────────────────────
  sendToUsers(userIds: string[], event: string, payload: any) {
    for (const userId of userIds) {
      this.sendToUser(userId, event, payload);
    }
  }

  // ─── Send to all users of a role ──────────────────────────────────────────
  sendToRole(role: string, event: string, payload: any) {
    this.server.to(`role:${role}`).emit(event, {
      ...payload,
      timestamp: new Date().toISOString(),
    });
  }

  isOnline(userId: string): boolean {
    return (this.userSockets.get(userId)?.size ?? 0) > 0;
  }
}
