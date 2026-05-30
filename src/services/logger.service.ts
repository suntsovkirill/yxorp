import { createLogger, format, transports } from 'winston';

export class LoggerService {
  private logger = createLogger({
    format: format.combine(
      format.colorize(),
      format.simple(),
    ),
    transports: [new transports.Console],
  });

  public info = this.logger.info.bind(this.logger);
  public error = this.logger.error.bind(this.logger);
  public warn = this.logger.warn.bind(this.logger);
  public debug = this.logger.debug.bind(this.logger);
}
