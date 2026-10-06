import { createLogger } from './logger';

const legacyLogger = createLogger('Legacy');

export function log(...messages: unknown[]) {
  legacyLogger.log(...messages);
}

export function warn(...messages: unknown[]) {
  legacyLogger.warn(...messages);
}

export function error(...messages: unknown[]) {
  legacyLogger.error(...messages);
}
