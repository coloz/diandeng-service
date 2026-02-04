# 点灯Broker Lite API文档

本项目提供三类接口，文档已按类型拆分：

## 📚 文档索引

| 文档 | 说明 | 基础URL |
|------|------|---------|
| [HTTP接口文档](docs/API-HTTP.md) | 设备端HTTP接口，用于设备注册、上线和消息通信 | `http://localhost:3000` |
| [Web管理接口文档](docs/API-Admin.md) | 管理端接口，用于设备管理和调试 | `http://localhost:3001` |
| [MQTT接口文档](docs/API-MQTT.md) | MQTT协议接口，用于设备实时消息通信 | `mqtt://localhost:1883` |

---

## 快速开始

### 1. 设备注册
```bash
curl -X POST http://localhost:3000/device/auth \
  -H "Content-Type: application/json" \
  -d '{"uuid": "your_device_uuid"}'
```

### 2. 设备上线（获取MQTT连接信息）
```bash
curl "http://localhost:3000/device/auth?authKey=your_auth_key&mode=mqtt"
```

### 3. 连接MQTT Broker
使用返回的 `clientId`、`username`、`password` 连接到 `mqtt://localhost:1883`

---

## 错误码汇总

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
| 1008 | 未授权访问（Admin Token 无效） |

---

## 限制机制汇总

| 限制项 | 说明 |
|--------|------|
| authKey唯一性 | 一个authKey只能一个设备使用，每次获取连接信息都将重置连接凭证 |
| Topic权限 | 设备只能发布和订阅属于自身的topic，否则将被断开连接 |
| 发布频率 | 每秒最多发布1条消息，超过将被断开连接 |
| 消息长度 | 每条消息不能大于1024字节，否则将被断开连接 |
| 组权限 | 设备只能和所在组的其他设备通信，1个设备可以在多个组中 |
| HTTP消息暂存 | HTTP模式设备的消息暂存120秒，过期自动清除 |

