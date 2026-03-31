import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  BadRequestException,
} from '@nestjs/common';
import { Response } from 'express';

@Catch(HttpException)
export class CustomExceptionFilter implements ExceptionFilter {
  catch(exception: HttpException, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const status = exception.getStatus();

    const exceptionResponse = exception.getResponse() as any;

    let message = 'An error occurred';
    let errors: { field: string; message: string }[] = [];

    // Validation errors (class-validator)
    if (
      exception instanceof BadRequestException &&
      Array.isArray(exceptionResponse?.message)
    ) {
      message = 'Validation failed';

      errors = exceptionResponse.message.map((msg: string) => {
        const [field, ...rest] = msg.split(' ');
        return {
          field,
          message: rest.join(' '),
        };
      });
    } else {
      message =
        typeof exceptionResponse === 'string'
          ? exceptionResponse
          : (exceptionResponse.message ?? message);
    }

    // ✅ Console logging
    console.log('\n🚨 Exception Caught');
    console.log('Status:', status);
    console.log('Message:', message);

    if (errors.length) {
      console.log('Validation Errors:');
      console.table(errors); // 👈 this is what you want
    } else {
      console.log('Raw Exception Response:', exceptionResponse);
    }

    response.status(status).json({
      success: false,
      statusCode: status,
      message,
      errors: errors.length ? errors : undefined,
    });
  }
}