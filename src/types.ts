import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import Aedes, { Client as AedesClient, AedesPublishPacket, Subscription } from 'aedes';
import { Statement, Database as BetterSqlite3Database, RunResult } from 'better-sqlite3';

/**
 * 设备信息接口
 */
export interface Device {
  id: number;
  uuid: string;
  auth_key: string;
  client_id: string | null;
  username: string | null;
  password: string | null;
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
 * 设备状态接口
 */
export interface DeviceStatus {
  id: number;
  device_id: number;
  status: number;
  mode: 'mqtt' | 'http';
  last_active_at: string;
  updated_at: string;
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
 * Bridge 远程 Broker 配置
 */
export interface BridgeRemoteConfig {
  id: string;        // 远程 broker 的唯一标识
  url: string;       // 远程 broker 的 MQTT 地址，如 mqtt://192.168.1.100:1883
  token: string;     // 连接远程 broker 使用的 bridge token
}

/**
 * Bridge 远程 Broker 数据库记录
 */
export interface BridgeRemote {
  id: number;         // 数据库自增 ID
  broker_id: string;  // 远程 broker 的唯一标识
  url: string;        // 远程 broker 的 MQTT 地址
  token: string;      // 连接远程 broker 的 bridge token
  enabled: number;    // 是否启用 (0/1)
  created_at: string;
  updated_at: string;
}

/**
 * Bridge 消息接口（跨 broker 设备消息）
 */
export interface BridgeMessage {
  fromBroker: string;   // 来源 broker ID
  fromDevice: string;   // 来源设备 clientId
  toDevice: string;     // 目标设备 clientId（本地 clientId，不含 broker 前缀）
  data: unknown;
}

/**
 * Bridge 组消息接口（跨 broker 组消息）
 */
export interface BridgeGroupMessage {
  fromBroker: string;   // 来源 broker ID
  fromDevice: string;   // 来源设备 clientId
  toGroup: string;      // 目标组名（本地组名，不含 broker 前缀）
  data: unknown;
}

/**
 * Bridge 共享设备数据库记录
 */
export interface BridgeSharedDevice {
  id: number;
  broker_id: string;     // 远程 broker ID
  device_id: number;     // 本地 devices.id
  permissions: string;   // 'read' | 'readwrite'
  created_at: string;
}

/**
 * 共享设备信息（同步用）
 */
export interface BridgeSharedDeviceInfo {
  uuid: string;
  clientId: string | null;
  permissions: string;
}

/**
 * Bridge 共享同步消息
 */
export interface BridgeShareSyncMessage {
  fromBroker: string;
  devices: BridgeSharedDeviceInfo[];
}

/**
 * Bridge 共享数据推送消息
 */
export interface BridgeShareDataMessage {
  fromBroker: string;
  fromDevice: string;    // clientId
  deviceUuid: string;    // uuid
  data: unknown;
}

/**
 * 时序数据接口
 */
export interface TimeseriesData {
  id?: number;
  device_uuid: string;
  data_key: string;
  value: number;
  timestamp: number;
  created_at?: string;
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
 * 定时任务执行方式
 */
export type ScheduleMode = 'scheduled' | 'countdown' | 'recurring';

/**
 * 定时任务接口
 */
export interface ScheduledTask {
  id: string;
  deviceId: string;        // 目标设备的 clientId
  command: unknown;        // 要执行的指令数据
  mode: ScheduleMode;      // 执行方式
  executeAt: number;       // 执行时间（时间戳，毫秒）
  interval?: number;       // 循环执行的间隔时间（毫秒），仅 recurring 模式使用
  createdAt: number;       // 创建时间
  lastExecutedAt?: number; // 最后执行时间
  enabled: boolean;        // 是否启用
}

/**
 * 创建定时任务请求体
 */
export interface CreateScheduleBody {
  authKey: string;         // 发起者的 authKey
  toDevice: string;        // 目标设备的 clientId
  command: unknown;        // 要执行的指令
  mode: ScheduleMode;      // 执行方式: scheduled | countdown | recurring
  executeAt?: number;      // 执行时间戳（scheduled 模式必填）
  countdown?: number;      // 倒计时秒数（countdown 模式必填）
  interval?: number;       // 循环间隔秒数（recurring 模式必填）
}

/**
 * 修改定时任务请求体
 */
export interface UpdateScheduleBody {
  authKey: string;
  taskId: string;
  command?: unknown;        // 要执行的指令（可选）
  mode?: ScheduleMode;      // 执行方式（可选）
  executeAt?: number;       // 执行时间戳（可选）
  countdown?: number;       // 倒计时秒数（可选）
  interval?: number;        // 循环间隔秒数（可选）
  enabled?: boolean;        // 是否启用（可选）
}

/**
 * 取消定时任务请求体
 */
export interface CancelScheduleBody {
  authKey: string;
  taskId: string;
}

/**
 * 查询定时任务请求参数
 */
export interface QueryScheduleQuery {
  authKey: string;
}

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
 * 用户端创建设备请求体
 */
export interface UserCreateDeviceBody {
  uuid?: string;
}

/**
 * 设备参数
 */
export interface DeviceParams {
  uuid: string;
}

/**
 * 用户端添加远程 Broker 请求体
 */
export interface AddBridgeRemoteBody {
  brokerId: string;     // 远程 broker ID
  url: string;          // mqtt://host:port
  token: string;        // bridge token
  sharedDevices?: Array<{ deviceUuid: string; permissions?: string }>;  // 可选：同时共享本地设备
}

/**
 * 用户端修改远程 Broker 请求体
 */
export interface UpdateBridgeRemoteBody {
  url?: string;
  token?: string;
  enabled?: boolean;
}

/**
 * Broker 路由参数
 */
export interface BrokerParams {
  brokerId: string;
}

/**
 * 添加共享设备请求体
 */
export interface AddSharedDeviceBody {
  deviceUuid: string;
  permissions?: string;   // 'read' | 'readwrite', 默认 'readwrite'
}

/**
 * 共享设备路由参数
 */
export interface SharedDeviceParams {
  brokerId: string;
  uuid: string;
}

/**
 * 时序数据查询参数
 */
export interface TimeseriesQueryParams {
  uuid: string;
}

export interface TimeseriesQuerystring {
  dataKey?: string;
  startTime?: string;
  endTime?: string;
  limit?: string;
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
  timeseries: {
    retentionDays: number;
  };
  cache: {
    cleanupInterval: number;
  };
  database: {
    filename: string;
  };
  bridge: {
    enabled: boolean;           // 是否启用 bridge
    brokerId: string;           // 本 broker 的唯一标识
    token: string;              // 本 broker 接受 bridge 连接的 token
    reconnectInterval: number;  // 重连间隔（毫秒）
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
  getGroupMembers(groupName: string): string[];
  isDeviceInGroup(clientId: string, groupName: string): boolean;
  getStats(): CacheStats;
  setHttpDeviceLastActive(clientId: string): void;
  getHttpDeviceLastActive(clientId: string): number;
  getOnlineMqttClientIds(): string[];
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
