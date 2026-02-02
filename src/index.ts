import Aedes from 'aedes';
import { createServer } from 'net';
import Fastify from 'fastify';
import { initDatabase } from './database';
import { setupRoutes } from './routes';
import { setupBroker } from './broker';
import { deviceCache } from './cache';
import config from './config';

async function main(): Promise<void> {
  // 初始化数据库
  console.log('正在初始化数据库...');
  initDatabase();
  console.log('数据库初始化完成');

  // 创建Aedes实例
  const aedes = new Aedes();

  // 设置Broker逻辑
  setupBroker(aedes, deviceCache);

  // 创建MQTT服务器
  const mqttServer = createServer(aedes.handle);

  mqttServer.listen(config.mqtt.port, config.mqtt.host, () => {
    console.log(`MQTT Broker 已启动，监听端口: ${config.mqtt.port}`);
  });

  // 创建Fastify HTTP服务器
  const fastify = Fastify({
    logger: true
  });

  // 设置HTTP路由
  setupRoutes(fastify, deviceCache);

  // 启动HTTP服务器
  try {
    await fastify.listen({
      port: config.http.port,
      host: config.http.host
    });
    console.log(`HTTP 服务已启动，监听端口: ${config.http.port}`);
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }

  // 优雅关闭
  process.on('SIGINT', () => {
    console.log('\n正在关闭服务...');
    aedes.close(() => {
      console.log('MQTT Broker 已关闭');
      mqttServer.close(() => {
        console.log('MQTT Server 已关闭');
        fastify.close(() => {
          console.log('HTTP Server 已关闭');
          process.exit(0);
        });
      });
    });
  });
}

main().catch(console.error);
