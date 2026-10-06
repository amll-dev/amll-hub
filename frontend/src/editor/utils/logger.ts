export type LogLevel = 'debug' | 'log' | 'info' | 'warn' | 'error';

export interface LoggerOptions {
  color?: string;
  textColor?: string;
  enabled?: boolean;
}

export class Logger {
  private source: string;
  private pillColor: string;
  private textColor: string;
  private enabled: boolean;

  constructor(source: string, options: LoggerOptions = {}) {
    this.source = source;
    this.textColor = options.textColor || '#000000';
    this.enabled = options.enabled ?? true;
    this.pillColor = options.color || this.generateColorFromString(source);
  }

  private getLogStyle(customBgColor?: string): [string, string] {
    const bg = customBgColor || this.pillColor;
    const pillCss = `
			background: ${bg};
			color: ${this.textColor};
			padding: 1px 2px;
			border-radius: 2px;
			font-size: 11px;
			font-weight: 600;
			line-height: 1.2;
			`
      .replace(/\s+/g, ' ')
      .trim();

    const resetCss = '';

    return [pillCss, resetCss];
  }

  /**
   * 根据字符串计算固定的 HSL 颜色以便同一个模块的颜色是相同的
   */
  private generateColorFromString(str: string): string {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      hash = str.charCodeAt(i) + ((hash << 5) - hash);
    }
    const h = Math.abs(hash) % 360;
    return `hsl(${h}, 90%, 90%)`;
  }

  private print(level: LogLevel, args: unknown[], customSource?: string) {
    if (!this.enabled) return;

    const sourceName = customSource || this.source;
    const pillColor = customSource ? this.generateColorFromString(customSource) : this.pillColor;
    const [pillStyle, resetStyle] = this.getLogStyle(pillColor);
    const prefix = `%c ${sourceName} %c`;

    const consoleMethod = console[level] || console.log;
    consoleMethod(prefix, pillStyle, resetStyle, ...args);
  }

  public debug(...args: unknown[]) {
    this.print('debug', args);
  }
  public log(...args: unknown[]) {
    this.print('log', args);
  }
  public info(...args: unknown[]) {
    this.print('info', args);
  }
  public warn(...args: unknown[]) {
    this.print('warn', args);
  }
  public error(...args: unknown[]) {
    this.print('error', args);
  }

  public static debug(source: string, ...args: unknown[]) {
    new Logger(source).debug(...args);
  }

  public static log(source: string, ...args: unknown[]) {
    new Logger(source).log(...args);
  }

  public static info(source: string, ...args: unknown[]) {
    new Logger(source).info(...args);
  }

  public static warn(source: string, ...args: unknown[]) {
    new Logger(source).warn(...args);
  }

  public static error(source: string, ...args: unknown[]) {
    new Logger(source).error(...args);
  }
}

export function createLogger(source: string, options?: LoggerOptions) {
  return new Logger(source, options);
}
