# Bridge 跨 Broker 通信

## 概述

Bridge（桥接）模块允许多个独立部署的 Broker 实例之间进行设备消息互通。设备可以向其它 Broker 上的设备发送消息，也可以跨 Broker 进行组消息广播。

## 架构

```
Broker A (broker-a)              Broker B (broker-b)
┌─────────────────┐              ┌─────────────────┐
│  Device 1       │              │  Device 3       │
│  Device 2       │   ◄─MQTT─►  │  Device 4       │
│  Bridge 模块 ────┼──────────────┼──── Bridge 模块 │
└─────────────────┘              └─────────────────┘
```

- 每个 Broker 拥有唯一 `brokerId`（首次启动时自动生成）
- Broker 之间通过 MQTT 协议互连：每个 Bridge 模块作为 MQTT 客户端连接到远程 Broker
- 使用专用的 `/bridge/` topic 命名空间，与设备 topic 隔离
- 远程 Broker 列表存储在数据库中，通过 `/user/broker` 接口管理

## 自动初始化

首次运行 `node cli.js start` 时，程序会自动：

1. 生成唯一的 `BROKER_ID`（如 `broker-a3f8e29c1b4d6e70`）
2. 生成随机的 `BRIDGE_TOKEN`（64 字符十六进制）
3. 设置 `BRIDGE_ENABLED=true`
4. 将以上配置写入 `.env` 文件

无需手动配置，开箱即用。

## 配置

### 环境变量（.env 自动生成）

```env
# 首次启动时自动生成，无需手动设置
BROKER_ID=broker-a3f8e29c1b4d6e70
BRIDGE_TOKEN=4f8a...（64字符）
BRIDGE_ENABLED=true

# 可选：断线重连间隔（毫秒，默认 5000）
BRIDGE_RECONNECT_INTERVAL=5000
```

### 配置项说明

| 配置项 | 环境变量 | 默认值 | 说明 |
|--------|----------|--------|------|
| brokerId | `BROKER_ID` | 自动生成 | 本 Broker 唯一标识 |
| token | `BRIDGE_TOKEN` | 自动生成 | 本 Broker 接受其它 Broker 连接时校验的密钥 |
| enabled | `BRIDGE_ENABLED` | true（首次自动设置） | 是否启用 Bridge |
| reconnectInterval | `BRIDGE_RECONNECT_INTERVAL` | 5000 | 断线重连间隔（毫秒） |

## 管理远程 Broker

远程 Broker 列表通过 `/user/broker` 接口管理，存储在数据库中。所有变更即时生效（自动连接/断开）。

详见 [Web用户接口文档 - Bridge管理](API-User.md#bridge-远程-broker-管理)。

### 快速添加远程 Broker

```bash
curl -X POST http://localhost:3001/user/broker \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer your_user_token" \
  -d '{
    "brokerId": "broker-b",
    "url": "mqtt://192.168.1.100:1883",
    "token": "broker_b_的_BRIDGE_TOKEN"
  }'
```

## 设备寻址

### 格式

| 场景 | `toDevice` / `toGroup` | 示例 |
|------|------------------------|------|
| 本地设备 | `{clientId}` | `"abc123"` |
| 远程设备 | `{brokerId}:{clientId}` | `"broker-b:xyz789"` |
| 远程组 | `{brokerId}:{groupName}` | `"broker-b:living-room"` |

> 不含 `:` 的地址自动识别为本地设备/组，**完全向下兼容**。

### MQTT 设备发送跨 Broker 消息

设备照常发布到自己的 `/device/{clientId}/s` topic，但 `toDevice` 使用远程格式：

```json
{
  "toDevice": "broker-b:target_client_id",
  "data": { "cmd": "on", "value": 1 }
}
```

### HTTP 设备发送跨 Broker 消息

```bash
curl -X POST http://localhost:3000/device/publish \
  -H "Content-Type: application/json" \
  -d '{
    "authKey": "your_auth_key",
    "toDevice": "broker-b:target_client_id",
    "data": { "cmd": "on", "value": 1 }
  }'
```

### 接收跨 Broker 消息

跨 Broker 消息到达本地后，目标设备照常从 `/device/{clientId}/r` 收到消息。`fromDevice` 字段会包含来源 Broker 信息：

```json
{
  "fromDevice": "broker-a:sender_client_id",
  "data": { "cmd": "on", "value": 1 }
}
```

## 互联部署示例

### 双 Broker 互联

**Broker A** (IP: 192.168.1.10)

1. 首次启动后，查看 .env 中自动生成的 `BROKER_ID` 和 `BRIDGE_TOKEN`
2. 通过 API 添加 Broker B：
```bash
curl -X POST http://localhost:3001/user/broker \
  -H "Content-Type: application/json" \
  -d '{"brokerId":"broker-b-xxx","url":"mqtt://192.168.1.20:1883","token":"broker_b_的_BRIDGE_TOKEN"}'
```

**Broker B** (IP: 192.168.1.20)

1. 同上，首次启动自动生成配置
2. 通过 API 添加 Broker A：
```bash
curl -X POST http://localhost:3001/user/broker \
  -H "Content-Type: application/json" \
  -d '{"brokerId":"broker-a-xxx","url":"mqtt://192.168.1.10:1883","token":"broker_a_的_BRIDGE_TOKEN"}'
```

注意：
- 每端添加对方时，`token` 填的是对方 .env 里的 `BRIDGE_TOKEN`
- `brokerId` 填的是对方 .env 里的 `BROKER_ID`
- 两端互相添加后即可双向通信

### 三 Broker 星型拓扑

中心 Broker C 连接 Broker A 和 B，A 和 B 不直接互连：

```
A ◄──► C ◄──► B
```

在 C 上通过 API 添加 A 和 B，在 A 和 B 上分别添加 C 即可。

## Bridge 内部协议

### 认证

Bridge 客户端连接远程 Broker 时使用：

| 字段 | 值 |
|------|-----|
| clientId | `__bridge_{localBrokerId}` |
| username | `__bridge_` |
| password | 远程 Broker 的 `BRIDGE_TOKEN` |

### Topic 命名空间

| Topic | 方向 | 说明 |
|-------|------|------|
| `/bridge/device/{clientId}` | 入站 | 投递设备消息到本地设备 |
| `/bridge/group/{groupName}` | 入站 | 投递组消息到本地组 |
| `/bridge/share/sync/{brokerId}` | 出站 | 同步共享设备列表到指定远程 Broker |
| `/bridge/share/data/{brokerId}/{clientId}` | 出站 | 推送共享设备数据到指定远程 Broker |

### 消息格式

**设备消息:**

```json
{
  "fromBroker": "broker-a",
  "fromDevice": "sender_client_id",
  "toDevice": "target_client_id",
  "data": { ... }
}
```

**组消息:**

```json
{
  "fromBroker": "broker-a",
  "fromDevice": "sender_client_id",
  "toGroup": "group_name",
  "data": { ... }
}
```

## 安全说明

1. Bridge 客户端使用 `__bridge_` 前缀的 clientId，与普通设备完全隔离
2. Bridge 客户端只能操作 `/bridge/` 命名空间的 topic，无法访问设备或组的常规 topic
3. 每个 Broker 使用独立的 `BRIDGE_TOKEN`，建议使用强随机字符串
4. 建议在生产环境中使用 `mqtts://`（TLS）连接远程 Broker
5. 设备共享采用 ACL 白名单机制，未添加共享设备记录时不做限制（向下兼容），添加后仅允许白名单内的设备被远程 Broker 访问

## 设备共享

### 概述

设备共享基于 Bridge 连接实现，通过在 `/user/broker` 接口上扩展共享设备管理，无需引入独立的分享系统。核心机制：

- **ACL 白名单**：为远程 Broker 配置允许访问的本地设备列表
- **自动同步**：远程 Broker 的 Bridge 客户端连接后，自动同步共享设备列表
- **数据推送**：共享设备产生数据时，自动推送到已配置的远程 Broker
- **向下兼容**：未配置共享设备时，所有设备均可通过 Bridge 访问（保持原有行为）

### 添加远程 Broker 并共享设备（一步完成）

```bash
curl -X POST http://localhost:3001/user/broker \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer your_user_token" \
  -d '{
    "brokerId": "broker-b",
    "url": "mqtt://192.168.1.100:1883",
    "token": "broker_b_的_BRIDGE_TOKEN",
    "sharedDevices": [
      { "deviceUuid": "smart-light-01", "permissions": "readwrite" },
      { "deviceUuid": "sensor-01", "permissions": "read" }
    ]
  }'
```

### 管理共享设备

**查看共享设备列表：**
```bash
GET /user/broker/:brokerId/devices
```

**添加共享设备：**
```bash
POST /user/broker/:brokerId/devices
Body: { "deviceUuid": "smart-light-01", "permissions": "readwrite" }
```

**移除共享设备：**
```bash
DELETE /user/broker/:brokerId/devices/:uuid
```

### 查看对方共享给我的设备

```bash
GET /user/broker/:brokerId/remote-devices
```

返回通过 Bridge 同步获取的远程共享设备列表，包含设备 UUID、clientId、权限和最新数据。

### 权限说明

| 权限 | 说明 |
|------|------|
| `readwrite` | 远程 Broker 可以向该设备发送命令，也可接收设备数据推送 |
| `read` | 远程 Broker 仅可接收设备数据推送，无法发送命令 |

### 工作流程

1. **用户 A** 通过 `/user/broker` 添加用户 B 的 Broker，并指定共享设备
2. **用户 B** 通过 `/user/broker` 添加用户 A 的 Broker（建立 Bridge 连接）
3. B 的 Bridge 客户端连接到 A 后，自动收到共享设备列表同步
4. B 通过 `/user/broker/broker-a/remote-devices` 查看 A 共享的设备
5. B 的 App 使用 `brokerId:clientId` 寻址直接与 A 的共享设备通信
6. A 的共享设备产生数据时，自动推送到 B（B 通过 `remote-devices` 接口获取最新数据）
