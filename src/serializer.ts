/**
 * 高性能 JSON 序列化模块
 * 使用 fast-json-stringify 预编译 schema 提升序列化性能
 */

import fastJson from 'fast-json-stringify';

/**
 * ForwardMessage 序列化器
 * 用于设备间消息转发
 */
export const stringifyForwardMessage = fastJson({
  title: 'ForwardMessage',
  type: 'object',
  properties: {
    fromDevice: { type: 'string' },
    fromGroup: { type: 'string' },
    data: {}  // any type
  },
  required: ['fromDevice', 'data']
});

/**
 * 带组信息的 ForwardMessage 序列化器
 */
export const stringifyGroupForwardMessage = fastJson({
  title: 'GroupForwardMessage',
  type: 'object',
  properties: {
    fromGroup: { type: 'string' },
    fromDevice: { type: 'string' },
    data: {}  // any type
  },
  required: ['fromGroup', 'fromDevice', 'data']
});

/**
 * API 响应序列化器
 */
export const stringifyApiResponse = fastJson({
  title: 'ApiResponse',
  type: 'object',
  properties: {
    message: { type: 'integer' },
    detail: {}  // any type
  },
  required: ['message', 'detail']
});

/**
 * 健康检查响应序列化器
 */
export const stringifyHealthResponse = fastJson({
  title: 'HealthResponse',
  type: 'object',
  properties: {
    message: { type: 'integer' },
    detail: {
      type: 'object',
      properties: {
        status: { type: 'string' },
        cachedDevices: { type: 'integer' },
        onlineClients: { type: 'integer' },
        timestamp: { type: 'string' }
      }
    }
  }
});

/**
 * 设备认证响应序列化器
 */
export const stringifyAuthResponse = fastJson({
  title: 'AuthResponse',
  type: 'object',
  properties: {
    message: { type: 'integer' },
    detail: {
      type: 'object',
      properties: {
        authKey: { type: 'string' },
        mode: { type: 'string' },
        host: { type: 'string' },
        port: { type: 'string' },
        clientId: { type: 'string' },
        username: { type: 'string' },
        password: { type: 'string' },
        uuid: { type: 'string' }
      }
    }
  }
});

/**
 * 发布响应序列化器
 */
export const stringifyPublishResponse = fastJson({
  title: 'PublishResponse',
  type: 'object',
  properties: {
    message: { type: 'integer' },
    detail: {
      type: 'object',
      properties: {
        status: { type: 'string' }
      }
    }
  }
});

/**
 * 消息列表响应序列化器
 */
export const stringifyMessagesResponse = fastJson({
  title: 'MessagesResponse',
  type: 'object',
  properties: {
    message: { type: 'integer' },
    detail: {
      type: 'object',
      properties: {
        messages: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              fromDevice: { type: 'string' },
              fromGroup: { type: 'string' },
              data: {}
            }
          }
        }
      }
    }
  }
});

/**
 * Bridge 设备消息序列化器（跨 broker 设备消息）
 */
export const stringifyBridgeMessage = fastJson({
  title: 'BridgeMessage',
  type: 'object',
  properties: {
    fromBroker: { type: 'string' },
    fromDevice: { type: 'string' },
    toDevice: { type: 'string' },
    data: {}  // any type
  },
  required: ['fromBroker', 'fromDevice', 'toDevice', 'data']
});

/**
 * Bridge 组消息序列化器（跨 broker 组消息）
 */
export const stringifyBridgeGroupMessage = fastJson({
  title: 'BridgeGroupMessage',
  type: 'object',
  properties: {
    fromBroker: { type: 'string' },
    fromDevice: { type: 'string' },
    toGroup: { type: 'string' },
    data: {}  // any type
  },
  required: ['fromBroker', 'fromDevice', 'toGroup', 'data']
});

/**
 * Bridge 共享同步消息序列化器
 */
export const stringifyBridgeShareSyncMessage = fastJson({
  title: 'BridgeShareSyncMessage',
  type: 'object',
  properties: {
    fromBroker: { type: 'string' },
    devices: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          uuid: { type: 'string' },
          clientId: { type: ['string', 'null'] },
          permissions: { type: 'string' }
        },
        required: ['uuid', 'permissions']
      }
    }
  },
  required: ['fromBroker', 'devices']
});

/**
 * Bridge 共享数据推送消息序列化器
 */
export const stringifyBridgeShareDataMessage = fastJson({
  title: 'BridgeShareDataMessage',
  type: 'object',
  properties: {
    fromBroker: { type: 'string' },
    fromDevice: { type: 'string' },
    deviceUuid: { type: 'string' },
    data: {}  // any type
  },
  required: ['fromBroker', 'fromDevice', 'deviceUuid', 'data']
});
