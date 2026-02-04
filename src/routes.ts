import crypto from 'crypto';
import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import {
  createDevice,
  getDeviceByAuthKey,
  getDeviceByUuid,
  updateDeviceConnection,
  createGroup,
  getGroupByName,
  addDeviceToGroup,
  getDeviceGroups,
  updateDeviceOnlineStatus,
  updateDeviceLastActive
} from './database';
import {
  IDeviceCache,
  Device,
  DeviceAuthBody,
  DeviceAuthQuery,
  DevicePublishBody,
  DeviceSubscribeQuery,
  DeviceGroupBody,
  DeviceGroupsQuery,
  ApiResponse
} from './types';
import { logger } from './logger';

/**
 * 生成随机字符串
 */
function generateRandomString(length: number = 32): string {
  return crypto.randomBytes(length).toString('hex').slice(0, length);
}

/**
 * 生成authKey
 */
function generateAuthKey(): string {
  return generateRandomString(16);
}

/**
 * 生成clientId
 */
function generateClientId(): string {
  return generateRandomString(16);
}

/**
 * 生成密码
 */
function generatePassword(): string {
  return generateRandomString(16);
}

/**
 * 设置HTTP路由
 */
export function setupRoutes(fastify: FastifyInstance, deviceCache: IDeviceCache): void {
  
  // 健康检查
  fastify.get('/health', async (_request: FastifyRequest, _reply: FastifyReply): Promise<ApiResponse> => {
    const stats = deviceCache.getStats();
    return {
      message: 1000,
      detail: {
        status: 'ok',
        ...stats,
        timestamp: new Date().toISOString()
      }
    };
  });

  /**
   * 设备注册接口
   * POST /device/auth
   * Body: { uuid, token }
   */
  fastify.post('/device/auth', async (request: FastifyRequest<{ Body: DeviceAuthBody }>, reply: FastifyReply): Promise<ApiResponse> => {
    try {
      const { uuid } = request.body || {};

      if (!uuid) {
        return reply.status(400).send({
          message: 1001,
          detail: 'uuid为必填参数'
        });
      }

      // 检查设备是否已存在
      const existingDevice = getDeviceByUuid(uuid);
      if (existingDevice) {
        return {
          message: 1000,
          detail: {
            authKey: existingDevice.auth_key
          }
        };
      }

      // 生成authKey
      const authKey = generateAuthKey();

      // 创建设备记录
      createDevice(uuid, authKey);

      // 创建默认用户组（以uuid为组名）
      createGroup(uuid);
      const group = getGroupByName(uuid);
      const device = getDeviceByUuid(uuid);
      if (group && device) {
        addDeviceToGroup(device.id, group.id);
      }

      return {
        message: 1000,
        detail: {
          authKey: authKey
        }
      };
    } catch (error) {
      fastify.log.error(error);
      return reply.status(500).send({
        message: 1002,
        detail: '服务器内部错误'
      });
    }
  });

  /**
   * 设备上线接口 - 获取连接信息
   * GET /device/auth?authKey={authKey}&mode={mode}
   * mode: mqtt(默认) | http
   */
  fastify.get('/device/auth', async (request: FastifyRequest<{ Querystring: DeviceAuthQuery }>, reply: FastifyReply): Promise<ApiResponse> => {
    try {
      const { authKey, mode = 'mqtt' } = request.query;

      if (!authKey) {
        return reply.status(400).send({
          message: 1001,
          detail: 'authKey为必填参数'
        });
      }

      // 验证mode参数
      if (mode !== 'mqtt' && mode !== 'http') {
        return reply.status(400).send({
          message: 1001,
          detail: 'mode参数只能是mqtt或http'
        });
      }

      // 获取设备信息
      const device = getDeviceByAuthKey(authKey);
      if (!device) {
        return reply.status(404).send({
          message: 1003,
          detail: '设备不存在'
        });
      }

      // 每次获取连接信息都重新生成凭证（限制机制1）
      const clientId = generateClientId();
      const username = `user_${device.uuid.slice(0, 8)}`;
      const password = generatePassword();

      // 更新数据库
      updateDeviceConnection(authKey, clientId, username, password);

      // 更新缓存
      const deviceInfo: Device = {
        ...device,
        client_id: clientId,
        username: username,
        password: password
      };
      deviceCache.setDeviceByAuthKey(authKey, deviceInfo);
      deviceCache.setDeviceByClientId(clientId, deviceInfo);

      // 设置设备连接模式
      deviceCache.setDeviceMode(clientId, mode);

      // 加载设备组到缓存
      const groups = getDeviceGroups(device.id);
      const groupNames = groups.map(g => g.name);
      deviceCache.setDeviceGroups(clientId, groupNames);

      // 根据模式返回不同的连接信息
      if (mode === 'http') {
        // HTTP模式上线，更新数据库状态和活动时间
        updateDeviceOnlineStatus(device.id, true, 'http');
        deviceCache.setHttpDeviceLastActive(clientId);
        
        return {
          message: 1000,
          detail: {
            mode: 'http',
            clientId: clientId,
            authKey: authKey,
            uuid: device.uuid
          }
        };
      }

      // MQTT模式上线，状态将在MQTT连接时更新
      return {
        message: 1000,
        detail: {
          mode: 'mqtt',
          host: 'mqtt://localhost',
          port: '1883',
          clientId: clientId,
          username: username,
          password: password,
          uuid: device.uuid
        }
      };
    } catch (error) {
      fastify.log.error(error);
      return reply.status(500).send({
        message: 1002,
        detail: '服务器内部错误'
      });
    }
  });

  /**
   * HTTP发布接口（模拟MQTT发布）
   * POST /device/s
   * Body: { authKey, toDevice, data } 或 { authKey, toGroup, data }
   */
  fastify.post('/device/s', async (request: FastifyRequest<{ Body: DevicePublishBody }>, reply: FastifyReply): Promise<ApiResponse> => {
    try {
      const { authKey, toDevice, toGroup, data } = request.body || {};

      if (!authKey) {
        return reply.status(400).send({
          message: 1001,
          detail: 'authKey为必填参数'
        });
      }

      if (!toDevice && !toGroup) {
        return reply.status(400).send({
          message: 1001,
          detail: 'toDevice或toGroup至少需要一个'
        });
      }

      if (!data) {
        return reply.status(400).send({
          message: 1001,
          detail: 'data为必填参数'
        });
      }

      // 验证设备
      let deviceInfo = deviceCache.getDeviceByAuthKey(authKey);
      if (!deviceInfo) {
        const device = getDeviceByAuthKey(authKey);
        if (!device) {
          return reply.status(404).send({
            message: 1003,
            detail: '设备不存在'
          });
        }
        deviceInfo = device;
      }

      const clientId = deviceInfo.client_id;

      if (!clientId) {
        return reply.status(400).send({
          message: 1001,
          detail: '设备未上线'
        });
      }

      // HTTP设备有动作，更新活动时间
      if (deviceCache.isHttpMode(clientId)) {
        deviceCache.setHttpDeviceLastActive(clientId);
        updateDeviceLastActive(deviceInfo.id);
      }

      // 检查发布频率限制（限制机制3）
      if (!deviceCache.checkPublishRate(clientId)) {
        return reply.status(429).send({
          message: 1005,
          detail: '发布频率过高，请稍后重试'
        });
      }

      // 检查消息长度限制（限制机制4）
      const messageStr = typeof data === 'string' ? data : JSON.stringify(data);
      if (messageStr.length > 1024) {
        return reply.status(400).send({
          message: 1004,
          detail: '消息长度不能大于1024'
        });
      }

      // 处理设备间消息
      if (toDevice) {
        const targetDevice = deviceCache.getDeviceByClientId(toDevice);
        if (targetDevice) {
          // 构造转发消息
          const forwardMessage = {
            fromDevice: clientId,
            data: data
          };

          // 检查目标设备是否为HTTP模式
          if (deviceCache.isHttpMode(toDevice)) {
            // HTTP模式：暂存消息
            deviceCache.addPendingMessage(toDevice, forwardMessage);
            logger.http(`消息已暂存给HTTP设备: ${toDevice}`);
          }
          // 如果是MQTT模式，消息会通过broker.ts的逻辑转发
        }
      }

      // 处理组消息
      if (toGroup) {
        // 检查发送者是否在目标组中
        if (!deviceCache.isDeviceInGroup(clientId, toGroup)) {
          return reply.status(403).send({
            message: 1006,
            detail: '无权向该组发送消息'
          });
        }

        // 构造转发消息
        const forwardMessage = {
          fromGroup: toGroup,
          fromDevice: clientId,
          data: data
        };

        // 使用反向索引获取组内所有HTTP模式的设备并暂存消息
        const groupMembers = deviceCache.getGroupMembers(toGroup);
        for (const memberId of groupMembers) {
          if (memberId !== clientId && deviceCache.isHttpMode(memberId)) {
            deviceCache.addPendingMessage(memberId, forwardMessage);
          }
        }
        logger.http(`组消息发送到: ${toGroup}`);
      }

      return {
        message: 1000,
        detail: {
          status: 'published'
        }
      };
    } catch (error) {
      fastify.log.error(error);
      return reply.status(500).send({
        message: 1002,
        detail: '服务器内部错误'
      });
    }
  });

  /**
   * HTTP订阅接口 - 获取暂存的消息
   * GET /device/r?authKey={authKey}
   * 获取后清除暂存的消息
   */
  fastify.get('/device/r', async (request: FastifyRequest<{ Querystring: DeviceSubscribeQuery }>, reply: FastifyReply): Promise<ApiResponse> => {
    try {
      const { authKey } = request.query;

      if (!authKey) {
        return reply.status(400).send({
          message: 1001,
          detail: 'authKey为必填参数'
        });
      }

      // 验证设备
      let deviceInfo = deviceCache.getDeviceByAuthKey(authKey);
      if (!deviceInfo) {
        const device = getDeviceByAuthKey(authKey);
        if (!device) {
          return reply.status(404).send({
            message: 1003,
            detail: '设备不存在'
          });
        }
        deviceInfo = device;
      }

      const clientId = deviceInfo.client_id;

      if (!clientId) {
        return reply.status(400).send({
          message: 1007,
          detail: '设备未上线'
        });
      }

      // 检查设备是否为HTTP模式
      if (!deviceCache.isHttpMode(clientId)) {
        return reply.status(400).send({
          message: 1007,
          detail: '该设备未以HTTP模式上线'
        });
      }

      // HTTP设备有动作，更新活动时间
      deviceCache.setHttpDeviceLastActive(clientId);
      updateDeviceLastActive(deviceInfo.id);

      // 获取并清除暂存的消息
      const messages = deviceCache.getPendingMessages(clientId);

      return {
        message: 1000,
        detail: {
          messages: messages,
          count: messages.length
        }
      };
    } catch (error) {
      fastify.log.error(error);
      return reply.status(500).send({
        message: 1002,
        detail: '服务器内部错误'
      });
    }
  });

  /**
   * 将设备添加到组
   * POST /device/group
   * Body: { authKey, groupName }
   */
  fastify.post('/device/group', async (request: FastifyRequest<{ Body: DeviceGroupBody }>, reply: FastifyReply): Promise<ApiResponse> => {
    try {
      const { authKey, groupName } = request.body || {};

      if (!authKey || !groupName) {
        return reply.status(400).send({
          message: 1001,
          detail: 'authKey, groupName为必填参数'
        });
      }

      const device = getDeviceByAuthKey(authKey);
      if (!device) {
        return reply.status(404).send({
          message: 1003,
          detail: '设备不存在'
        });
      }

      // 创建组（如果不存在）
      createGroup(groupName);
      const group = getGroupByName(groupName);

      if (!group) {
        return reply.status(500).send({
          message: 1002,
          detail: '创建组失败'
        });
      }

      // 将设备添加到组
      addDeviceToGroup(device.id, group.id);

      // 更新缓存
      if (device.client_id) {
        const groups = getDeviceGroups(device.id);
        const groupNames = groups.map(g => g.name);
        deviceCache.setDeviceGroups(device.client_id, groupNames);
      }

      return {
        message: 1000,
        detail: {
          status: 'added',
          groupName: groupName
        }
      };
    } catch (error) {
      fastify.log.error(error);
      return reply.status(500).send({
        message: 1002,
        detail: '服务器内部错误'
      });
    }
  });

  /**
   * 获取设备所在的组
   * GET /device/groups?authKey={authKey}
   */
  fastify.get('/device/groups', async (request: FastifyRequest<{ Querystring: DeviceGroupsQuery }>, reply: FastifyReply): Promise<ApiResponse> => {
    try {
      const { authKey } = request.query;

      if (!authKey) {
        return reply.status(400).send({
          message: 1001,
          detail: 'authKey为必填参数'
        });
      }

      const device = getDeviceByAuthKey(authKey);
      if (!device) {
        return reply.status(404).send({
          message: 1003,
          detail: '设备不存在'
        });
      }

      const groups = getDeviceGroups(device.id);

      return {
        message: 1000,
        detail: {
          groups: groups.map(g => g.name)
        }
      };
    } catch (error) {
      fastify.log.error(error);
      return reply.status(500).send({
        message: 1002,
        detail: '服务器内部错误'
      });
    }
  });
}
