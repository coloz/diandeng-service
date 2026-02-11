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
  getDeviceStatus,
  getAllBridgeRemotes,
  getBridgeRemoteByBrokerId,
  addBridgeRemote,
  updateBridgeRemote,
  deleteBridgeRemote,
  addBridgeSharedDevice,
  removeBridgeSharedDevice,
  getSharedDevicesForBroker,
  deleteAllBridgeSharedDevices,
  queryTimeseriesData
} from '../src/database';
import {
  Device,
  Group,
  ApiResponse,
  UserCreateDeviceBody,
  DeviceParams,
  AddBridgeRemoteBody,
  UpdateBridgeRemoteBody,
  BrokerParams,
  AddSharedDeviceBody,
  SharedDeviceParams,
  TimeseriesQueryParams,
  TimeseriesQuerystring
} from '../src/types';
import { USER_TOKEN } from '../src/config';
import config from '../src/config';
import { bridge } from '../src/bridge';
import { generateRandomString, generateAuthKey, generateClientId, generatePassword } from '../src/utils';

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
 * 设置Web管理路由
 */
export function setupWebRoutes(fastify: FastifyInstance): void {
  
  // 统一错误处理
  fastify.setErrorHandler((error, _request, reply) => {
    reply.log.error(error);
    reply.status(500).send({
      message: 1002,
      detail: '服务器内部错误'
    });
  });

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

  // ========== Bridge Remote Broker 管理接口 ==========

  /**
   * 获取本机 Bridge 信息及所有远程 Broker
   * GET /user/broker
   */
  fastify.get('/user/broker', async (request: FastifyRequest, reply: FastifyReply): Promise<ApiResponse | undefined> => {
    if (!verifyUserToken(request, reply)) return;

    try {
      const remotes = getAllBridgeRemotes();
      const connectedIds = bridge.getConnectedRemotes();

      return {
        message: 1000,
        detail: {
          brokerId: config.bridge.brokerId,
          bridgeToken: config.bridge.token,
          enabled: config.bridge.enabled,
          remotes: remotes.map(r => ({
            id: r.id,
            brokerId: r.broker_id,
            url: r.url,
            token: r.token,
            enabled: r.enabled === 1,
            connected: connectedIds.includes(r.broker_id),
            created_at: r.created_at,
            updated_at: r.updated_at
          })),
          total: remotes.length
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
   * 添加远程 Broker
   * POST /user/broker
   */
  fastify.post('/user/broker', async (request: FastifyRequest<{ Body: AddBridgeRemoteBody }>, reply: FastifyReply): Promise<ApiResponse | undefined> => {
    if (!verifyUserToken(request, reply)) return;

    try {
      const { brokerId, url, token } = request.body || {};

      if (!brokerId || !url || !token) {
        return reply.status(400).send({
          message: 1001,
          detail: 'brokerId、url、token 为必填参数'
        });
      }

      // 不能添加自己
      if (brokerId === config.bridge.brokerId) {
        return reply.status(400).send({
          message: 1001,
          detail: '不能添加本机 Broker 作为远程 Broker'
        });
      }

      // 检查是否已存在
      const existing = getBridgeRemoteByBrokerId(brokerId);
      if (existing) {
        return reply.status(400).send({
          message: 1001,
          detail: `远程 Broker ${brokerId} 已存在`
        });
      }

      addBridgeRemote(brokerId, url, token);

      // 处理可选的共享设备列表
      const { sharedDevices } = request.body || {} as any;
      if (sharedDevices && Array.isArray(sharedDevices)) {
        for (const sd of sharedDevices) {
          if (!sd.deviceUuid) continue;
          const device = getDeviceByUuid(sd.deviceUuid);
          if (device) {
            addBridgeSharedDevice(brokerId, device.id, sd.permissions || 'readwrite');
          }
        }
      }

      // 如果 Bridge 已运行，立即连接新添加的远程 Broker
      if (config.bridge.enabled) {
        bridge.addRemote({ id: brokerId, url, token });
      }

      return {
        message: 1000,
        detail: {
          brokerId,
          url,
          status: 'added'
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
   * 修改远程 Broker
   * PUT /user/broker/:brokerId
   */
  fastify.put('/user/broker/:brokerId', async (request: FastifyRequest<{ Params: BrokerParams; Body: UpdateBridgeRemoteBody }>, reply: FastifyReply): Promise<ApiResponse | undefined> => {
    if (!verifyUserToken(request, reply)) return;

    try {
      const { brokerId } = request.params;
      const { url, token, enabled } = request.body || {};

      const existing = getBridgeRemoteByBrokerId(brokerId);
      if (!existing) {
        return reply.status(404).send({
          message: 1003,
          detail: `远程 Broker ${brokerId} 不存在`
        });
      }

      const updates: { url?: string; token?: string; enabled?: number } = {};
      if (url !== undefined) updates.url = url;
      if (token !== undefined) updates.token = token;
      if (enabled !== undefined) updates.enabled = enabled ? 1 : 0;

      updateBridgeRemote(brokerId, updates);

      // 如果 Bridge 已运行，动态更新连接
      if (config.bridge.enabled) {
        if (enabled === false) {
          // 禁用 → 断开连接
          bridge.removeRemote(brokerId);
        } else {
          // 修改了 url/token 或启用 → 重连
          const updatedRemote = getBridgeRemoteByBrokerId(brokerId);
          if (updatedRemote && updatedRemote.enabled === 1) {
            bridge.updateRemote({
              id: updatedRemote.broker_id,
              url: updatedRemote.url,
              token: updatedRemote.token
            });
          }
        }
      }

      return {
        message: 1000,
        detail: {
          brokerId,
          status: 'updated'
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
   * 删除远程 Broker
   * DELETE /user/broker/:brokerId
   */
  fastify.delete('/user/broker/:brokerId', async (request: FastifyRequest<{ Params: BrokerParams }>, reply: FastifyReply): Promise<ApiResponse | undefined> => {
    if (!verifyUserToken(request, reply)) return;

    try {
      const { brokerId } = request.params;

      const existing = getBridgeRemoteByBrokerId(brokerId);
      if (!existing) {
        return reply.status(404).send({
          message: 1003,
          detail: `远程 Broker ${brokerId} 不存在`
        });
      }

      // 清理关联的共享设备记录
      deleteAllBridgeSharedDevices(brokerId);

      deleteBridgeRemote(brokerId);

      // 如果 Bridge 已运行，断开连接
      if (config.bridge.enabled) {
        bridge.removeRemote(brokerId);
      }

      return {
        message: 1000,
        detail: {
          brokerId,
          status: 'deleted'
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

  // ========== Bridge 共享设备管理接口 ==========

  /**
   * 获取与指定远程 Broker 共享的本地设备列表
   * GET /user/broker/:brokerId/devices
   */
  fastify.get('/user/broker/:brokerId/devices', async (request: FastifyRequest<{ Params: BrokerParams }>, reply: FastifyReply): Promise<ApiResponse | undefined> => {
    if (!verifyUserToken(request, reply)) return;

    try {
      const { brokerId } = request.params;

      const existing = getBridgeRemoteByBrokerId(brokerId);
      if (!existing) {
        return reply.status(404).send({
          message: 1003,
          detail: `远程 Broker ${brokerId} 不存在`
        });
      }

      const sharedDevices = getSharedDevicesForBroker(brokerId);

      return {
        message: 1000,
        detail: {
          brokerId,
          devices: sharedDevices.map(sd => ({
            id: sd.id,
            deviceUuid: sd.uuid,
            clientId: sd.client_id,
            permissions: sd.permissions,
            created_at: sd.created_at
          })),
          total: sharedDevices.length
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
   * 添加共享设备
   * POST /user/broker/:brokerId/devices
   */
  fastify.post('/user/broker/:brokerId/devices', async (request: FastifyRequest<{ Params: BrokerParams; Body: AddSharedDeviceBody }>, reply: FastifyReply): Promise<ApiResponse | undefined> => {
    if (!verifyUserToken(request, reply)) return;

    try {
      const { brokerId } = request.params;
      const { deviceUuid, permissions = 'readwrite' } = request.body || {};

      if (!deviceUuid) {
        return reply.status(400).send({
          message: 1001,
          detail: 'deviceUuid 为必填参数'
        });
      }

      if (permissions !== 'read' && permissions !== 'readwrite') {
        return reply.status(400).send({
          message: 1001,
          detail: 'permissions 必须为 read 或 readwrite'
        });
      }

      const remoteBroker = getBridgeRemoteByBrokerId(brokerId);
      if (!remoteBroker) {
        return reply.status(404).send({
          message: 1003,
          detail: `远程 Broker ${brokerId} 不存在`
        });
      }

      const device = getDeviceByUuid(deviceUuid);
      if (!device) {
        return reply.status(404).send({
          message: 1003,
          detail: `设备 ${deviceUuid} 不存在`
        });
      }

      addBridgeSharedDevice(brokerId, device.id, permissions);

      // 如果 Bridge 已运行，重新同步共享设备列表
      if (config.bridge.enabled) {
        bridge.syncSharedDevicesToBroker(brokerId);
      }

      return {
        message: 1000,
        detail: {
          brokerId,
          deviceUuid,
          permissions,
          status: 'shared'
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
   * 移除共享设备
   * DELETE /user/broker/:brokerId/devices/:uuid
   */
  fastify.delete('/user/broker/:brokerId/devices/:uuid', async (request: FastifyRequest<{ Params: SharedDeviceParams }>, reply: FastifyReply): Promise<ApiResponse | undefined> => {
    if (!verifyUserToken(request, reply)) return;

    try {
      const { brokerId, uuid } = request.params;

      const remoteBroker = getBridgeRemoteByBrokerId(brokerId);
      if (!remoteBroker) {
        return reply.status(404).send({
          message: 1003,
          detail: `远程 Broker ${brokerId} 不存在`
        });
      }

      const device = getDeviceByUuid(uuid);
      if (!device) {
        return reply.status(404).send({
          message: 1003,
          detail: `设备 ${uuid} 不存在`
        });
      }

      removeBridgeSharedDevice(brokerId, device.id);

      // 如果 Bridge 已运行，重新同步共享设备列表
      if (config.bridge.enabled) {
        bridge.syncSharedDevicesToBroker(brokerId);
      }

      return {
        message: 1000,
        detail: {
          brokerId,
          deviceUuid: uuid,
          status: 'unshared'
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
   * 获取远程 Broker 共享给我的设备列表（通过 Bridge 同步获取）
   * GET /user/broker/:brokerId/remote-devices
   */
  fastify.get('/user/broker/:brokerId/remote-devices', async (request: FastifyRequest<{ Params: BrokerParams }>, reply: FastifyReply): Promise<ApiResponse | undefined> => {
    if (!verifyUserToken(request, reply)) return;

    try {
      const { brokerId } = request.params;

      const existing = getBridgeRemoteByBrokerId(brokerId);
      if (!existing) {
        return reply.status(404).send({
          message: 1003,
          detail: `远程 Broker ${brokerId} 不存在`
        });
      }

      const remoteDevices = bridge.getRemoteSharedDevices(brokerId);

      return {
        message: 1000,
        detail: {
          brokerId,
          devices: remoteDevices.map(d => ({
            uuid: d.uuid,
            clientId: d.clientId,
            permissions: d.permissions,
            lastData: d.lastData || null,
            lastDataAt: d.lastDataAt || null
          })),
          total: remoteDevices.length
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
   * 查询设备时序数据
   * GET /user/device/:uuid/timeseries?dataKey=xxx&startTime=xxx&endTime=xxx&page=1&pageSize=100
   */
  fastify.get('/user/device/:uuid/timeseries', async (request: FastifyRequest<{ Params: TimeseriesQueryParams; Querystring: TimeseriesQuerystring }>, reply: FastifyReply): Promise<ApiResponse | undefined> => {
    if (!verifyUserToken(request, reply)) return;

    try {
      const { uuid } = request.params;
      const { dataKey, startTime, endTime, page, pageSize } = request.query;

      // 验证设备存在
      const device = getDeviceByUuid(uuid);
      if (!device) {
        return reply.status(404).send({
          message: 1003,
          detail: '设备不存在'
        });
      }

      const parsedStartTime = startTime ? parseInt(startTime, 10) : undefined;
      const parsedEndTime = endTime ? parseInt(endTime, 10) : undefined;
      const parsedPage = page ? parseInt(page, 10) : 1;
      const parsedPageSize = pageSize ? parseInt(pageSize, 10) : 1000;

      if (parsedStartTime !== undefined && isNaN(parsedStartTime)) {
        return reply.status(400).send({ message: 1001, detail: 'startTime 必须为有效时间戳' });
      }
      if (parsedEndTime !== undefined && isNaN(parsedEndTime)) {
        return reply.status(400).send({ message: 1001, detail: 'endTime 必须为有效时间戳' });
      }
      if (isNaN(parsedPage) || parsedPage < 1) {
        return reply.status(400).send({ message: 1001, detail: 'page 必须为正整数' });
      }
      if (isNaN(parsedPageSize) || parsedPageSize < 1) {
        return reply.status(400).send({ message: 1001, detail: 'pageSize 必须为正整数' });
      }

      const safePageSize = Math.min(parsedPageSize, 1000);
      const result = queryTimeseriesData(uuid, dataKey, parsedStartTime, parsedEndTime, parsedPage, safePageSize);

      return {
        message: 1000,
        detail: {
          deviceUuid: uuid,
          dataKey: dataKey || null,
          ...result
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
