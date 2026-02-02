import Fastify, { FastifyInstance } from 'fastify';
import { initDatabase } from '../src/database';
import { setupWebRoutes } from './routes';

// Web管理面板配置
const config = {
  http: {
    port: parseInt(process.env['WEB_PORT'] || '3001', 10),
    host: '0.0.0.0'
  }
};

async function main(): Promise<void> {
  // 初始化数据库（共享同一个数据库）
  console.log('正在初始化数据库连接...');
  initDatabase();
  console.log('数据库连接完成');

  // 创建Fastify HTTP服务器
  const fastify: FastifyInstance = Fastify({
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
    fastify.close(() => {
      console.log('HTTP Server 已关闭');
      process.exit(0);
    });
  });
}

main().catch(console.error);
