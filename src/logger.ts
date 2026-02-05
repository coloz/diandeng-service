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
   * 认证相关日志
   */
  auth(message: string, ...args: unknown[]): void {
    if (this.level >= LogLevel.DEBUG) {
      console.log(`[AUTH] ${message}`, ...args);
    }
  }

  /**
   * 发布相关日志
   */
  publish(message: string, ...args: unknown[]): void {
    if (this.level >= LogLevel.DEBUG) {
      console.log(`[PUBLISH] ${message}`, ...args);
    }
  }

  /**
   * 订阅相关日志
   */
  subscribe(message: string, ...args: unknown[]): void {
    if (this.level >= LogLevel.DEBUG) {
      console.log(`[SUBSCRIBE] ${message}`, ...args);
    }
  }

  /**
   * 连接相关日志
   */
  connect(message: string, ...args: unknown[]): void {
    if (this.level >= LogLevel.DEBUG) {
      console.log(`[CONNECT] ${message}`, ...args);
    }
  }

  /**
   * 断开连接日志
   */
  disconnect(message: string, ...args: unknown[]): void {
    if (this.level >= LogLevel.DEBUG) {
      console.log(`[DISCONNECT] ${message}`, ...args);
    }
  }

  /**
   * 转发相关日志
   */
  forward(message: string, ...args: unknown[]): void {
    if (this.level >= LogLevel.DEBUG) {
      console.log(`[FORWARD] ${message}`, ...args);
    }
  }

  /**
   * 组消息日志
   */
  group(message: string, ...args: unknown[]): void {
    if (this.level >= LogLevel.DEBUG) {
      console.log(`[GROUP] ${message}`, ...args);
    }
  }

  /**
   * 消息日志
   */
  message(message: string, ...args: unknown[]): void {
    if (this.level >= LogLevel.DEBUG) {
      console.log(`[MESSAGE] ${message}`, ...args);
    }
  }

  /**
   * HTTP 相关日志
   */
  http(message: string, ...args: unknown[]): void {
    if (this.level >= LogLevel.DEBUG) {
      console.log(`[HTTP] ${message}`, ...args);
    }
  }

  /**
   * 定时任务调度器日志
   */
  scheduler(message: string, ...args: unknown[]): void {
    if (this.level >= LogLevel.DEBUG) {
      console.log(`[SCHEDULER] ${message}`, ...args);
    }
  }
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
