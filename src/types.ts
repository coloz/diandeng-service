import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import Aedes, { Client as AedesClient, AedesPublishPacket, Subscription } from 'aedes';
import { Statement, Database as BetterSqlite3Database, RunResult } from 'better-sqlite3';

/**
 * 设备信息接口
 */
export interface Device {
  id: number;
  uuid: string;
  token: string;
  auth_key: string;
  client_id: string | null;
  username: string | null;
  password: string | null;
  iot_token: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * 设备组接口
 */
export interface Group {
  id: number;
  name: string;
  created_at: string;
}

/**
 * 设备-组关联接口
 */
export interface DeviceGroup {
  id: number;
  device_id: number;
  group_id: number;
  created_at: string;
}

/**
 * 转发消息接口
 */
export interface ForwardMessage {
  fromDevice: string;
  fromGroup?: string;
  data: unknown;
}

/**
 * 暂存消息接口
 */
export interface PendingMessage {
  message: ForwardMessage;
  timestamp: number;
}

/**
 * 设备连接模式
 */
export type DeviceMode = 'mqtt' | 'http';

/**
 * API响应接口
 */
export interface ApiResponse<T = unknown> {
  message: number;
  detail: T;
}

/**
 * 设备注册请求体
 */
export interface DeviceAuthBody {
  uuid?: string;
  token?: string;
}

/**
 * 设备认证查询参数
 */
export interface DeviceAuthQuery {
  authKey?: string;
  mode?: DeviceMode;
}

/**
 * 设备发布消息请求体
 */
export interface DevicePublishBody {
  authKey: string;
  toDevice?: string;
  toGroup?: string;
  data: unknown;
}

/**
 * 设备订阅查询参数
 */
export interface DeviceSubscribeQuery {
  authKey: string;
}

/**
 * 添加设备到组请求体
 */
export interface DeviceGroupBody {
  authKey: string;
  groupName: string;
}

/**
 * 获取设备组查询参数
 */
export interface DeviceGroupsQuery {
  authKey: string;
}

/**
 * 管理端创建设备请求体
 */
export interface AdminCreateDeviceBody {
  uuid?: string;
  token?: string;
}

/**
 * 设备参数
 */
export interface DeviceParams {
  uuid: string;
}

/**
 * 配置接口
 */
export interface Config {
  mqtt: {
    port: number;
    host: string;
  };
  http: {
    port: number;
    host: string;
  };
  message: {
    maxLength: number;
    publishRateLimit: number;
    expireTime: number;
  };
  cache: {
    cleanupInterval: number;
  };
  database: {
    filename: string;
  };
}

/**
 * 缓存统计信息
 */
export interface CacheStats {
  cachedDevices: number;
  onlineClients: number;
}

/**
 * MQTT客户端扩展接口
 */
export interface MqttClient extends AedesClient {
  id: string;
}

/**
 * 设备缓存接口
 */
export interface IDeviceCache {
  deviceByClientId: Map<string, Device>;
  setDeviceByClientId(clientId: string, deviceInfo: Device): void;
  getDeviceByClientId(clientId: string): Device | undefined;
  setDeviceByAuthKey(authKey: string, deviceInfo: Device): void;
  getDeviceByAuthKey(authKey: string): Device | undefined;
  removeDevice(clientId: string, authKey: string): void;
  setLastPublishTime(clientId: string, timestamp: number): void;
  getLastPublishTime(clientId: string): number;
  checkPublishRate(clientId: string): boolean;
  setClientOnline(clientId: string, client: AedesClient): void;
  setClientOffline(clientId: string): void;
  getOnlineClient(clientId: string): AedesClient | undefined;
  isClientOnline(clientId: string): boolean;
  setDeviceMode(clientId: string, mode: DeviceMode): void;
  getDeviceMode(clientId: string): DeviceMode;
  isHttpMode(clientId: string): boolean;
  addPendingMessage(clientId: string, message: ForwardMessage): void;
  getPendingMessages(clientId: string): ForwardMessage[];
  cleanExpiredMessages(): void;
  setDeviceGroups(clientId: string, groups: string[]): void;
  getDeviceGroups(clientId: string): string[];
  isDeviceInGroup(clientId: string, groupName: string): boolean;
  getStats(): CacheStats;
}

// 重新导出第三方类型
export {
  FastifyInstance,
  FastifyRequest,
  FastifyReply,
  Aedes,
  AedesClient,
  AedesPublishPacket,
  Subscription,
  Statement,
  BetterSqlite3Database,
  RunResult
};
