# 点灯Broker Lite

点灯Broker Lite 是一个基于 Node.js 的轻量级 MQTT Broker 服务。  
以 [Aedes](https://github.com/moscajs/aedes) 为核心组件，[Fastify](https://fastify.dev/) 提供 HTTP 服务，使用 Map 缓存，SQLite 做持久化。  
设备端可以是手机 App、Web 页面、ESP32、Arduino 等，可通过 MQTT 或 HTTP 接入；  
同时提供 Web 用户接口服务（`/user/*`），用于设备管理和调试。

## 快速开始

### 开发模式
```bash
npm install
npm start          # 启动所有服务 (MQTT Broker + Web 用户接口)
npm run dev        # 仅启动 MQTT Broker (开发模式)
npm run dev:web    # 仅启动 Web 用户接口服务 (开发模式)
```

### 构建生产版本
```bash
npm run build      # 构建到 dist 目录
```

构建后的使用方法：
```bash
cd dist
npm install
node cli.js        # 启动所有服务
node cli.js broker # 仅启动 MQTT Broker
node cli.js web    # 仅启动 Web 用户接口服务
```

### CLI 命令
```bash
node cli.js [命令] [选项]

命令:
  all, start    启动所有服务 (MQTT Broker + Web 用户接口) [默认]
  broker        仅启动 MQTT Broker 服务
  web           仅启动 Web 用户接口服务
  help          显示帮助信息
  version       显示版本信息

选项:
  --verbose, -V 启用详细日志输出
```

### 环境变量

支持通过 `.env` 文件或系统环境变量进行配置：

| 变量名 | 默认值 | 说明 |
|--------|--------|------|
| `MQTT_PORT` | `1883` | MQTT 服务端口 |
| `MQTT_HOST` | `0.0.0.0` | MQTT 服务监听地址 |
| `HTTP_PORT` | `3000` | 设备端 HTTP API 端口 |
| `HTTP_HOST` | `0.0.0.0` | 设备端 HTTP 监听地址 |
| `WEB_PORT` | `3001` | Web 用户接口服务端口 |
| `LOG_LEVEL` | - | 日志级别 (none/error/warn/info/debug) |
| `USER_TOKEN` | - | 用户接口认证 Token，留空则不需认证 |
| `DB_FILENAME` | `broker.db` | 数据库文件名（相对于 data 目录） |
| `MESSAGE_MAX_LENGTH` | `1024` | 消息最大长度（字节） |
| `PUBLISH_RATE_LIMIT` | `1000` | 发布频率限制（毫秒） |
| `MESSAGE_EXPIRE_TIME` | `120000` | HTTP 消息暂存过期时间（毫秒） |
| `TIMESERIES_RETENTION_DAYS` | `30` | 时序数据保留天数 |
| `BRIDGE_ENABLED` | `false` | 是否启用 Bridge 跨 Broker 通信 |
| `BROKER_ID` | - | 本 Broker 唯一标识（首次启动自动生成） |
| `BRIDGE_TOKEN` | - | Bridge 连接 Token（首次启动自动生成） |

首次运行会自动创建和初始化数据库。

## 📚 API 文档

详细接口文档已按功能拆分至 `docs/` 目录：

| 文档 | 说明 | 基础URL |
|------|------|---------|
| [API 总览](docs/API.md) | 接口概览、错误码汇总、限制机制汇总 | - |
| [HTTP 接口文档](docs/API-HTTP.md) | 设备注册、上线、HTTP 消息通信 | `http://localhost:3000` |
| [MQTT 接口文档](docs/API-MQTT.md) | MQTT 连接、设备/组消息发布与订阅 | `mqtt://localhost:1883` |
| [Web 用户接口文档](docs/API-User.md) | 用户接口，设备管理和调试 | `http://localhost:3001` |
| [定时任务接口文档](docs/API-Schedule.md) | 定时执行、倒计时、循环执行 | `http://localhost:3000` |
| [Bridge 桥接文档](docs/API-Bridge.md) | 跨 Broker 通信，多 Broker 设备互联 | - |

## 限制机制
1. 一个 authKey 只能一个设备使用，每次获取连接信息都将重置连接凭证
2. 设备只能发布和订阅属于自身的 Topic，操作其他 Topic 将被断开连接
3. 设备消息发布频率最高每秒 1 次，否则将被断开连接
4. 每条消息长度不能大于 1024 字节，否则将被断开连接
5. 设备只能和所在组（Group）的其他设备通信，1 个设备可以在多个组中
6. HTTP 模式设备的消息暂存 120 秒，过期自动清除
