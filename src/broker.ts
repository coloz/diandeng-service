import Aedes, { Client as AedesClient, AuthenticateError, PublishPacket, Subscription } from 'aedes';
import { getDeviceByClientId, getDeviceGroups, isDeviceInGroup, updateDeviceOnlineStatus, markDeviceOffline, insertTimeseriesData, batchInsertTimeseriesData } from './database';
import config from './config';
import { Device, ForwardMessage, IDeviceCache } from './types';
import { logger } from './logger';
import { stringifyForwardMessage, stringifyGroupForwardMessage } from './serializer';
import { bridge, isBridgeClient, parseRemoteAddress, BRIDGE_CLIENT_PREFIX } from './bridge';

// 预编译的正则表达式（避免每次调用时重新创建）
const DEVICE_TOPIC_REGEX = /^\/device\/([^/]+)\/(s|r)$/;
const GROUP_TOPIC_REGEX = /^\/group\/([^/]+)\/(s|r)$/;
const BRIDGE_DEVICE_TOPIC_REGEX = /^\/bridge\/device\/([^/]+)$/;
const BRIDGE_GROUP_TOPIC_REGEX = /^\/bridge\/group\/([^/]+)$/;

interface DeviceMessage {
  toDevice?: string;
  toGroup?: string;
  ts?: boolean;
  data: unknown;
}

interface GroupMessage {
  toGroup: string;
  data: unknown;
}

/**
 * 设置MQTT Broker逻辑
 */
export function setupBroker(aedes: Aedes, deviceCache: IDeviceCache): void {
  
  /**
   * 客户端认证
   */
  aedes.authenticate = (
    client: AedesClient,
    username: Readonly<string> | undefined,
    password: Readonly<Buffer> | undefined,
    callback: (error: AuthenticateError | null, success: boolean | null) => void
  ): void => {
    const clientId = client.id;
    const passwordStr = password ? password.toString() : '';

    logger.auth(`客户端尝试认证: ${clientId}, 用户名: ${username}`);

    // Bridge 客户端认证（特殊处理）
    if (isBridgeClient(clientId)) {
      if (!config.bridge.enabled || !config.bridge.token) {
        logger.auth(`Bridge 认证失败: Bridge 未启用或未配置 token`);
        const error = new Error('Bridge 未启用') as AuthenticateError;
        error.returnCode = 4;
        return callback(error, false);
      }
      if (username !== BRIDGE_CLIENT_PREFIX || passwordStr !== config.bridge.token) {
        logger.auth(`Bridge 认证失败: 凭证错误 ${clientId}`);
        const error = new Error('Bridge 凭证错误') as AuthenticateError;
        error.returnCode = 4;
        return callback(error, false);
      }
      logger.auth(`Bridge 认证成功: ${clientId}`);
      return callback(null, true);
    }

    // 从数据库获取设备信息
    const device = getDeviceByClientId(clientId);
    
    if (!device) {
      logger.auth(`认证失败: 设备不存在 ${clientId}`);
      const error = new Error('设备不存在') as AuthenticateError;
      error.returnCode = 4; // Bad username or password
      return callback(error, false);
    }

    // 验证用户名和密码
    if (device.username !== username || device.password !== passwordStr) {
      logger.auth(`认证失败: 凭证错误 ${clientId}`);
      const error = new Error('用户名或密码错误') as AuthenticateError;
      error.returnCode = 4;
      return callback(error, false);
    }

    logger.auth(`认证成功: ${clientId}`);
    
    // 缓存设备信息
    deviceCache.setDeviceByClientId(clientId, device);
    
    // 加载设备组到缓存
    const groups = getDeviceGroups(device.id);
    const groupNames = groups.map(g => g.name);
    deviceCache.setDeviceGroups(clientId, groupNames);

    callback(null, true);
  };

  /**
   * 授权发布
   */
  aedes.authorizePublish = (
    client: AedesClient | null,
    packet: PublishPacket,
    callback: (error: Error | null) => void
  ): void => {
    if (!client) {
      return callback(new Error('客户端不存在'));
    }

    const clientId = client.id;
    const topic = packet.topic;
    const payload = packet.payload.toString();

    logger.publish(`客户端 ${clientId} 尝试发布到: ${topic}`);

    // Bridge 客户端发布授权（只允许发布 /bridge/ topic）
    if (isBridgeClient(clientId)) {
      if (topic.startsWith('/bridge/')) {
        logger.publish(`Bridge 发布授权成功: ${clientId} -> ${topic}`);
        return callback(null);
      }
      return callback(new Error('Bridge 客户端只能发布 /bridge/ topic'));
    }

    // 检查消息长度限制（限制机制4）
    if (payload.length > config.message.maxLength) {
      logger.publish(`消息过长，断开连接: ${clientId}`);
      client.close();
      return callback(new Error(`消息长度超过${config.message.maxLength}`));
    }

    // 检查发布频率限制（限制机制3）
    if (!deviceCache.checkPublishRate(clientId)) {
      logger.publish(`发布频率过高，断开连接: ${clientId}`);
      client.close();
      return callback(new Error('发布频率过高'));
    }

    // 获取设备信息
    const device = deviceCache.getDeviceByClientId(clientId);
    if (!device) {
      logger.publish(`设备信息不存在: ${clientId}`);
      return callback(new Error('设备未认证'));
    }

    // 检查topic权限（限制机制2）
    const isAuthorized = checkTopicPermission(clientId, topic, 'publish', device, deviceCache);
    
    if (!isAuthorized) {
      logger.publish(`无权发布到topic，断开连接: ${clientId} -> ${topic}`);
      client.close();
      return callback(new Error('无权发布到此topic'));
    }

    logger.publish(`发布授权成功: ${clientId} -> ${topic}`);
    callback(null);
  };

  /**
   * 授权订阅
   */
  aedes.authorizeSubscribe = (
    client: AedesClient | null,
    sub: Subscription,
    callback: (error: Error | null, subscription: Subscription | null) => void
  ): void => {
    if (!client) {
      return callback(new Error('客户端不存在'), null);
    }

    const clientId = client.id;
    const topic = sub.topic;

    logger.subscribe(`客户端 ${clientId} 尝试订阅: ${topic}`);

    // Bridge 客户端订阅授权（只允许订阅 /bridge/ topic）
    if (isBridgeClient(clientId)) {
      if (topic.startsWith('/bridge/')) {
        logger.subscribe(`Bridge 订阅授权成功: ${clientId} -> ${topic}`);
        return callback(null, sub);
      }
      return callback(new Error('Bridge 客户端只能订阅 /bridge/ topic'), null);
    }

    // 获取设备信息
    const device = deviceCache.getDeviceByClientId(clientId);
    if (!device) {
      logger.subscribe(`设备信息不存在: ${clientId}`);
      return callback(new Error('设备未认证'), null);
    }

    // 检查topic权限（限制机制2）
    const isAuthorized = checkTopicPermission(clientId, topic, 'subscribe', device, deviceCache);
    
    if (!isAuthorized) {
      logger.subscribe(`无权订阅topic，断开连接: ${clientId} -> ${topic}`);
      client.close();
      return callback(new Error('无权订阅此topic'), null);
    }

    logger.subscribe(`订阅授权成功: ${clientId} -> ${topic}`);
    callback(null, sub);
  };

  /**
   * 客户端连接事件
   */
  aedes.on('client', (client: AedesClient) => {
    // Bridge 客户端连接不需要更新设备状态
    if (isBridgeClient(client.id)) {
      logger.connect(`Bridge 客户端已连接: ${client.id}`);
      return;
    }

    logger.connect(`客户端已连接: ${client.id}`);
    deviceCache.setClientOnline(client.id, client);
    
    // 更新数据库中的设备在线状态
    const device = deviceCache.getDeviceByClientId(client.id);
    if (device) {
      updateDeviceOnlineStatus(device.id, true, 'mqtt');
    }
  });

  /**
   * 客户端断开连接事件
   */
  aedes.on('clientDisconnect', (client: AedesClient) => {
    // Bridge 客户端断开不需要更新设备状态
    if (isBridgeClient(client.id)) {
      logger.disconnect(`Bridge 客户端已断开: ${client.id}`);
      return;
    }

    logger.disconnect(`客户端已断开: ${client.id}`);
    deviceCache.setClientOffline(client.id);
    
    // 更新数据库中的设备离线状态
    const device = deviceCache.getDeviceByClientId(client.id);
    if (device) {
      markDeviceOffline(device.id);
    }
  });

  /**
   * 客户端错误事件
   */
  aedes.on('clientError', (client: AedesClient, error: Error) => {
    logger.error(`客户端错误 ${client.id}: ${error.message}`);
  });

  /**
   * 发布事件 - 处理消息转发
   */
  aedes.on('publish', (packet: PublishPacket, client: AedesClient | null) => {
    if (!client) return; // 系统消息忽略

    const topic = packet.topic;
    const payload = packet.payload.toString();

    logger.message(`${client.id} 发布消息到 ${topic}: ${payload.substring(0, 100)}...`);

    // 处理 Bridge 入站消息（远程 Broker 通过 bridge 客户端发布到本地）
    if (isBridgeClient(client.id) && topic.startsWith('/bridge/')) {
      const deviceMatch = topic.match(BRIDGE_DEVICE_TOPIC_REGEX);
      if (deviceMatch) {
        bridge.handleIncomingBridgeDeviceMessage(deviceMatch[1]!, payload);
        return;
      }
      const groupMatch = topic.match(BRIDGE_GROUP_TOPIC_REGEX);
      if (groupMatch) {
        bridge.handleIncomingBridgeGroupMessage(groupMatch[1]!, payload);
        return;
      }
      return;
    }

    try {
      const message = JSON.parse(payload) as DeviceMessage;

      // 处理设备间消息转发
      if (topic.startsWith('/device/') && topic.endsWith('/s')) {
        // 处理时序数据持久化
        if (message.ts && message.data) {
          handleTimeseriesData(client.id, message.data, deviceCache);
        }
        handleDeviceMessage(aedes, client, message, deviceCache);
      }
      
      // 处理组消息转发
      if (topic.startsWith('/group/') && topic.endsWith('/s')) {
        handleGroupMessage(aedes, client, topic, message as GroupMessage, deviceCache);
      }
    } catch (error) {
      logger.message(`消息解析失败: ${(error as Error).message}`);
    }
  });

  /**
   * 订阅事件
   */
  aedes.on('subscribe', (subscriptions: Subscription[], client: AedesClient) => {
    logger.subscribe(`${client.id} 订阅了: ${subscriptions.map(s => s.topic).join(', ')}`);

    // Bridge 客户端订阅 share topic 后，同步共享设备列表
    if (isBridgeClient(client.id)) {
      const hasShareSub = subscriptions.some(s => s.topic.startsWith('/bridge/share/'));
      if (hasShareSub) {
        const remoteBrokerId = client.id.substring(BRIDGE_CLIENT_PREFIX.length);
        if (remoteBrokerId) {
          bridge.syncSharedDevicesToBroker(remoteBrokerId);
        }
      }
    }
  });

  /**
   * 取消订阅事件
   */
  aedes.on('unsubscribe', (subscriptions: string[], client: AedesClient) => {
    logger.subscribe(`${client.id} 取消订阅: ${subscriptions.join(', ')}`);
  });
}

/**
 * 检查topic权限
 */
function checkTopicPermission(
  clientId: string,
  topic: string,
  action: 'publish' | 'subscribe',
  device: Device,
  deviceCache: IDeviceCache
): boolean {
  // 设备topic格式: /device/{clientId}/s 或 /device/{clientId}/r
  const deviceMatch = topic.match(DEVICE_TOPIC_REGEX);
  
  if (deviceMatch) {
    const topicClientId = deviceMatch[1];
    const direction = deviceMatch[2];
    
    // 设备只能发布到自己的/s topic
    if (action === 'publish' && direction === 's') {
      return topicClientId === clientId;
    }
    
    // 设备只能订阅自己的/r topic
    if (action === 'subscribe' && direction === 'r') {
      return topicClientId === clientId;
    }
    
    return false;
  }

  // 组topic格式: /group/{groupName}/s 或 /group/{groupName}/r
  const groupMatch = topic.match(GROUP_TOPIC_REGEX);
  
  if (groupMatch) {
    const groupName = groupMatch[1]!;
    
    // 检查设备是否在该组中（限制机制5）
    const isInGroup = deviceCache.isDeviceInGroup(clientId, groupName);
    
    if (!isInGroup) {
      // 从数据库二次检查
      const dbCheck = isDeviceInGroup(device.id, groupName);
      if (!dbCheck) {
        return false;
      }
    }
    
    return true;
  }

  // 其他topic不允许
  return false;
}

/**
 * 处理时序数据持久化
 * 当消息中 ts=true 时，将 data 中的键值对作为时序数据写入 SQLite
 */
function handleTimeseriesData(
  clientId: string,
  data: unknown,
  deviceCache: IDeviceCache
): void {
  // 获取设备信息以取得 uuid
  const device = deviceCache.getDeviceByClientId(clientId);
  if (!device) {
    logger.message(`时序数据写入失败：设备信息不存在 ${clientId}`);
    return;
  }

  const deviceUuid = device.uuid;
  const timestamp = Date.now();

  if (typeof data !== 'object' || data === null) {
    logger.message(`时序数据格式错误：data 必须是对象`);
    return;
  }

  const records: Array<{ deviceUuid: string; dataKey: string; value: number; timestamp: number }> = [];
  const entries = Object.entries(data as Record<string, unknown>);

  for (const [key, val] of entries) {
    const numVal = Number(val);
    if (isNaN(numVal)) {
      logger.message(`时序数据跳过非数值字段: ${key}=${val}`);
      continue;
    }
    records.push({ deviceUuid, dataKey: key, value: numVal, timestamp });
  }

  if (records.length === 0) {
    logger.message(`时序数据为空，跳过写入`);
    return;
  }

  try {
    if (records.length === 1) {
      const r = records[0]!;
      insertTimeseriesData(r.deviceUuid, r.dataKey, r.value, r.timestamp);
    } else {
      batchInsertTimeseriesData(records);
    }
    logger.message(`时序数据已写入 ${records.length} 条: 设备 ${deviceUuid}`);
  } catch (error) {
    logger.error(`时序数据写入失败: ${(error as Error).message}`);
  }
}

/**
 * 处理设备间消息转发
 */
function handleDeviceMessage(
  aedes: Aedes,
  client: AedesClient,
  message: DeviceMessage,
  deviceCache: IDeviceCache
): void {
  const { toDevice, data } = message;
  
  if (!toDevice || !data) {
    logger.forward('消息格式错误，缺少toDevice或data');
    return;
  }

  // 共享设备数据推送：如果发送方设备被共享，推送数据到相关 Broker
  if (config.bridge.enabled) {
    bridge.pushShareDataIfNeeded(client.id, data);
  }

  // 检查是否是跨 Broker 消息（格式: brokerId:clientId）
  const remoteAddr = parseRemoteAddress(toDevice);
  if (remoteAddr) {
    // 转发到远程 Broker
    const sent = bridge.sendToRemoteDevice(remoteAddr.brokerId, client.id, remoteAddr.clientId, data);
    if (!sent) {
      logger.forward(`远程 Broker ${remoteAddr.brokerId} 不可用，消息丢弃`);
    }
    return;
  }

  // 本地设备消息转发（原有逻辑不变）
  const forwardMessage: ForwardMessage = {
    fromDevice: client.id,
    data: data
  };

  // 检查目标设备是否为HTTP模式
  if (deviceCache.isHttpMode(toDevice)) {
    deviceCache.addPendingMessage(toDevice, forwardMessage);
    logger.forward(`消息已暂存给HTTP设备: ${toDevice}`);
    return;
  }

  // MQTT模式：发送到目标设备的接收topic
  const targetTopic = `/device/${toDevice}/r`;
  const payload = stringifyForwardMessage(forwardMessage);
  
  aedes.publish({
    topic: targetTopic,
    payload: Buffer.from(payload),
    qos: 0,
    retain: false,
    cmd: 'publish',
    dup: false
  }, (error: Error | undefined) => {
    if (error) {
      logger.forward(`转发消息失败: ${error.message}`);
    } else {
      logger.forward(`消息已转发到 ${targetTopic}`);
    }
  });
}

/**
 * 处理组消息转发
 */
function handleGroupMessage(
  aedes: Aedes,
  client: AedesClient,
  topic: string,
  message: GroupMessage,
  deviceCache: IDeviceCache
): void {
  const { toGroup, data } = message;
  
  if (!toGroup || !data) {
    logger.group('消息格式错误，缺少toGroup或data');
    return;
  }

  // 检查是否是跨 Broker 组消息（格式: brokerId:groupName）
  const remoteAddr = parseRemoteAddress(toGroup);
  if (remoteAddr) {
    // 转发到远程 Broker 的指定组
    const sent = bridge.sendToRemoteGroup(remoteAddr.brokerId, client.id, remoteAddr.clientId, data);
    if (!sent) {
      logger.group(`远程 Broker ${remoteAddr.brokerId} 不可用，组消息丢弃`);
    }
    return;
  }

  // 本地组消息处理（原有逻辑不变）
  if (!deviceCache.isDeviceInGroup(client.id, toGroup)) {
    logger.group(`设备 ${client.id} 不在组 ${toGroup} 中，拒绝转发`);
    return;
  }

  const forwardMessage: ForwardMessage = {
    fromGroup: toGroup,
    fromDevice: client.id,
    data: data
  };

  // 为组内 HTTP 模式设备暂存消息
  const groupMembers = deviceCache.getGroupMembers(toGroup);
  for (const clientIdEntry of groupMembers) {
    if (clientIdEntry !== client.id && deviceCache.isHttpMode(clientIdEntry)) {
      deviceCache.addPendingMessage(clientIdEntry, forwardMessage);
      logger.group(`组消息已暂存给HTTP设备: ${clientIdEntry}`);
    }
  }

  // 发送到组的接收 topic
  const targetTopic = `/group/${toGroup}/r`;
  const payload = stringifyGroupForwardMessage(forwardMessage);
  
  aedes.publish({
    topic: targetTopic,
    payload: Buffer.from(payload),
    qos: 0,
    retain: false,
    cmd: 'publish',
    dup: false
  }, (error: Error | undefined) => {
    if (error) {
      logger.group(`组消息转发失败: ${error.message}`);
    } else {
      logger.group(`消息已转发到组 ${toGroup}`);
    }
  });

  // 如果启用了 Bridge，同时广播组消息到所有远程 Broker
  if (config.bridge.enabled) {
    bridge.broadcastToRemoteGroup(client.id, toGroup, data);
  }
}
