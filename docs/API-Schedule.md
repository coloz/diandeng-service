# 点灯Broker Lite - 定时任务接口文档

定时任务HTTP接口，用于创建、修改、查询和取消定时任务。

**基础URL**: `http://localhost:3000`

---

## 目录
- [创建定时任务](#创建定时任务)
- [修改定时任务](#修改定时任务)
- [取消定时任务](#取消定时任务)
- [查询定时任务](#查询定时任务)
- [执行模式说明](#执行模式说明)
- [错误码](#错误码)

---

## 创建定时任务

创建一个新的定时任务，支持三种执行模式：定时执行、倒计时执行、循环执行。

**请求**
```
POST /schedule
Content-Type: application/json
```

**请求体**
```json
{
  "authKey": "string",      // 必填，发起者设备的authKey
  "toDevice": "string",     // 必填，目标设备的clientId
  "command": {},            // 必填，要发送给目标设备的指令数据（任意JSON格式）
  "mode": "string",         // 必填，执行模式：scheduled | countdown | recurring
  "executeAt": 1738800000000,  // scheduled模式必填，执行时间戳（毫秒）
  "countdown": 60,          // countdown模式必填，倒计时秒数
  "interval": 300           // recurring模式必填，循环间隔秒数
}
```

### 示例：定时执行

在指定时间点执行一次任务。

```json
{
  "authKey": "abc123def456",
  "toDevice": "device_client_id",
  "command": { "action": "turn_on", "brightness": 100 },
  "mode": "scheduled",
  "executeAt": 1738800000000
}
```

### 示例：倒计时执行

从当前时间开始倒计时N秒后执行一次任务。

```json
{
  "authKey": "abc123def456",
  "toDevice": "device_client_id",
  "command": { "action": "turn_off" },
  "mode": "countdown",
  "countdown": 300
}
```

### 示例：循环执行

每隔N秒重复执行任务。

```json
{
  "authKey": "abc123def456",
  "toDevice": "device_client_id",
  "command": { "action": "report_status" },
  "mode": "recurring",
  "interval": 60,
  "executeAt": 1738800000000
}
```

> **注意**: `recurring`模式下，`executeAt`可选。如果不提供，首次执行时间为当前时间 + interval。

**成功响应**
```json
{
  "message": 1000,
  "detail": {
    "taskId": "a1b2c3d4e5f6g7h8",
    "deviceId": "device_client_id",
    "mode": "scheduled",
    "executeAt": 1738800000000,
    "interval": null,
    "createdAt": 1738700000000
  }
}
```

---

## 修改定时任务

修改已创建的定时任务，可以更新指令、执行模式、执行时间或启用/禁用任务。

**请求**
```
PUT /schedule
Content-Type: application/json
```

**请求体**
```json
{
  "authKey": "string",      // 必填，设备的authKey
  "taskId": "string",       // 必填，要修改的任务ID
  "command": {},            // 可选，新的指令数据
  "mode": "string",         // 可选，新的执行模式
  "executeAt": 1738800000000,  // 可选，新的执行时间戳
  "countdown": 60,          // 可选，新的倒计时秒数
  "interval": 300,          // 可选，新的循环间隔秒数
  "enabled": true           // 可选，启用/禁用任务
}
```

### 示例：修改执行时间

```json
{
  "authKey": "abc123def456",
  "taskId": "a1b2c3d4e5f6g7h8",
  "executeAt": 1738900000000
}
```

### 示例：禁用任务

```json
{
  "authKey": "abc123def456",
  "taskId": "a1b2c3d4e5f6g7h8",
  "enabled": false
}
```

### 示例：修改为倒计时模式

```json
{
  "authKey": "abc123def456",
  "taskId": "a1b2c3d4e5f6g7h8",
  "mode": "countdown",
  "countdown": 120
}
```

**成功响应**
```json
{
  "message": 1000,
  "detail": {
    "taskId": "a1b2c3d4e5f6g7h8",
    "deviceId": "device_client_id",
    "command": { "action": "turn_on" },
    "mode": "countdown",
    "executeAt": 1738700120000,
    "interval": null,
    "enabled": true
  }
}
```

---

## 取消定时任务

取消（删除）一个已创建的定时任务。

**请求**
```
DELETE /schedule
Content-Type: application/json
```

**请求体**
```json
{
  "authKey": "string",      // 必填，设备的authKey
  "taskId": "string"        // 必填，要取消的任务ID
}
```

**示例**
```json
{
  "authKey": "abc123def456",
  "taskId": "a1b2c3d4e5f6g7h8"
}
```

**成功响应**
```json
{
  "message": 1000,
  "detail": {
    "status": "cancelled",
    "taskId": "a1b2c3d4e5f6g7h8"
  }
}
```

---

## 查询定时任务

查询与指定设备相关的所有定时任务。

**请求**
```
GET /schedule?authKey={authKey}
```

**参数**
| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| authKey | string | 是 | 设备的authKey |

**成功响应**
```json
{
  "message": 1000,
  "detail": {
    "tasks": [
      {
        "taskId": "a1b2c3d4e5f6g7h8",
        "deviceId": "device_client_id",
        "command": { "action": "turn_on" },
        "mode": "scheduled",
        "executeAt": 1738800000000,
        "interval": null,
        "createdAt": 1738700000000,
        "lastExecutedAt": null,
        "enabled": true
      },
      {
        "taskId": "b2c3d4e5f6g7h8i9",
        "deviceId": "device_client_id",
        "command": { "action": "report_status" },
        "mode": "recurring",
        "executeAt": 1738800060000,
        "interval": 60000,
        "createdAt": 1738700000000,
        "lastExecutedAt": 1738800000000,
        "enabled": true
      }
    ],
    "count": 2,
    "stats": {
      "totalTasks": 5,
      "enabledTasks": 4,
      "recurringTasks": 2
    }
  }
}
```

---

## 执行模式说明

| 模式 | 值 | 必需参数 | 说明 |
|------|------|----------|------|
| 定时执行 | `scheduled` | `executeAt` | 在指定的时间戳执行一次任务，执行后自动删除 |
| 倒计时执行 | `countdown` | `countdown` | 从创建时刻开始倒计时N秒后执行一次，执行后自动删除 |
| 循环执行 | `recurring` | `interval` | 每隔N秒重复执行任务，不会自动删除，需手动取消 |

### 时间说明

- `executeAt`: 时间戳，单位为**毫秒**（JavaScript Date.now() 格式）
- `countdown`: 倒计时，单位为**秒**
- `interval`: 循环间隔，单位为**秒**

### 任务状态

- `enabled: true` - 任务启用，到期会执行
- `enabled: false` - 任务禁用，到期不会执行，但任务仍保留

---

## 任务执行

当任务到期时，Broker会向目标设备发送指令：

**MQTT设备**: 消息发送到 `/device/{clientId}/r` 主题

**HTTP设备**: 消息暂存在服务器，设备通过 `GET /device/r` 获取

**消息格式**
```json
{
  "fromDevice": "__scheduler__",
  "data": { /* 创建任务时设置的command内容 */ }
}
```

---

## 错误码

| 错误码 | 说明 |
|--------|------|
| 1000 | 成功 |
| 1001 | 参数错误（缺少必填参数或参数格式错误） |
| 1002 | 服务器内部错误 |
| 1003 | 设备不存在 |
| 1008 | 任务不存在 |

**错误响应示例**
```json
{
  "message": 1001,
  "detail": "authKey为必填参数"
}
```

---

## 接口总览

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/schedule` | 创建定时任务 |
| PUT | `/schedule` | 修改定时任务 |
| DELETE | `/schedule` | 取消定时任务 |
| GET | `/schedule?authKey=xxx` | 查询定时任务 |
