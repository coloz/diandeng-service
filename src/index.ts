import Aedes from 'aedes';
import { createServer } from 'net';
import Fastify from 'fastify';
import { initDatabase, markInactiveHttpDevicesOffline, cleanExpiredTimeseriesData } from './database';
import { setupRoutes } from './routes';
import { setupBroker } from './broker';
import { deviceCache } from './cache';
import { scheduler } from './scheduler';
import { bridge } from './bridge';
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

  // 初始化并启动定时任务调度器
  scheduler.init(aedes, deviceCache);
  scheduler.start();
  console.log('定时任务调度器已启动');

  // 初始化并启动 Bridge（跨 Broker 通信）
  bridge.init(aedes, deviceCache);
  bridge.start();
  if (config.bridge.enabled) {
    console.log(`Bridge 已启动，brokerId: ${config.bridge.brokerId}`);
  }

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

  // 定时检查HTTP设备离线状态（每10分钟）
  const httpStatusTimer = setInterval(() => {
    const result = markInactiveHttpDevicesOffline();
    if (result.changes > 0) {
      console.log(`已将 ${result.changes} 个HTTP设备标记为离线`);
    }
  }, 10 * 60 * 1000); // 每10分钟

  // 定时清理过期时序数据（每天检查一次）
  const timeseriesCleanupTimer = setInterval(() => {
    const droppedCount = cleanExpiredTimeseriesData(config.timeseries.retentionDays);
    if (droppedCount > 0) {
      console.log(`已清理 ${droppedCount} 张过期时序数据表（保留 ${config.timeseries.retentionDays} 天）`);
    }
  }, 24 * 60 * 60 * 1000); // 每天

  // 优雅关闭
  process.on('SIGINT', () => {
    console.log('\n正在关闭服务...');
    
    // 清除定时器
    clearInterval(httpStatusTimer);
    clearInterval(timeseriesCleanupTimer);
    
    // 停止调度器
    scheduler.stop();
    
    // 停止 Bridge
    bridge.stop();
    
    aedes.close(() => {
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
