import { HttpException, HttpStatus } from '@nestjs/common';

/** Every business error looks like { code, message, details } so the apps can map `code` to Arabic. */
export class AppError extends HttpException {
  constructor(code: string, message: string, status: HttpStatus = HttpStatus.BAD_REQUEST, details?: unknown) {
    super({ code, message, details }, status);
  }
}
