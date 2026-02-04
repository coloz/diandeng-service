# 点灯Broker Lite - Web管理接口文档

Web管理接口，用于设备管理和调试。

**基础URL**: `http://localhost:3001`

> **说明**：Web管理接口运行在独立端口（默认3001），与设备端接口分离。

---

## 认证

所有 `/admin/*` 接口需要通过 `Authorization` 请求头提供 Admin Token 进行认证。

**请求头格式**
```
Authorization: Bearer your_admin_token_here
```

或直接传递 Token：
```
Authorization: your_admin_token_here
```

> **注意**：
> - Admin Token 在 `.env` 文件中通过 `ADMIN_TOKEN` 配置
> - 如果未配置 `ADMIN_TOKEN`，则不需要认证（仅建议开发环境使用）
> - 认证失败将返回错误码 1008

---

## 目录
- [管理端健康检查](#管理端健康检查)
- [获取所有设备](#获取所有设备)
- [获取设备详情](#获取设备详情)
- [创建设备](#创建设备)
- [获取设备连接凭证](#获取设备连接凭证)
- [错误码](#错误码)

---

## 管理端健康检查

检查Web管理服务运行状态。（无需认证）

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
    "service": "web-admin",
    "timestamp": "2026-01-21T10:00:00.000Z"
  }
}
```

---

## 获取所有设备

获取系统中所有已注册的设备列表。

**请求**
```
GET /admin/devices
Authorization: Bearer your_admin_token
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
        "iot_token": "xxxxxxxxxxxxxxxxx",
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
GET /admin/device/:uuid
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
    "iot_token": "xxxxxxxxxxxxxxxxx",
    "created_at": "2026-01-21T10:00:00.000Z",
    "updated_at": "2026-01-21T10:00:00.000Z",
    "groups": ["9140dxx9843bxxd6bc439exxxxxxxxxx", "my_group_name"]
  }
}
```

---

## 创建设备

通过管理接口创建新设备，uuid可选（自动生成）。

**请求**
```
POST /admin/device
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
GET /admin/device/:uuid/connection
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

## 错误码

| 错误码 | 说明 |
|--------|------|
| 1000 | 成功 |
| 1001 | 参数错误 / UUID已存在 |
| 1002 | 服务器内部错误 |
| 1003 | 设备不存在 |
| 1008 | 未授权访问（Admin Token 无效或缺失） |
