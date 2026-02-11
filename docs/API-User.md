# 点灯Broker Lite - Web用户接口文档

Web用户接口，用于设备管理和调试。用户可通过网页、App请求相关接口。

**基础URL**: `http://localhost:3001`

> **说明**：Web用户接口运行在独立端口（默认3001），与设备端接口分离。

---

## 认证

所有 `/user/*` 接口需要通过 `Authorization` 请求头提供 User Token 进行认证。

**请求头格式**
```
Authorization: Bearer your_user_token_here
```

或直接传递 Token：
```
Authorization: your_user_token_here
```

> **注意**：
> - User Token 在 `.env` 文件中通过 `USER_TOKEN` 配置
> - 如果未配置 `USER_TOKEN`，则不需要认证（仅建议开发环境使用）
> - 认证失败将返回错误码 1008

---

## 目录
- [健康检查](#健康检查)
- [获取所有设备](#获取所有设备)
- [获取设备详情](#获取设备详情)
- [创建设备](#创建设备)
- [获取设备连接凭证](#获取设备连接凭证)
- [查询时序数据](#查询时序数据)
- [Bridge 远程 Broker 管理](#bridge-远程-broker-管理)
  - [获取 Bridge 信息](#获取-bridge-信息)
  - [添加远程 Broker](#添加远程-broker)
  - [修改远程 Broker](#修改远程-broker)
  - [删除远程 Broker](#删除远程-broker)
- [错误码](#错误码)

---

## 健康检查

检查Web用户服务运行状态。（无需认证）

**请求**
```
GET /health
```

**响应**
```json
{
  "message": 1000,
  "detail": {
    "status": "ok",
    "service": "web-user",
    "timestamp": "2026-01-21T10:00:00.000Z"
  }
}
```

---

## 获取所有设备

获取系统中所有已注册的设备列表。

**请求**
```
GET /user/devices
Authorization: Bearer your_user_token
```

**响应**
```json
{
  "message": 1000,
  "detail": {
    "devices": [
      {
        "id": 1,
        "uuid": "9140dxx9843bxxd6bc439exxxxxxxxxx",
        "auth_key": "a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6",
        "client_id": "device_abc123def456",
        "username": "user_9140dxx9",
        "password": "xxxxxxxxxxxxxxxxx",
        "created_at": "2026-01-21T10:00:00.000Z",
        "updated_at": "2026-01-21T10:00:00.000Z"
      }
    ],
    "total": 1
  }
}
```

---

## 获取设备详情

获取单个设备的详细信息及所属组。

**请求**
```
GET /user/device/:uuid
```

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| uuid | string | 是 | 设备唯一标识（路径参数） |

**响应**
```json
{
  "message": 1000,
  "detail": {
    "id": 1,
    "uuid": "9140dxx9843bxxd6bc439exxxxxxxxxx",
    "auth_key": "a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6",
    "client_id": "device_abc123def456",
    "username": "user_9140dxx9",
    "password": "xxxxxxxxxxxxxxxxx",
    "created_at": "2026-01-21T10:00:00.000Z",
    "updated_at": "2026-01-21T10:00:00.000Z",
    "groups": ["9140dxx9843bxxd6bc439exxxxxxxxxx", "my_group_name"]
  }
}
```

---

## 创建设备

通过用户接口创建新设备，uuid可选（自动生成）。

**请求**
```
POST /user/device
Content-Type: application/json
```

**请求体**
```json
{
  "uuid": "9140dxx9843bxxd6bc439exxxxxxxxxx"
}
```

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| uuid | string | 否 | 设备唯一标识（不提供则自动生成） |

**响应**
```json
{
  "message": 1000,
  "detail": {
    "uuid": "9140dxx9843bxxd6bc439exxxxxxxxxx",
    "authKey": "a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6"
  }
}
```

> **注意**：
> - 如果uuid已存在，将返回错误码1001。
> - 设备创建时会自动创建一个以 `uuid` 为名称的默认组，并将设备加入该组。

---

## 获取设备连接凭证

获取或重置设备的MQTT连接凭证（用于测试）。

**请求**
```
GET /user/device/:uuid/connection
```

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| uuid | string | 是 | 设备唯一标识（路径参数） |

**响应**
```json
{
  "message": 1000,
  "detail": {
    "uuid": "9140dxx9843bxxd6bc439exxxxxxxxxx",
    "clientId": "device_abc123def456",
    "username": "user_9140dxx9",
    "password": "xxxxxxxxxxxxxxxxx"
  }
}
```

> **注意**：每次调用此接口都会重新生成连接凭证，之前的凭证将失效。

---

## 查询时序数据

查询指定设备的时序数据，支持按数据键名和时间范围过滤。

> 时序数据默认保留 30 天（可通过 `.env` 中 `TIMESERIES_RETENTION_DAYS` 配置），过期数据将自动清除。

**请求**
```
GET /user/device/:uuid/timeseries?dataKey=temperature&startTime=1707600000000&endTime=1707700000000&limit=100
Authorization: Bearer your_user_token
```

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| uuid | string | 是 | 设备唯一标识（路径参数） |
| dataKey | string | 否 | 数据键名，不传则返回所有键的数据 |
| startTime | number | 否 | 起始时间戳（毫秒） |
| endTime | number | 否 | 结束时间戳（毫秒） |
| limit | number | 否 | 返回条数限制，默认100，最大1000 |

**响应**
```json
{
  "message": 1000,
  "detail": {
    "deviceUuid": "9140dxx9843bxxd6bc439exxxxxxxxxx",
    "dataKey": "temperature",
    "total": 3,
    "data": [
      {
        "device_uuid": "9140dxx9843bxxd6bc439exxxxxxxxxx",
        "data_key": "temperature",
        "value": 26.5,
        "timestamp": 1707690000000,
        "created_at": "2026-02-11T10:00:00.000Z"
      },
      {
        "device_uuid": "9140dxx9843bxxd6bc439exxxxxxxxxx",
        "data_key": "temperature",
        "value": 25.8,
        "timestamp": 1707680000000,
        "created_at": "2026-02-11T09:30:00.000Z"
      },
      {
        "device_uuid": "9140dxx9843bxxd6bc439exxxxxxxxxx",
        "data_key": "temperature",
        "value": 25.1,
        "timestamp": 1707670000000,
        "created_at": "2026-02-11T09:00:00.000Z"
      }
    ]
  }
}
```

> **说明**：返回结果按时间戳降序排列（最新数据在前）。

---

## Bridge 远程 Broker 管理

管理跨 Broker 通信的远程 Broker 列表。所有变更即时生效（自动连接/断开远程 Broker）。

> 首次启动程序时会自动生成 `BROKER_ID` 和 `BRIDGE_TOKEN` 并写入 `.env`。

### 获取 Bridge 信息

获取本机 Bridge 配置及所有远程 Broker 列表。

**请求**
```
GET /user/broker
Authorization: Bearer your_user_token
```

**响应**
```json
{
  "message": 1000,
  "detail": {
    "brokerId": "broker-a3f8e29c1b4d6e70",
    "bridgeToken": "4f8a...",
    "enabled": true,
    "remotes": [
      {
        "id": 1,
        "brokerId": "broker-b",
        "url": "mqtt://192.168.1.100:1883",
        "token": "remote_bridge_token",
        "enabled": true,
        "connected": true,
        "created_at": "2026-02-10T10:00:00.000Z",
        "updated_at": "2026-02-10T10:00:00.000Z"
      }
    ],
    "total": 1
  }
}
```

---

### 添加远程 Broker

添加一个新的远程 Broker 并立即建立连接。

**请求**
```
POST /user/broker
Content-Type: application/json
Authorization: Bearer your_user_token
```

**请求体**
```json
{
  "brokerId": "broker-b",
  "url": "mqtt://192.168.1.100:1883",
  "token": "对方的 BRIDGE_TOKEN"
}
```

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| brokerId | string | 是 | 远程 Broker 的 BROKER_ID |
| url | string | 是 | 远程 Broker 的 MQTT 地址 |
| token | string | 是 | 远程 Broker 的 BRIDGE_TOKEN |

**响应**
```json
{
  "message": 1000,
  "detail": {
    "brokerId": "broker-b",
    "url": "mqtt://192.168.1.100:1883",
    "status": "added"
  }
}
```

---

### 修改远程 Broker

修改远程 Broker 的连接信息或启用/禁用状态。变更即时生效。

**请求**
```
PUT /user/broker/:brokerId
Content-Type: application/json
Authorization: Bearer your_user_token
```

**请求体**（所有字段可选）
```json
{
  "url": "mqtt://new-host:1883",
  "token": "new_token",
  "enabled": false
}
```

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| url | string | 否 | 新的 MQTT 地址 |
| token | string | 否 | 新的 BRIDGE_TOKEN |
| enabled | boolean | 否 | 是否启用连接 |

**响应**
```json
{
  "message": 1000,
  "detail": {
    "brokerId": "broker-b",
    "status": "updated"
  }
}
```

---

### 删除远程 Broker

删除远程 Broker 并立即断开连接。

**请求**
```
DELETE /user/broker/:brokerId
Authorization: Bearer your_user_token
```

**响应**
```json
{
  "message": 1000,
  "detail": {
    "brokerId": "broker-b",
    "status": "deleted"
  }
}
```

---

## 错误码

| 错误码 | 说明 |
|--------|------|
| 1000 | 成功 |
| 1001 | 参数错误 / UUID已存在 |
| 1002 | 服务器内部错误 |
| 1003 | 设备不存在 |
| 1008 | 未授权访问（User Token 无效或缺失） |
