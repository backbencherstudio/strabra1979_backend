import { ExecutionContext, Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Observable } from 'rxjs';

@Injectable()
export class OptionalJwtGuard extends AuthGuard('jwt') {
  canActivate(
    context: ExecutionContext,
  ): boolean | Promise<boolean> | Observable<boolean> {
    return new Promise((resolve) => {
      Promise.resolve(super.canActivate(context))
        .then(() => resolve(true))
        .catch(() => {
          const request = context.switchToHttp().getRequest();
          request.user = null;
          resolve(true);
        });
    });
  }

  handleRequest(err: any, user: any) {
    return user || null;
  }
}