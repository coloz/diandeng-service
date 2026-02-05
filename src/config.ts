/**
 * 应用配置文件
 * 集中管理所有可配置项
 * 优先从环境变量读取，支持 .env 文件
 */

import { config as dotenvConfig } from 'dotenv';
import path from 'path';
import { Config } from './types';

// 加载 .env 文件
dotenvConfig({ path: path.resolve(process.cwd(), '.env') });

/**
 * 获取环境变量，支持默认值
 */
function getEnv(key: string, defaultValue: string): string {
  return process.env[key] || defaultValue;
}

/**
 * 获取数字类型环境变量
 */
function getEnvNumber(key: string, defaultValue: number): number {
  const value = process.env[key];
  if (value === undefined) return defaultValue;
  const parsed = parseInt(value, 10);
  return isNaN(parsed) ? defaultValue : parsed;
}

const config: Config = {
  // MQTT服务器配置
  mqtt: {
    port: getEnvNumber('MQTT_PORT', 1883),
    host: getEnv('MQTT_HOST', '0.0.0.0')
  },

  // HTTP服务器配置
  http: {
    port: getEnvNumber('HTTP_PORT', 3000),
    host: getEnv('HTTP_HOST', '0.0.0.0')
  },

  // 消息限制配置
  message: {
    // 消息最大长度限制（字节）
    maxLength: getEnvNumber('MESSAGE_MAX_LENGTH', 1024),
    // 发布频率限制（毫秒），设备发布消息的最小间隔
    publishRateLimit: getEnvNumber('PUBLISH_RATE_LIMIT', 1000),
    // HTTP模式消息暂存过期时间（毫秒）
    expireTime: getEnvNumber('MESSAGE_EXPIRE_TIME', 120 * 1000)
  },

  // 缓存配置
  cache: {
    // 过期消息清理间隔（毫秒）
    cleanupInterval: getEnvNumber('CACHE_CLEANUP_INTERVAL', 10000)
  },

  // 数据库配置
  database: {
    // 数据库文件名（相对于data目录）
    filename: getEnv('DB_FILENAME', 'broker.db')
  }
};

/**
 * User Token（用于访问用户接口）
 */
export const USER_TOKEN = getEnv('USER_TOKEN', '');

export default config;
