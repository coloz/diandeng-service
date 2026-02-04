# 点灯Broker Lite - HTTP接口文档

设备端HTTP接口，用于设备注册、上线和消息通信。

**基础URL**: `http://localhost:3000`

---

## 目录
- [健康检查](#健康检查)
- [设备注册](#设备注册)
- [设备上线](#设备上线)
- [HTTP发布消息](#http发布消息)
- [HTTP获取消息](#http获取消息)
- [添加设备到组](#添加设备到组)
- [获取设备所属组](#获取设备所属组)
- [错误码](#错误码)

---

## 健康检查

检查服务运行状态。

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
    "cachedDevices": 10,
    "onlineClients": 5,
    "timestamp": "2026-01-21T10:00:00.000Z"
  }
}
```

---

## 设备注册

用于APP/WEB端创建新设备，获取设备的authKey。

**请求**
```
POST /device/auth
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
| uuid | string | 是 | 设备唯一标识 |

**响应**
```json
{
  "message": 1000,
  "detail": {
    "authKey": "a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6"
  }
}
```

> **注意**：
> - 设备注册时会自动创建一个以 `uuid` 为名称的默认组，并将设备加入该组。
> - 如果设备已存在（uuid重复），将直接返回现有的authKey，不会报错。

---

## 设备上线

设备获取连接信息，支持MQTT和HTTP两种模式。

**请求**
```
GET /device/auth?authKey={authKey}&mode={mode}
```

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| authKey | string | 是 | 设备认证密钥 |
| mode | string | 否 | 连接模式：`mqtt`(默认) 或 `http` |

**响应 - MQTT模式**
```json
{
  "message": 1000,
  "detail": {
    "mode": "mqtt",
    "host": "mqtt://localhost",
    "port": "1883",
    "clientId": "device_abc123def456",
    "username": "user_9140dxx9",
    "password": "xxxxxxxxxxxxxxxxx",
    "uuid": "9140dxx9843bxxd6bc439exxxxxxxxxx"
  }
}
```

**响应 - HTTP模式**
```json
{
  "message": 1000,
  "detail": {
    "mode": "http",
    "clientId": "device_abc123def456",
    "authKey": "a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6",
    "uuid": "9140dxx9843bxxd6bc439exxxxxxxxxx"
  }
}
```

> **注意**：每次调用此接口都会重置连接凭证（iotToken），之前的凭证将失效。

---

## HTTP发布消息

通过HTTP接口发送消息给其他设备或组（需先以HTTP模式上线）。

**请求**
```
POST /device/s
Content-Type: application/json
```

**请求体 - 发送给设备**
```json
{
  "authKey": "a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6",
  "toDevice": "device_target123",
  "data": {
    "cmd": "setState",
    "value": 1
  }
}
```

**请求体 - 发送给组**
```json
{
  "authKey": "a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6",
  "toGroup": "my_group_name",
  "data": {
    "cmd": "broadcast",
    "value": "hello"
  }
}
```

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| authKey | string | 是 | 设备认证密钥 |
| toDevice | string | 否* | 目标设备的clientId |
| toGroup | string | 否* | 目标组名称 |
| data | object | 是 | 承载数据（不能为空） |

> *toDevice 和 toGroup 至少需要一个

**响应**
```json
{
  "message": 1000,
  "detail": {
    "status": "published"
  }
}
```

> **注意**：通过HTTP接口发布的消息仅会暂存给以HTTP模式上线的目标设备。如果目标设备是MQTT模式，需要通过MQTT协议发送消息。

---

## HTTP获取消息

获取暂存的消息（仅HTTP模式设备可用）。消息暂存时间为120秒，获取后自动清除。

**请求**
```
GET /device/r?authKey={authKey}
```

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| authKey | string | 是 | 设备认证密钥 |

**响应**
```json
{
  "message": 1000,
  "detail": {
    "messages": [
      {
        "fromDevice": "device_sender123",
        "data": {
          "cmd": "setState",
          "value": 1
        }
      },
      {
        "fromGroup": "my_group",
        "fromDevice": "device_sender456",
        "data": {
          "cmd": "broadcast",
          "value": "hello"
        }
      }
    ],
    "count": 2
  }
}
```

> **注意**：只有以HTTP模式上线的设备才能使用此接口。

---

## 添加设备到组

将设备添加到指定组，用于组内通信。

**请求**
```
POST /device/group
Content-Type: application/json
```

**请求体**
```json
{
  "authKey": "a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6",
  "groupName": "my_group_name"
}
```

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| authKey | string | 是 | 设备认证密钥 |
| groupName | string | 是 | 组名称（不存在则自动创建） |

**响应**
```json
{
  "message": 1000,
  "detail": {
    "status": "added",
    "groupName": "my_group_name"
  }
}
```

---

## 获取设备所属组

查询设备所在的所有组。

**请求**
```
GET /device/groups?authKey={authKey}
```

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| authKey | string | 是 | 设备认证密钥 |

**响应**
```json
{
  "message": 1000,
  "detail": {
    "groups": ["default_group", "my_group_name"]
  }
}
```

---

## 错误码

| 错误码 | 说明 |
|--------|------|
| 1000 | 成功 |
| 1001 | 参数错误 |
| 1002 | 服务器内部错误 |
| 1003 | 设备不存在 |
| 1004 | 消息长度超过限制（最大1024字节） |
| 1005 | 发布频率过高（每秒最多1条） |
| 1006 | 无权操作该组 |
| 1007 | 设备未上线或未以HTTP模式上线 |

---

## 限制机制

| 限制项 | 说明 |
|--------|------|
| authKey唯一性 | 一个authKey只能一个设备使用，每次获取连接信息都将重置iotToken |
| 发布频率 | 每秒最多发布1条消息，超过将返回错误码1005 |
| 消息长度 | 每条消息不能大于1024字节 |
| 组权限 | 设备只能和所在组的其他设备通信，1个设备可以在多个组中 |
| HTTP消息暂存 | HTTP模式设备的消息暂存120秒，过期自动清除 |
