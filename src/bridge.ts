/**
 * Bridge 模块 - 跨 Broker 通信
 * 
 * 管理与远程 Broker 的 MQTT 连接，实现设备跨 Broker 消息转发。
 * 
 * 寻址规则：
 *   - 本地设备: "clientId"
 *   - 远程设备: "brokerId:clientId"
 * 
 * Bridge Topic 命名空间:
 *   - /bridge/device/{targetClientId}   设备消息投递
 *   - /bridge/group/{groupName}         组消息投递
 * 
 * Bridge 认证:
 *   - clientId: __bridge_{localBrokerId}
 *   - username: __bridge_
 *   - password: bridge token
 */

import mqtt, { MqttClient } from 'mqtt';
import Aedes, { PublishPacket } from 'aedes';
import config from './config';
import { BridgeRemoteConfig, BridgeMessage, BridgeGroupMessage, BridgeShareSyncMessage, BridgeShareDataMessage, ForwardMessage, IDeviceCache } from './types';
import { logger } from './logger';
import { stringifyBridgeMessage, stringifyBridgeGroupMessage, stringifyForwardMessage, stringifyGroupForwardMessage, stringifyBridgeShareSyncMessage, stringifyBridgeShareDataMessage } from './serializer';
import { getEnabledBridgeRemotes, getSharedDevicesForBroker, checkBridgeDeviceAccess, getSharedBrokerIdsForDevice, getDeviceByClientId as dbGetDeviceByClientId } from './database';

/** Bridge 客户端 ID 前缀 */
export const BRIDGE_CLIENT_PREFIX = '__bridge_';

/** Bridge topic 正则 */
const BRIDGE_DEVICE_TOPIC_REGEX = /^\/bridge\/device\/([^/]+)$/;
const BRIDGE_GROUP_TOPIC_REGEX = /^\/bridge\/group\/([^/]+)$/;
const BRIDGE_SHARE_SYNC_REGEX = /^\/bridge\/share\/sync\/([^/]+)$/;
const BRIDGE_SHARE_DATA_REGEX = /^\/bridge\/share\/data\/([^/]+)\/([^/]+)$/;

/**
 * 解析远程设备地址
 * @returns { brokerId, clientId } 或 null（本地设备）
 */
export function parseRemoteAddress(address: string): { brokerId: string; clientId: string } | null {
  const colonIndex = address.indexOf(':');
  if (colonIndex === -1) return null;
  const brokerId = address.substring(0, colonIndex);
  const clientId = address.substring(colonIndex + 1);
  if (!brokerId || !clientId) return null;
  return { brokerId, clientId };
}

/**
 * 判断 clientId 是否为 bridge 客户端
 */
export function isBridgeClient(clientId: string): boolean {
  return clientId.startsWith(BRIDGE_CLIENT_PREFIX);
}

/**
 * 远程 Broker 连接实例
 */
interface RemoteConnection {
  config: BridgeRemoteConfig;
  client: MqttClient | null;
  connected: boolean;
  reconnectTimer: NodeJS.Timeout | null;
}

/**
 * 远程共享设备信息（从远程 Broker 同步过来的）
 */
interface RemoteSharedDeviceEntry {
  uuid: string;
  clientId: string | null;
  permissions: string;
  lastData?: unknown;
  lastDataAt?: string;
}

/**
 * Bridge 管理器
 * 管理所有到远程 Broker 的连接，处理跨 broker 消息收发
 */
class BridgeManager {
  private aedes: Aedes | null = null;
  private deviceCache: IDeviceCache | null = null;
  private remotes: Map<string, RemoteConnection> = new Map();
  private remoteSharedDevices: Map<string, RemoteSharedDeviceEntry[]> = new Map();
  private started = false;

  /**
   * 初始化 Bridge
   */
  init(aedes: Aedes, deviceCache: IDeviceCache): void {
    this.aedes = aedes;
    this.deviceCache = deviceCache;
  }

  /**
   * 启动 Bridge，从数据库加载远程 Broker 并连接
   */
  start(): void {
    if (!config.bridge.enabled) {
      return;
    }

    if (!config.bridge.brokerId) {
      console.warn('[BRIDGE] 未配置 BROKER_ID，Bridge 功能已禁用');
      return;
    }

    if (this.started) return;
    this.started = true;

    console.log(`[BRIDGE] 启动 Bridge，本地 brokerId: ${config.bridge.brokerId}`);

    // 监听本地 Aedes 上的 bridge topic（来自远程 broker 的消息）
    this.setupLocalBridgeListener();

    // 从数据库加载已启用的远程 Broker 并连接
    this.loadAndConnectRemotes();
  }

  /**
   * 停止 Bridge，断开所有远程连接
   */
  stop(): void {
    if (!this.started) return;
    this.started = false;

    for (const [id, conn] of this.remotes) {
      if (conn.reconnectTimer) {
        clearTimeout(conn.reconnectTimer);
        conn.reconnectTimer = null;
      }
      if (conn.client) {
        conn.client.end(true);
        conn.client = null;
      }
      conn.connected = false;
      console.log(`[BRIDGE] 已断开远程 Broker: ${id}`);
    }
    this.remotes.clear();
  }

  /**
   * 发送设备消息到远程 Broker
   */
  sendToRemoteDevice(remoteBrokerId: string, fromClientId: string, targetClientId: string, data: unknown): boolean {
    const conn = this.remotes.get(remoteBrokerId);
    if (!conn || !conn.connected || !conn.client) {
      logger.forward(`[BRIDGE] 远程 Broker ${remoteBrokerId} 未连接，无法转发`);
      return false;
    }

    const bridgeMsg: BridgeMessage = {
      fromBroker: config.bridge.brokerId,
      fromDevice: fromClientId,
      toDevice: targetClientId,
      data
    };

    const topic = `/bridge/device/${targetClientId}`;
    const payload = stringifyBridgeMessage(bridgeMsg);

    conn.client.publish(topic, payload, { qos: 0 }, (error) => {
      if (error) {
        logger.forward(`[BRIDGE] 发送设备消息到 ${remoteBrokerId} 失败: ${error.message}`);
      } else {
        logger.forward(`[BRIDGE] 消息已转发到 ${remoteBrokerId} -> ${topic}`);
      }
    });

    return true;
  }

  /**
   * 发送组消息到远程 Broker
   */
  sendToRemoteGroup(remoteBrokerId: string, fromClientId: string, targetGroup: string, data: unknown): boolean {
    const conn = this.remotes.get(remoteBrokerId);
    if (!conn || !conn.connected || !conn.client) {
      logger.group(`[BRIDGE] 远程 Broker ${remoteBrokerId} 未连接，无法转发组消息`);
      return false;
    }

    const bridgeMsg: BridgeGroupMessage = {
      fromBroker: config.bridge.brokerId,
      fromDevice: fromClientId,
      toGroup: targetGroup,
      data
    };

    const topic = `/bridge/group/${targetGroup}`;
    const payload = stringifyBridgeGroupMessage(bridgeMsg);

    conn.client.publish(topic, payload, { qos: 0 }, (error) => {
      if (error) {
        logger.group(`[BRIDGE] 发送组消息到 ${remoteBrokerId} 失败: ${error.message}`);
      } else {
        logger.group(`[BRIDGE] 组消息已转发到 ${remoteBrokerId} -> ${topic}`);
      }
    });

    return true;
  }

  /**
   * 广播组消息到所有已连接的远程 Broker
   */
  broadcastToRemoteGroup(fromClientId: string, targetGroup: string, data: unknown): void {
    for (const [brokerId] of this.remotes) {
      this.sendToRemoteGroup(brokerId, fromClientId, targetGroup, data);
    }
  }

  /**
   * 检查远程 Broker 是否已连接
   */
  isRemoteConnected(brokerId: string): boolean {
    const conn = this.remotes.get(brokerId);
    return conn?.connected ?? false;
  }

  /**
   * 获取所有已连接的远程 Broker ID
   */
  getConnectedRemotes(): string[] {
    const connected: string[] = [];
    for (const [id, conn] of this.remotes) {
      if (conn.connected) connected.push(id);
    }
    return connected;
  }

  /**
   * 动态添加并连接一个远程 Broker（在通过 API 添加后调用）
   */
  addRemote(remote: BridgeRemoteConfig): void {
    if (!this.started) return;
    this.connectRemote(remote);
  }

  /**
   * 动态断开并移除一个远程 Broker（在通过 API 删除后调用）
   */
  removeRemote(brokerId: string): void {
    const conn = this.remotes.get(brokerId);
    if (conn) {
      if (conn.reconnectTimer) {
        clearTimeout(conn.reconnectTimer);
        conn.reconnectTimer = null;
      }
      if (conn.client) {
        conn.client.end(true);
        conn.client = null;
      }
      conn.connected = false;
      this.remotes.delete(brokerId);
      console.log(`[BRIDGE] 已移除远程 Broker: ${brokerId}`);
    }
  }

  /**
   * 动态更新一个远程 Broker 配置（断开旧连接，使用新配置重连）
   */
  updateRemote(remote: BridgeRemoteConfig): void {
    if (!this.started) return;
    this.removeRemote(remote.id);
    this.connectRemote(remote);
  }

  /**
   * 从数据库重新加载所有远程 Broker（用于批量刷新）
   */
  reloadRemotes(): void {
    if (!this.started) return;

    // 断开所有现有连接
    for (const [id, conn] of this.remotes) {
      if (conn.reconnectTimer) {
        clearTimeout(conn.reconnectTimer);
        conn.reconnectTimer = null;
      }
      if (conn.client) {
        conn.client.end(true);
        conn.client = null;
      }
      conn.connected = false;
    }
    this.remotes.clear();

    // 重新加载
    this.loadAndConnectRemotes();
  }

  // ========== 共享设备方法 ==========

  /**
   * 同步共享设备列表到指定远程 Broker
   * 当远程 bridge 客户端连接到本地 broker 并订阅 share topic 后调用
   */
  syncSharedDevicesToBroker(remoteBrokerId: string): void {
    if (!this.aedes) return;

    const sharedDevices = getSharedDevicesForBroker(remoteBrokerId);

    const devices = sharedDevices.map(sd => ({
      uuid: sd.uuid,
      clientId: sd.client_id,
      permissions: sd.permissions
    }));

    const msg = stringifyBridgeShareSyncMessage({
      fromBroker: config.bridge.brokerId,
      devices
    });

    const topic = `/bridge/share/sync/${remoteBrokerId}`;
    this.aedes.publish({
      topic,
      payload: Buffer.from(msg),
      qos: 0,
      retain: false,
      cmd: 'publish',
      dup: false
    } as PublishPacket, (error: Error | undefined) => {
      if (error) {
        logger.bridge(`[BRIDGE] 同步共享设备到 ${remoteBrokerId} 失败: ${error.message}`);
      } else {
        logger.bridge(`[BRIDGE] 已同步 ${devices.length} 个共享设备到 ${remoteBrokerId}`);
      }
    });
  }

  /**
   * 如果设备有共享记录，推送数据到相关 Broker
   * 在本地 Aedes 上发布 /bridge/share/data/{brokerId}/{clientId}
   * 远程 bridge 客户端通过订阅接收
   */
  pushShareDataIfNeeded(clientId: string, data: unknown): void {
    if (!this.aedes) return;

    const device = dbGetDeviceByClientId(clientId);
    if (!device) return;

    const brokerIds = getSharedBrokerIdsForDevice(device.id);
    if (brokerIds.length === 0) return;

    for (const brokerId of brokerIds) {
      const topic = `/bridge/share/data/${brokerId}/${clientId}`;
      const msg = stringifyBridgeShareDataMessage({
        fromBroker: config.bridge.brokerId,
        fromDevice: clientId,
        deviceUuid: device.uuid,
        data
      });

      this.aedes.publish({
        topic,
        payload: Buffer.from(msg),
        qos: 0,
        retain: false,
        cmd: 'publish',
        dup: false
      } as PublishPacket, (error: Error | undefined) => {
        if (error) {
          logger.bridge(`[BRIDGE] 推送共享数据到 ${brokerId} 失败: ${error.message}`);
        }
      });
    }
  }

  /**
   * 获取从远程 Broker 同步过来的共享设备列表
   */
  getRemoteSharedDevices(brokerId: string): RemoteSharedDeviceEntry[] {
    return this.remoteSharedDevices.get(brokerId) || [];
  }

  // ========== 私有方法 ==========

  /**
   * 从数据库加载已启用的远程 Broker 并连接
   */
  private loadAndConnectRemotes(): void {
    try {
      const remotes = getEnabledBridgeRemotes();
      console.log(`[BRIDGE] 从数据库加载到 ${remotes.length} 个远程 Broker`);

      for (const remote of remotes) {
        this.connectRemote({
          id: remote.broker_id,
          url: remote.url,
          token: remote.token
        });
      }
    } catch (error) {
      console.error(`[BRIDGE] 从数据库加载远程 Broker 失败: ${(error as Error).message}`);
    }
  }

  /**
   * 连接到远程 Broker
   */
  private connectRemote(remote: BridgeRemoteConfig): void {
    if (this.remotes.has(remote.id)) {
      console.warn(`[BRIDGE] 远程 Broker ${remote.id} 已存在连接`);
      return;
    }

    const conn: RemoteConnection = {
      config: remote,
      client: null,
      connected: false,
      reconnectTimer: null
    };
    this.remotes.set(remote.id, conn);

    this.doConnect(conn);
  }

  /**
   * 执行 MQTT 连接
   */
  private doConnect(conn: RemoteConnection): void {
    const { config: remote } = conn;
    const clientId = `${BRIDGE_CLIENT_PREFIX}${config.bridge.brokerId}`;

    console.log(`[BRIDGE] 正在连接远程 Broker: ${remote.id} (${remote.url})`);

    const client = mqtt.connect(remote.url, {
      clientId,
      username: BRIDGE_CLIENT_PREFIX,
      password: remote.token,
      clean: true,
      keepalive: 60,
      reconnectPeriod: 0, // 我们自己管理重连
      connectTimeout: 10000
    });

    conn.client = client;

    client.on('connect', () => {
      conn.connected = true;
      console.log(`[BRIDGE] 已连接远程 Broker: ${remote.id}`);

      // 订阅 bridge topic（接收远程 broker 转发给我们的消息）
      client.subscribe([
        '/bridge/device/+',
        '/bridge/group/+',
        `/bridge/share/sync/${config.bridge.brokerId}`,
        `/bridge/share/data/${config.bridge.brokerId}/+`
      ], { qos: 0 }, (error) => {
        if (error) {
          console.error(`[BRIDGE] 订阅 ${remote.id} bridge topic 失败:`, error.message);
        } else {
          logger.forward(`[BRIDGE] 已订阅 ${remote.id} 的 bridge topic`);
        }
      });
    });

    client.on('message', (topic: string, payload: Buffer) => {
      this.handleRemoteMessage(remote.id, topic, payload);
    });

    client.on('close', () => {
      if (conn.connected) {
        console.log(`[BRIDGE] 与远程 Broker ${remote.id} 的连接已断开`);
      }
      conn.connected = false;
      this.scheduleReconnect(conn);
    });

    client.on('error', (error: Error) => {
      logger.error(`[BRIDGE] 远程 Broker ${remote.id} 连接错误: ${error.message}`);
    });

    client.on('offline', () => {
      conn.connected = false;
      logger.forward(`[BRIDGE] 远程 Broker ${remote.id} 已离线`);
    });
  }

  /**
   * 安排重新连接
   */
  private scheduleReconnect(conn: RemoteConnection): void {
    if (!this.started) return;
    if (conn.reconnectTimer) return;

    conn.reconnectTimer = setTimeout(() => {
      conn.reconnectTimer = null;
      if (!this.started) return;

      // 清理旧连接
      if (conn.client) {
        conn.client.end(true);
        conn.client = null;
      }

      logger.forward(`[BRIDGE] 正在重连远程 Broker: ${conn.config.id}`);
      this.doConnect(conn);
    }, config.bridge.reconnectInterval);
  }

  /**
   * 监听本地 Aedes 上的 bridge topic
   * 当远程 broker 的 bridge 客户端发布到 /bridge/device/xxx 或 /bridge/group/xxx 时触发
   */
  private setupLocalBridgeListener(): void {
    if (!this.aedes) return;

    // Aedes 的 publish 事件会捕获所有发布的消息，包括 bridge 客户端发布的
    // bridge 消息在 broker.ts 的 publish 事件中处理
    // 这里不需要额外监听，由 broker.ts 中调用 bridge.handleIncomingBridgeMessage 处理
  }

  /**
   * 处理从远程 Broker 接收到的消息
   * (通过本地 bridge 作为远程 broker 的客户端收到)
   */
  private handleRemoteMessage(remoteBrokerId: string, topic: string, payload: Buffer): void {
    if (!this.aedes || !this.deviceCache) return;

    const payloadStr = payload.toString();
    logger.forward(`[BRIDGE] 收到来自 ${remoteBrokerId} 的消息: ${topic}`);

    try {
      // 处理设备消息
      const deviceMatch = topic.match(BRIDGE_DEVICE_TOPIC_REGEX);
      if (deviceMatch) {
        const targetClientId = deviceMatch[1]!;
        const msg = JSON.parse(payloadStr) as BridgeMessage;
        this.deliverToLocalDevice(msg.fromBroker, msg.fromDevice, targetClientId, msg.data);
        return;
      }

      // 处理组消息
      const groupMatch = topic.match(BRIDGE_GROUP_TOPIC_REGEX);
      if (groupMatch) {
        const targetGroup = groupMatch[1]!;
        const msg = JSON.parse(payloadStr) as BridgeGroupMessage;
        this.deliverToLocalGroup(msg.fromBroker, msg.fromDevice, targetGroup, msg.data);
        return;
      }

      // 处理共享同步消息
      const syncMatch = topic.match(BRIDGE_SHARE_SYNC_REGEX);
      if (syncMatch) {
        const msg = JSON.parse(payloadStr) as BridgeShareSyncMessage;
        this.handleShareSync(remoteBrokerId, msg);
        return;
      }

      // 处理共享数据推送
      const dataMatch = topic.match(BRIDGE_SHARE_DATA_REGEX);
      if (dataMatch) {
        const deviceClientId = dataMatch[2]!;
        const msg = JSON.parse(payloadStr) as BridgeShareDataMessage;
        this.handleShareData(remoteBrokerId, deviceClientId, msg);
        return;
      }
    } catch (error) {
      logger.error(`[BRIDGE] 解析远程消息失败: ${(error as Error).message}`);
    }
  }

  /**
   * 处理本地收到的 bridge 入站消息（从 broker.ts 调用）
   * 当一个远程 bridge 客户端连接到本地 broker 并发布 /bridge/... topic 时
   */
  handleIncomingBridgeDeviceMessage(targetClientId: string, payload: string): void {
    try {
      const msg = JSON.parse(payload) as BridgeMessage;
      this.deliverToLocalDevice(msg.fromBroker, msg.fromDevice, targetClientId, msg.data);
    } catch (error) {
      logger.error(`[BRIDGE] 解析入站设备消息失败: ${(error as Error).message}`);
    }
  }

  handleIncomingBridgeGroupMessage(targetGroup: string, payload: string): void {
    try {
      const msg = JSON.parse(payload) as BridgeGroupMessage;
      this.deliverToLocalGroup(msg.fromBroker, msg.fromDevice, targetGroup, msg.data);
    } catch (error) {
      logger.error(`[BRIDGE] 解析入站组消息失败: ${(error as Error).message}`);
    }
  }

  /**
   * 处理共享设备列表同步消息（从远程 Broker 收到）
   */
  private handleShareSync(remoteBrokerId: string, msg: BridgeShareSyncMessage): void {
    this.remoteSharedDevices.set(remoteBrokerId, msg.devices.map(d => ({
      uuid: d.uuid,
      clientId: d.clientId,
      permissions: d.permissions
    })));
    logger.bridge(`[BRIDGE] 收到来自 ${remoteBrokerId} 的共享设备列表: ${msg.devices.length} 个设备`);
  }

  /**
   * 处理共享设备数据推送消息（从远程 Broker 收到）
   */
  private handleShareData(remoteBrokerId: string, clientId: string, msg: BridgeShareDataMessage): void {
    const devices = this.remoteSharedDevices.get(remoteBrokerId);
    if (!devices) return;

    const device = devices.find(d => d.clientId === clientId || d.uuid === msg.deviceUuid);
    if (device) {
      device.lastData = msg.data;
      device.lastDataAt = new Date().toISOString();
      device.clientId = clientId; // 更新 clientId（可能因重新认证变化）
      logger.bridge(`[BRIDGE] 收到 ${remoteBrokerId} 共享设备 ${msg.deviceUuid} 的数据更新`);
    }
  }

  /**
   * 投递消息到本地设备
   */
  private deliverToLocalDevice(fromBroker: string, fromDevice: string, targetClientId: string, data: unknown): void {
    if (!this.aedes || !this.deviceCache) return;

    // ACL 检查：如果该远程 Broker 配置了共享设备白名单，验证目标设备是否在授权列表中
    const access = checkBridgeDeviceAccess(targetClientId, fromBroker);
    if (access === 'none') {
      logger.forward(`[BRIDGE] 设备 ${targetClientId} 未授权给 ${fromBroker}，拒绝投递`);
      return;
    }
    if (access === 'read') {
      logger.forward(`[BRIDGE] 设备 ${targetClientId} 对 ${fromBroker} 仅有只读权限，拒绝投递指令`);
      return;
    }

    const forwardMessage: ForwardMessage = {
      fromDevice: `${fromBroker}:${fromDevice}`,
      data
    };

    // 如果目标设备是 HTTP 模式，暂存消息
    if (this.deviceCache.isHttpMode(targetClientId)) {
      this.deviceCache.addPendingMessage(targetClientId, forwardMessage);
      logger.forward(`[BRIDGE] 远程消息已暂存给HTTP设备: ${targetClientId}`);
      return;
    }

    // MQTT 模式：发送到目标设备的接收 topic
    const targetTopic = `/device/${targetClientId}/r`;
    const payload = stringifyForwardMessage(forwardMessage);

    this.aedes.publish({
      topic: targetTopic,
      payload: Buffer.from(payload),
      qos: 0,
      retain: false,
      cmd: 'publish',
      dup: false
    } as PublishPacket, (error: Error | undefined) => {
      if (error) {
        logger.forward(`[BRIDGE] 投递远程消息到本地设备失败: ${error.message}`);
      } else {
        logger.forward(`[BRIDGE] 远程消息已投递到本地设备: ${targetClientId}`);
      }
    });
  }

  /**
   * 投递组消息到本地组成员
   */
  private deliverToLocalGroup(fromBroker: string, fromDevice: string, targetGroup: string, data: unknown): void {
    if (!this.aedes || !this.deviceCache) return;

    const forwardMessage: ForwardMessage = {
      fromDevice: `${fromBroker}:${fromDevice}`,
      fromGroup: targetGroup,
      data
    };

    // 为组内 HTTP 模式设备暂存消息
    const groupMembers = this.deviceCache.getGroupMembers(targetGroup);
    for (const memberClientId of groupMembers) {
      if (this.deviceCache.isHttpMode(memberClientId)) {
        this.deviceCache.addPendingMessage(memberClientId, forwardMessage);
        logger.group(`[BRIDGE] 远程组消息已暂存给HTTP设备: ${memberClientId}`);
      }
    }

    // 发送到组的接收 topic（MQTT 设备会通过订阅收到）
    const targetTopic = `/group/${targetGroup}/r`;
    const payload = stringifyGroupForwardMessage(forwardMessage);

    this.aedes.publish({
      topic: targetTopic,
      payload: Buffer.from(payload),
      qos: 0,
      retain: false,
      cmd: 'publish',
      dup: false
    } as PublishPacket, (error: Error | undefined) => {
      if (error) {
        logger.group(`[BRIDGE] 远程组消息投递失败: ${error.message}`);
      } else {
        logger.group(`[BRIDGE] 远程组消息已投递到本地组: ${targetGroup}`);
      }
    });
  }
}

// 导出单例
export const bridge = new BridgeManager();
