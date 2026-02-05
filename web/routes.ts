import crypto from 'crypto';
import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import {
  getAllDevices,
  getDeviceByUuid,
  getDeviceGroups,
  updateDeviceConnection,
  createDevice,
  createGroup,
  getGroupByName,
  addDeviceToGroup,
  getDeviceStatus
} from '../src/database';
import { Device, Group, ApiResponse, UserCreateDeviceBody, DeviceParams } from '../src/types';
import { USER_TOKEN } from '../src/config';

/**
 * 判断是否为本地请求
 */
function isLocalRequest(request: FastifyRequest): boolean {
  const ip = request.ip;
  return ip === '127.0.0.1' || ip === '::1' || ip === 'localhost' || ip === '::ffff:127.0.0.1';
}

/**
 * 验证 User Token
 */
function verifyUserToken(request: FastifyRequest, reply: FastifyReply): boolean {
  // 如果未配置 USER_TOKEN，则不需要验证（开发模式）
  if (!USER_TOKEN) {
    return true;
  }

  // 本地请求不需要验证
  if (isLocalRequest(request)) {
    return true;
  }

  const authHeader = request.headers['authorization'];
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : authHeader;

  if (!token || token !== USER_TOKEN) {
    reply.status(401).send({
      message: 1008,
      detail: '未授权访问，请提供有效的 User Token'
    });
    return false;
  }

  return true;
}

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
 * 设置Web管理路由
 */
export function setupWebRoutes(fastify: FastifyInstance): void {
  
  // 健康检查（不需要认证）
  fastify.get('/health', async (_request: FastifyRequest, _reply: FastifyReply): Promise<ApiResponse> => {
    return {
      message: 1000,
      detail: {
        status: 'ok',
        service: 'web-user',
        timestamp: new Date().toISOString()
      }
    };
  });

  /**
   * 获取所有设备列表
   * GET /user/devices
   */
  fastify.get('/user/devices', async (request: FastifyRequest, reply: FastifyReply): Promise<ApiResponse | undefined> => {
    if (!verifyUserToken(request, reply)) return;
    
    try {
      const devices = getAllDevices();
      
      // 为每个设备添加连接状态信息
      const devicesWithStatus = devices.map(device => {
        const status = getDeviceStatus(device.id);
        return {
          ...device,
          status: status?.status === 1 ? 1 : 0,
          mode: status?.mode || null,
          last_active_at: status?.last_active_at || null
        };
      });
      
      return {
        message: 1000,
        detail: {
          devices: devicesWithStatus,
          total: devicesWithStatus.length
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
   * 获取单个设备详情
   * GET /user/device/:uuid
   */
  fastify.get('/user/device/:uuid', async (request: FastifyRequest<{ Params: DeviceParams }>, reply: FastifyReply): Promise<ApiResponse | undefined> => {
    if (!verifyUserToken(request, reply)) return;
    
    try {
      const { uuid } = request.params;
      const device = getDeviceByUuid(uuid);

      if (!device) {
        return reply.status(404).send({
          message: 1003,
          detail: '设备不存在'
        });
      }

      const groups = getDeviceGroups(device.id);
      const deviceStatus = getDeviceStatus(device.id);

      return {
        message: 1000,
        detail: {
          ...device,
          groups: groups.map(g => g.name),
          status: deviceStatus?.status === 1 ? 1 : 0,
          mode: deviceStatus?.mode || null,
          last_active_at: deviceStatus?.last_active_at || null
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
   * 创建设备（用户接口）
   * POST /user/device
   */
  fastify.post('/user/device', async (request: FastifyRequest<{ Body: UserCreateDeviceBody }>, reply: FastifyReply): Promise<ApiResponse | undefined> => {
    if (!verifyUserToken(request, reply)) return;
    
    try {
      const { uuid } = request.body || {};

      const deviceUuid = uuid || generateRandomString(16);

      // 检查设备是否已存在
      const existingDevice = getDeviceByUuid(deviceUuid);
      if (existingDevice) {
        return reply.status(400).send({
          message: 1001,
          detail: '设备UUID已存在'
        });
      }

      // 生成authKey
      const authKey = generateAuthKey();

      // 创建设备记录
      createDevice(deviceUuid, authKey);

      // 创建默认用户组（以uuid为组名）
      createGroup(deviceUuid);
      const group = getGroupByName(deviceUuid);
      const device = getDeviceByUuid(deviceUuid);
      if (group && device) {
        addDeviceToGroup(device.id, group.id);
      }

      return {
        message: 1000,
        detail: {
          uuid: deviceUuid,
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
   * 获取设备连接信息（用于测试）
   * GET /user/device/:uuid/connection
   */
  fastify.get('/user/device/:uuid/connection', async (request: FastifyRequest<{ Params: DeviceParams }>, reply: FastifyReply): Promise<ApiResponse | undefined> => {
    if (!verifyUserToken(request, reply)) return;
    
    try {
      const { uuid } = request.params;
      const device = getDeviceByUuid(uuid);

      if (!device) {
        return reply.status(404).send({
          message: 1003,
          detail: '设备不存在'
        });
      }

      // 生成新的连接凭证
      const clientId = generateClientId();
      const username = `user_${device.uuid.slice(0, 8)}`;
      const password = generatePassword();

      // 更新数据库
      updateDeviceConnection(device.auth_key, clientId, username, password);

      return {
        message: 1000,
        detail: {
          uuid: device.uuid,
          clientId: clientId,
          username: username,
          password: password
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
