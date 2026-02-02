/**
 * 应用配置文件
 * 集中管理所有可配置项
 */

import { Config } from './types';

const config: Config = {
  // MQTT服务器配置
  mqtt: {
    port: 1883,
    host: '0.0.0.0'
  },

  // HTTP服务器配置
  http: {
    port: 3000,
    host: '0.0.0.0'
  },

  // 消息限制配置
  message: {
    // 消息最大长度限制（字节）
    maxLength: 1024,
    // 发布频率限制（毫秒），设备发布消息的最小间隔
    publishRateLimit: 1000,
    // HTTP模式消息暂存过期时间（毫秒）
    expireTime: 120 * 1000
  },

  // 缓存配置
  cache: {
    // 过期消息清理间隔（毫秒）
    cleanupInterval: 10000
  },

  // 数据库配置
  database: {
    // 数据库文件名（相对于data目录）
    filename: 'broker.db'
  }
};

export default config;
