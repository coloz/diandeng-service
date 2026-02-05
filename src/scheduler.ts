/**
 * 定时任务调度器
 * 支持定时执行、倒计时执行、循环执行任务
 */
import Aedes from 'aedes';
import crypto from 'crypto';
import { ScheduledTask, ScheduleMode, IDeviceCache, ForwardMessage } from './types';
import { logger } from './logger';
import { stringifyForwardMessage } from './serializer';

/**
 * 生成唯一任务ID
 */
function generateTaskId(): string {
  return crypto.randomBytes(8).toString('hex');
}

/**
 * 定时任务调度器类
 */
export class Scheduler {
  // 存储所有定时任务 taskId -> task
  private tasks: Map<string, ScheduledTask>;
  
  // 检查任务的定时器
  private checkTimer: NodeJS.Timeout | null;
  
  // Aedes 实例引用
  private aedes: Aedes | null;
  
  // 设备缓存引用
  private deviceCache: IDeviceCache | null;
  
  // 检查间隔（毫秒）
  private readonly checkInterval: number;
  
  // 系统 clientId，用于发送定时任务指令
  private readonly systemClientId = '__scheduler__';

  constructor(checkInterval: number = 1000) {
    this.tasks = new Map();
    this.checkTimer = null;
    this.aedes = null;
    this.deviceCache = null;
    this.checkInterval = checkInterval;
  }

  /**
   * 初始化调度器
   */
  init(aedes: Aedes, deviceCache: IDeviceCache): void {
    this.aedes = aedes;
    this.deviceCache = deviceCache;
    logger.scheduler('调度器已初始化');
  }

  /**
   * 启动调度器
   */
  start(): void {
    if (this.checkTimer) {
      return; // 已经在运行
    }

    this.checkTimer = setInterval(() => {
      this.checkAndExecuteTasks();
    }, this.checkInterval);

    logger.scheduler(`调度器已启动，检查间隔: ${this.checkInterval}ms`);
  }

  /**
   * 停止调度器
   */
  stop(): void {
    if (this.checkTimer) {
      clearInterval(this.checkTimer);
      this.checkTimer = null;
      logger.scheduler('调度器已停止');
    }
  }

  /**
   * 创建定时任务
   */
  createTask(
    deviceId: string,
    command: unknown,
    mode: ScheduleMode,
    options: {
      executeAt?: number;      // 定时执行的时间戳
      countdown?: number;      // 倒计时秒数
      interval?: number;       // 循环间隔秒数
    }
  ): ScheduledTask {
    const now = Date.now();
    let executeAt: number;
    let interval: number | undefined;

    switch (mode) {
      case 'scheduled':
        // 定时执行：使用指定的时间戳
        if (!options.executeAt) {
          throw new Error('scheduled 模式需要 executeAt 参数');
        }
        executeAt = options.executeAt;
        break;

      case 'countdown':
        // 倒计时执行：当前时间 + 倒计时秒数
        if (!options.countdown || options.countdown <= 0) {
          throw new Error('countdown 模式需要正数的 countdown 参数');
        }
        executeAt = now + options.countdown * 1000;
        break;

      case 'recurring':
        // 循环执行：需要间隔时间
        if (!options.interval || options.interval <= 0) {
          throw new Error('recurring 模式需要正数的 interval 参数');
        }
        // 首次执行时间：如果提供了 executeAt 则使用，否则使用当前时间 + 间隔
        executeAt = options.executeAt || (now + options.interval * 1000);
        interval = options.interval * 1000;
        break;

      default:
        throw new Error(`不支持的执行模式: ${mode}`);
    }

    const task: ScheduledTask = {
      id: generateTaskId(),
      deviceId,
      command,
      mode,
      executeAt,
      interval,
      createdAt: now,
      enabled: true
    };

    this.tasks.set(task.id, task);
    logger.scheduler(`创建任务: ${task.id}, 模式: ${mode}, 目标设备: ${deviceId}, 执行时间: ${new Date(executeAt).toISOString()}`);

    return task;
  }

  /**
   * 取消定时任务
   */
  cancelTask(taskId: string): boolean {
    const task = this.tasks.get(taskId);
    if (!task) {
      return false;
    }

    this.tasks.delete(taskId);
    logger.scheduler(`取消任务: ${taskId}`);
    return true;
  }

  /**
   * 修改定时任务
   */
  updateTask(
    taskId: string,
    updates: {
      command?: unknown;
      mode?: ScheduleMode;
      executeAt?: number;
      countdown?: number;
      interval?: number;
      enabled?: boolean;
    }
  ): ScheduledTask | null {
    const task = this.tasks.get(taskId);
    if (!task) {
      return null;
    }

    const now = Date.now();

    // 更新指令
    if (updates.command !== undefined) {
      task.command = updates.command;
    }

    // 更新启用状态
    if (updates.enabled !== undefined) {
      task.enabled = updates.enabled;
    }

    // 更新执行模式和时间
    if (updates.mode) {
      task.mode = updates.mode;

      switch (updates.mode) {
        case 'scheduled':
          if (updates.executeAt) {
            task.executeAt = updates.executeAt;
          }
          task.interval = undefined;
          break;

        case 'countdown':
          if (updates.countdown && updates.countdown > 0) {
            task.executeAt = now + updates.countdown * 1000;
          }
          task.interval = undefined;
          break;

        case 'recurring':
          if (updates.interval && updates.interval > 0) {
            task.interval = updates.interval * 1000;
            // 如果提供了新的执行时间则使用，否则保持原有
            if (updates.executeAt) {
              task.executeAt = updates.executeAt;
            }
          }
          break;
      }
    } else {
      // 不改变模式，但可以更新时间参数
      if (updates.executeAt) {
        task.executeAt = updates.executeAt;
      } else if (updates.countdown && updates.countdown > 0) {
        task.executeAt = now + updates.countdown * 1000;
      }

      if (updates.interval && updates.interval > 0 && task.mode === 'recurring') {
        task.interval = updates.interval * 1000;
      }
    }

    logger.scheduler(`更新任务: ${taskId}, 新执行时间: ${new Date(task.executeAt).toISOString()}`);
    return task;
  }

  /**
   * 获取任务
   */
  getTask(taskId: string): ScheduledTask | undefined {
    return this.tasks.get(taskId);
  }

  /**
   * 获取设备的所有任务
   */
  getTasksByDevice(deviceId: string): ScheduledTask[] {
    const result: ScheduledTask[] = [];
    for (const task of this.tasks.values()) {
      if (task.deviceId === deviceId) {
        result.push(task);
      }
    }
    return result;
  }

  /**
   * 获取所有任务
   */
  getAllTasks(): ScheduledTask[] {
    return Array.from(this.tasks.values());
  }

  /**
   * 检查并执行到期的任务
   */
  private checkAndExecuteTasks(): void {
    const now = Date.now();

    for (const [taskId, task] of this.tasks.entries()) {
      if (!task.enabled) {
        continue;
      }

      if (now >= task.executeAt) {
        // 执行任务
        this.executeTask(task);

        // 根据模式处理任务
        if (task.mode === 'recurring' && task.interval) {
          // 循环任务：更新下次执行时间
          task.executeAt = now + task.interval;
          task.lastExecutedAt = now;
          logger.scheduler(`循环任务 ${taskId} 下次执行时间: ${new Date(task.executeAt).toISOString()}`);
        } else {
          // 非循环任务：执行后删除
          this.tasks.delete(taskId);
          logger.scheduler(`任务 ${taskId} 执行完成并已删除`);
        }
      }
    }
  }

  /**
   * 执行任务：向目标设备发送指令
   */
  private executeTask(task: ScheduledTask): void {
    if (!this.aedes || !this.deviceCache) {
      logger.scheduler(`无法执行任务 ${task.id}: 调度器未初始化`);
      return;
    }

    const { deviceId, command } = task;

    // 构造转发消息
    const forwardMessage: ForwardMessage = {
      fromDevice: this.systemClientId,
      data: command
    };

    logger.scheduler(`执行任务 ${task.id}: 向设备 ${deviceId} 发送指令`);

    // 检查目标设备是否为 HTTP 模式
    if (this.deviceCache.isHttpMode(deviceId)) {
      // HTTP 模式：暂存消息
      this.deviceCache.addPendingMessage(deviceId, forwardMessage);
      logger.scheduler(`任务 ${task.id}: 消息已暂存给 HTTP 设备 ${deviceId}`);
      return;
    }

    // MQTT 模式：发送到目标设备的接收 topic
    const targetTopic = `/device/${deviceId}/r`;
    const payload = stringifyForwardMessage(forwardMessage);

    this.aedes.publish({
      topic: targetTopic,
      payload: Buffer.from(payload),
      qos: 0,
      retain: false,
      cmd: 'publish',
      dup: false
    }, (error: Error | undefined) => {
      if (error) {
        logger.scheduler(`任务 ${task.id} 发送失败: ${error.message}`);
      } else {
        logger.scheduler(`任务 ${task.id}: 消息已发送到 ${targetTopic}`);
      }
    });
  }

  /**
   * 获取调度器统计信息
   */
  getStats(): { totalTasks: number; enabledTasks: number; recurringTasks: number } {
    let enabledTasks = 0;
    let recurringTasks = 0;

    for (const task of this.tasks.values()) {
      if (task.enabled) {
        enabledTasks++;
      }
      if (task.mode === 'recurring') {
        recurringTasks++;
      }
    }

    return {
      totalTasks: this.tasks.size,
      enabledTasks,
      recurringTasks
    };
  }
}

// 导出单例
export const scheduler = new Scheduler();
