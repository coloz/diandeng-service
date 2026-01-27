# 点灯Broker Lite

轻量级 MQTT Broker 服务，基于 Node.js 构建。

## 快速开始

### 安装依赖

```bash
npm install
```

### 启动服务

```bash
# 启动所有服务 (MQTT Broker + Web 管理面板)
node cli.js

# 或使用 npm 脚本
npm start
```

### CLI 命令

```bash
node cli.js [命令]

命令:
  all, start    启动所有服务 (MQTT Broker + Web 管理面板) [默认]
  broker        仅启动 MQTT Broker 服务
  web           仅启动 Web 管理面板
  help          显示帮助信息
  version       显示版本信息
```

### npm 脚本

```bash
npm start          # 启动所有服务
npm run broker     # 仅启动 MQTT Broker
npm run web        # 仅启动 Web 管理面板
npm run all        # 启动所有服务
```

## 环境变量

| 变量名 | 默认值 | 说明 |
|--------|--------|------|
| MQTT_PORT | 1883 | MQTT 服务端口 |
| HTTP_PORT | 3000 | HTTP API 端口 |
| WEB_PORT | 3001 | Web 管理面板端口 |
| WS_PORT | 8083 | WebSocket 端口 (MQTT over WS) |

示例：
```bash
MQTT_PORT=1884 WEB_PORT=8080 node cli.js
```

## 服务端口

| 服务 | 默认端口 | 说明 |
|------|----------|------|
| MQTT Broker | 1883 | MQTT 协议连接 |
| HTTP API | 3000 | 设备认证和数据接口 |
| Web 管理面板 | 3001 | 浏览器访问管理界面 |
| WebSocket | 8083 | MQTT over WebSocket |

## 目录结构

```
dist/
├── cli.js          # CLI 入口文件
├── package.json    # 依赖配置
├── data/           # 数据库存储目录
├── src/            # MQTT Broker 后端
│   ├── index.js    # Broker 入口
│   ├── broker.js   # Broker 逻辑
│   ├── config.js   # 配置文件
│   ├── database.js # 数据库操作
│   ├── cache.js    # 缓存管理
│   └── routes.js   # HTTP 路由
└── web/
    ├── index.js    # Web 服务入口
    ├── routes.js   # Web API 路由
    └── public/     # 前端静态文件
```

## 访问服务

启动后访问：
- **Web 管理面板**: http://localhost:3001
- **HTTP API**: http://localhost:3000
- **MQTT 连接**: mqtt://localhost:1883
- **MQTT WebSocket**: ws://localhost:8083

## 许可证

MIT License
