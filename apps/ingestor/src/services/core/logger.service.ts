import type { FastifyBaseLogger } from 'fastify';

/**
 * Logger interface that abstracts away logging implementation details.
 * Supports both Fastify's structured logger and console fallback.
 */
export interface Logger {
  info(msg: string, data?: object): void;
  warn(msg: string, data?: object): void;
  error(msg: string, error?: Error | object): void;
  debug(msg: string, data?: object): void;
}

/**
 * Logger implementation that wraps Fastify's structured logger.
 * Provides consistent logging interface across the application.
 */
export class FastifyLogger implements Logger {
  constructor(private logger: FastifyBaseLogger) {}

  info(msg: string, data?: object): void {
    if (data) {
      this.logger.info(data, msg);
    } else {
      this.logger.info(msg);
    }
  }

  warn(msg: string, data?: object): void {
    if (data) {
      this.logger.warn(data, msg);
    } else {
      this.logger.warn(msg);
    }
  }

  error(msg: string, error?: Error | object): void {
    if (error) {
      this.logger.error({ err: error }, msg);
    } else {
      this.logger.error(msg);
    }
  }

  debug(msg: string, data?: object): void {
    if (data) {
      this.logger.debug(data, msg);
    } else {
      this.logger.debug(msg);
    }
  }
}

/**
 * Console-based logger fallback for use when Fastify logger is not available.
 * Used during application initialization or in standalone services.
 */
export class ConsoleLogger implements Logger {
  info(msg: string, data?: object): void {
    if (data) {
      console.log(`INFO: ${msg}`, data);
    } else {
      console.log(`INFO: ${msg}`);
    }
  }

  warn(msg: string, data?: object): void {
    if (data) {
      console.warn(`WARN: ${msg}`, data);
    } else {
      console.warn(`WARN: ${msg}`);
    }
  }

  error(msg: string, error?: Error | object): void {
    if (error) {
      console.error(`ERROR: ${msg}`, error);
    } else {
      console.error(`ERROR: ${msg}`);
    }
  }

  debug(msg: string, data?: object): void {
    if (data) {
      console.debug(`DEBUG: ${msg}`, data);
    } else {
      console.debug(`DEBUG: ${msg}`);
    }
  }
}

/**
 * Silent logger for testing or when logging should be disabled.
 */
export class SilentLogger implements Logger {
  info(_msg: string, _data?: object): void {}
  warn(_msg: string, _data?: object): void {}
  error(_msg: string, _error?: Error | object): void {}
  debug(_msg: string, _data?: object): void {}
}

/**
 * Global console logger instance for use during initialization.
 * Should be replaced with FastifyLogger once Fastify is initialized.
 */
export const consoleLogger = new ConsoleLogger();
