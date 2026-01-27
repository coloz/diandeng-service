const Fastify = require('fastify');
const http = require('http');
const ws = require('websocket-stream');
const Aedes = require('aedes');
const { initDatabase } = require('../src/database');
const { setupWebRoutes } = require('./routes');

// Web管理面板配置
const config = {
  http: {
    port: process.env.WEB_PORT || 3001,
    host: '0.0.0.0'
  },
  ws: {
    port: process.env.WS_PORT || 8083,
    host: '0.0.0.0'
  }
};

async function main() {
  // 初始化数据库（共享同一个数据库）
  console.log('正在初始化数据库连接...');
  initDatabase();
  console.log('数据库连接完成');

  // 创建一个轻量级的MQTT代理用于Web测试
  // 这个代理不做认证，仅用于Web界面测试
  const aedes = Aedes();

  // 创建WebSocket服务器用于MQTT over WebSocket
  const wsServer = http.createServer();
  ws.createServer({ server: wsServer }, aedes.handle);
  
  wsServer.listen(config.ws.port, config.ws.host, () => {
    console.log(`MQTT WebSocket (测试用) 已启动，监听端口: ${config.ws.port}`);
  });

  // 创建Fastify HTTP服务器
  const fastify = Fastify({
    logger: true
  });

  // 设置Web管理路由
  setupWebRoutes(fastify);

  // 启动HTTP服务器
  try {
    await fastify.listen({
      port: config.http.port,
      host: config.http.host
    });
    console.log(`Web 管理面板已启动: http://localhost:${config.http.port}`);
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }

  // 优雅关闭
  process.on('SIGINT', () => {
    console.log('\n正在关闭Web服务...');
    aedes.close(() => {
      console.log('测试MQTT代理已关闭');
      wsServer.close(() => {
        console.log('WebSocket Server 已关闭');
        fastify.close(() => {
          console.log('HTTP Server 已关闭');
          process.exit(0);
        });
      });
    });
  });
}

main().catch(console.error);
