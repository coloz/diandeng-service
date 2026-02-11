import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import config from './config';
import { stringifyApiResponse } from './serializer';
import { generateAuthKey, generateClientId, generatePassword } from './utils';
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
  ApiResponse,
  CreateScheduleBody,
  CancelScheduleBody,
  UpdateScheduleBody,
  QueryScheduleQuery,
  ScheduleMode
} from './types';
import { logger } from './logger';
import { scheduler } from './scheduler';

/**
 * 设置HTTP路由
 */
export function setupRoutes(fastify: FastifyInstance, deviceCache: IDeviceCache): void {
  
  // 使用预编译序列化器加速 JSON 响应
  fastify.setReplySerializer((payload) => {
    if (typeof payload === 'string') return payload;
    return stringifyApiResponse(payload as Record<string, unknown>);
  });

  // 统一错误处理，路由无需单独 try/catch
  fastify.setErrorHandler((error, _request, reply) => {
    reply.log.error(error);
    reply.status(500).send({
      message: 1002,
      detail: '服务器内部错误'
    });
  });

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
  });

  /**
   * 设备上线接口 - 获取连接信息
   * GET /device/auth?authKey={authKey}&mode={mode}
   * mode: mqtt(默认) | http
   */
  fastify.get('/device/auth', async (request: FastifyRequest<{ Querystring: DeviceAuthQuery }>, reply: FastifyReply): Promise<ApiResponse> => {
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
  });

  /**
   * HTTP发布接口（模拟MQTT发布）
   * POST /device/s
   * Body: { authKey, toDevice, data } 或 { authKey, toGroup, data }
   */
  fastify.post('/device/s', async (request: FastifyRequest<{ Body: DevicePublishBody }>, reply: FastifyReply): Promise<ApiResponse> => {
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
      if (messageStr.length > config.message.maxLength) {
        return reply.status(400).send({
          message: 1004,
          detail: `消息长度不能大于${config.message.maxLength}`
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
  });

  /**
   * HTTP订阅接口 - 获取暂存的消息
   * GET /device/r?authKey={authKey}
   * 获取后清除暂存的消息
   */
  fastify.get('/device/r', async (request: FastifyRequest<{ Querystring: DeviceSubscribeQuery }>, reply: FastifyReply): Promise<ApiResponse> => {
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
  });

  /**
   * 将设备添加到组
   * POST /device/group
   * Body: { authKey, groupName }
   */
  fastify.post('/device/group', async (request: FastifyRequest<{ Body: DeviceGroupBody }>, reply: FastifyReply): Promise<ApiResponse> => {
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
  });

  /**
   * 获取设备所在的组
   * GET /device/groups?authKey={authKey}
   */
  fastify.get('/device/groups', async (request: FastifyRequest<{ Querystring: DeviceGroupsQuery }>, reply: FastifyReply): Promise<ApiResponse> => {
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
  });

  /**
   * 创建定时任务
   * POST /schedule
   * Body: { authKey, toDevice, command, mode, executeAt?, countdown?, interval? }
   */
  fastify.post('/schedule', async (request: FastifyRequest<{ Body: CreateScheduleBody }>, reply: FastifyReply): Promise<ApiResponse> => {
      const { authKey, toDevice, command, mode, executeAt, countdown, interval } = request.body || {};

      // 参数校验
      if (!authKey) {
        return reply.status(400).send({
          message: 1001,
          detail: 'authKey为必填参数'
        });
      }

      if (!toDevice) {
        return reply.status(400).send({
          message: 1001,
          detail: 'toDevice为必填参数'
        });
      }

      if (!command) {
        return reply.status(400).send({
          message: 1001,
          detail: 'command为必填参数'
        });
      }

      if (!mode || !['scheduled', 'countdown', 'recurring'].includes(mode)) {
        return reply.status(400).send({
          message: 1001,
          detail: 'mode必须是 scheduled、countdown 或 recurring'
        });
      }

      // 验证发起者设备
      const device = getDeviceByAuthKey(authKey);
      if (!device) {
        return reply.status(404).send({
          message: 1003,
          detail: '设备不存在'
        });
      }

      // 根据模式校验参数
      if (mode === 'scheduled' && !executeAt) {
        return reply.status(400).send({
          message: 1001,
          detail: 'scheduled模式需要executeAt参数（时间戳）'
        });
      }

      if (mode === 'countdown' && (!countdown || countdown <= 0)) {
        return reply.status(400).send({
          message: 1001,
          detail: 'countdown模式需要正数的countdown参数（秒）'
        });
      }

      if (mode === 'recurring' && (!interval || interval <= 0)) {
        return reply.status(400).send({
          message: 1001,
          detail: 'recurring模式需要正数的interval参数（秒）'
        });
      }

      // 创建定时任务
      const task = scheduler.createTask(toDevice, command, mode as ScheduleMode, {
        executeAt,
        countdown,
        interval
      });

      return {
        message: 1000,
        detail: {
          taskId: task.id,
          deviceId: task.deviceId,
          mode: task.mode,
          executeAt: task.executeAt,
          interval: task.interval,
          createdAt: task.createdAt
        }
      };
  });

  /**
   * 取消定时任务
   * DELETE /schedule
   * Body: { authKey, taskId }
   */
  fastify.delete('/schedule', async (request: FastifyRequest<{ Body: CancelScheduleBody }>, reply: FastifyReply): Promise<ApiResponse> => {
      const { authKey, taskId } = request.body || {};

      if (!authKey) {
        return reply.status(400).send({
          message: 1001,
          detail: 'authKey为必填参数'
        });
      }

      if (!taskId) {
        return reply.status(400).send({
          message: 1001,
          detail: 'taskId为必填参数'
        });
      }

      // 验证设备
      const device = getDeviceByAuthKey(authKey);
      if (!device) {
        return reply.status(404).send({
          message: 1003,
          detail: '设备不存在'
        });
      }

      // 取消任务
      const success = scheduler.cancelTask(taskId);
      if (!success) {
        return reply.status(404).send({
          message: 1008,
          detail: '任务不存在'
        });
      }

      return {
        message: 1000,
        detail: {
          status: 'cancelled',
          taskId
        }
      };
  });

  /**
   * 查询定时任务
   * GET /schedule?authKey={authKey}
   * 返回与该设备相关的所有定时任务
   */
  fastify.get('/schedule', async (request: FastifyRequest<{ Querystring: QueryScheduleQuery }>, reply: FastifyReply): Promise<ApiResponse> => {
      const { authKey } = request.query;

      if (!authKey) {
        return reply.status(400).send({
          message: 1001,
          detail: 'authKey为必填参数'
        });
      }

      // 验证设备
      const deviceInfo = deviceCache.getDeviceByAuthKey(authKey) || getDeviceByAuthKey(authKey);
      if (!deviceInfo) {
        return reply.status(404).send({
          message: 1003,
          detail: '设备不存在'
        });
      }

      const clientId = deviceInfo.client_id;

      // 获取所有任务（按设备筛选或获取全部）
      const tasks = clientId 
        ? scheduler.getTasksByDevice(clientId)
        : [];

      // 获取调度器统计信息
      const stats = scheduler.getStats();

      return {
        message: 1000,
        detail: {
          tasks: tasks.map(t => ({
            taskId: t.id,
            deviceId: t.deviceId,
            command: t.command,
            mode: t.mode,
            executeAt: t.executeAt,
            interval: t.interval,
            createdAt: t.createdAt,
            lastExecutedAt: t.lastExecutedAt,
            enabled: t.enabled
          })),
          count: tasks.length,
          stats
        }
      };
  });

  /**
   * 修改定时任务
   * PUT /schedule
   * Body: { authKey, taskId, command?, mode?, executeAt?, countdown?, interval?, enabled? }
   */
  fastify.put('/schedule', async (request: FastifyRequest<{ Body: UpdateScheduleBody }>, reply: FastifyReply): Promise<ApiResponse> => {
      const { authKey, taskId, command, mode, executeAt, countdown, interval, enabled } = request.body || {};

      if (!authKey) {
        return reply.status(400).send({
          message: 1001,
          detail: 'authKey为必填参数'
        });
      }

      if (!taskId) {
        return reply.status(400).send({
          message: 1001,
          detail: 'taskId为必填参数'
        });
      }

      // 验证设备
      const device = getDeviceByAuthKey(authKey);
      if (!device) {
        return reply.status(404).send({
          message: 1003,
          detail: '设备不存在'
        });
      }

      // 检查任务是否存在
      const existingTask = scheduler.getTask(taskId);
      if (!existingTask) {
        return reply.status(404).send({
          message: 1008,
          detail: '任务不存在'
        });
      }

      // 校验新模式的参数
      if (mode) {
        if (!['scheduled', 'countdown', 'recurring'].includes(mode)) {
          return reply.status(400).send({
            message: 1001,
            detail: 'mode必须是 scheduled、countdown 或 recurring'
          });
        }

        if (mode === 'scheduled' && !executeAt && !existingTask.executeAt) {
          return reply.status(400).send({
            message: 1001,
            detail: 'scheduled模式需要executeAt参数'
          });
        }

        if (mode === 'countdown' && !countdown) {
          return reply.status(400).send({
            message: 1001,
            detail: 'countdown模式需要countdown参数'
          });
        }

        if (mode === 'recurring' && !interval && !existingTask.interval) {
          return reply.status(400).send({
            message: 1001,
            detail: 'recurring模式需要interval参数'
          });
        }
      }

      // 更新任务
      const updatedTask = scheduler.updateTask(taskId, {
        command,
        mode: mode as ScheduleMode | undefined,
        executeAt,
        countdown,
        interval,
        enabled
      });

      if (!updatedTask) {
        return reply.status(500).send({
          message: 1002,
          detail: '更新任务失败'
        });
      }

      return {
        message: 1000,
        detail: {
          taskId: updatedTask.id,
          deviceId: updatedTask.deviceId,
          command: updatedTask.command,
          mode: updatedTask.mode,
          executeAt: updatedTask.executeAt,
          interval: updatedTask.interval,
          enabled: updatedTask.enabled
        }
      };
  });
}
