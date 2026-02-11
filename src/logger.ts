/**
 * 日志模块
 * 支持可配置的日志级别，生产环境默认关闭 debug 日志
 */

export enum LogLevel {
  NONE = 0,
  ERROR = 1,
  WARN = 2,
  INFO = 3,
  DEBUG = 4
}

class Logger {
  private level: LogLevel = LogLevel.ERROR; // 默认只输出错误日志

  /**
   * 设置日志级别
   */
  setLevel(level: LogLevel): void {
    this.level = level;
  }

  /**
   * 获取当前日志级别
   */
  getLevel(): LogLevel {
    return this.level;
  }

  /**
   * 启用详细日志（debug 模式）
   */
  enableVerbose(): void {
    this.level = LogLevel.DEBUG;
  }

  /**
   * 禁用所有日志
   */
  disable(): void {
    this.level = LogLevel.NONE;
  }

  /**
   * 检查日志级别是否为 verbose
   */
  isVerbose(): boolean {
    return this.level >= LogLevel.DEBUG;
  }

  /**
   * 错误日志
   */
  error(message: string, ...args: unknown[]): void {
    if (this.level >= LogLevel.ERROR) {
      console.error(`[ERROR] ${message}`, ...args);
    }
  }

  /**
   * 警告日志
   */
  warn(message: string, ...args: unknown[]): void {
    if (this.level >= LogLevel.WARN) {
      console.warn(`[WARN] ${message}`, ...args);
    }
  }

  /**
   * 信息日志
   */
  info(message: string, ...args: unknown[]): void {
    if (this.level >= LogLevel.INFO) {
      console.log(`[INFO] ${message}`, ...args);
    }
  }

  /**
   * 调试日志
   */
  debug(message: string, ...args: unknown[]): void {
    if (this.level >= LogLevel.DEBUG) {
      console.log(`[DEBUG] ${message}`, ...args);
    }
  }

  /**
   * 创建带标签的 DEBUG 级别日志方法
   */
  private createTaggedLogger(tag: string): (message: string, ...args: unknown[]) => void {
    return (message: string, ...args: unknown[]) => {
      if (this.level >= LogLevel.DEBUG) {
        console.log(`[${tag}] ${message}`, ...args);
      }
    };
  }

  // 各模块带标签的 DEBUG 日志方法
  auth = this.createTaggedLogger('AUTH');
  publish = this.createTaggedLogger('PUBLISH');
  subscribe = this.createTaggedLogger('SUBSCRIBE');
  connect = this.createTaggedLogger('CONNECT');
  disconnect = this.createTaggedLogger('DISCONNECT');
  forward = this.createTaggedLogger('FORWARD');
  group = this.createTaggedLogger('GROUP');
  message = this.createTaggedLogger('MESSAGE');
  http = this.createTaggedLogger('HTTP');
  scheduler = this.createTaggedLogger('SCHEDULER');
  bridge = this.createTaggedLogger('BRIDGE');
}

// 导出单例
export const logger = new Logger();

// 检查环境变量，支持通过环境变量开启日志
if (process.env.LOG_LEVEL) {
  const levelMap: Record<string, LogLevel> = {
    'none': LogLevel.NONE,
    'error': LogLevel.ERROR,
    'warn': LogLevel.WARN,
    'info': LogLevel.INFO,
    'debug': LogLevel.DEBUG,
    'verbose': LogLevel.DEBUG
  };
  const level = levelMap[process.env.LOG_LEVEL.toLowerCase()];
  if (level !== undefined) {
    logger.setLevel(level);
  }
}
