#!/usr/bin/env node

/**
 * 点灯Broker CLI
 * 统一入口，用于启动 MQTT Broker 和 Web 管理面板
 */

import { spawn, ChildProcess } from 'child_process';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { parse as dotenvParse } from 'dotenv';

// 版本信息
const VERSION = '1.0.0';

// 检测是否通过 ts-node 运行
const isTsNode = (process.argv[0] ?? '').includes('ts-node') || 
                 (process as any)[Symbol.for('ts-node.register.instance')] !== undefined ||
                 __filename.endsWith('.ts');
const scriptExt = isTsNode ? '.ts' : '.js';
const nodeRunner = isTsNode ? 'ts-node' : 'node';

// 颜色输出
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  red: '\x1b[31m'
} as const;

function log(message: string, color: string = ''): void {
  console.log(`${color}${message}${colors.reset}`);
}

function printBanner(): void {
  log('\n╔════════════════════════════════════════╗', colors.cyan);
  log('║         DianDeng Lite v' + VERSION.padEnd(16) + '║', colors.cyan);
  log('║   Lightweight MQTT Broker Service      ║', colors.cyan);
  log('╚════════════════════════════════════════╝\n', colors.cyan);
}

function printHelp(): void {
  printBanner();
  log('使用方法:', colors.bright);
  log('  node dist/cli.js [命令] [选项]\n');
  
  log('命令:', colors.bright);
  log('  all, start    启动所有服务 (MQTT Broker + Web 管理面板) [默认]');
  log('                开发环境下会同时启动 Angular 开发服务器');
  log('  broker        仅启动 MQTT Broker 服务');
  log('  web           仅启动 Web 管理面板');
  log('  help          显示帮助信息');
  log('  version       显示版本信息\n');
  
  log('环境变量:', colors.bright);
  log('  MQTT_PORT          MQTT 服务端口 (默认: 1883)');
  log('  HTTP_PORT          HTTP API 端口 (默认: 3000)');
  log('  WEB_PORT           Web 面板端口 (默认: 3001)');
  log('  LOG_LEVEL          日志级别 (none/error/warn/info/debug)\n');
  
  log('选项:', colors.bright);
  log('  --verbose, -V      启用详细日志输出\n');
  
  log('示例:', colors.bright);
  log('  node dist/cli.js              # 启动所有服务');
  log('  node dist/cli.js broker       # 仅启动 MQTT Broker');
  log('  node dist/cli.js web          # 仅启动 Web 面板');
  log('  MQTT_PORT=1884 node dist/cli.js  # 使用自定义端口\n');
}

function printVersion(): void {
  log(`diandeng-broker v${VERSION}`);
}

/**
 * 启动子进程
 */
function startProcess(name: string, scriptPath: string, color: string, verbose: boolean = false): ChildProcess {
  const env = { ...process.env };
  if (verbose) {
    env.LOG_LEVEL = 'debug';
  }
  
  const child = spawn(nodeRunner, [scriptPath], {
    cwd: path.dirname(scriptPath),
    env: env,
    stdio: ['inherit', 'pipe', 'pipe'],
    shell: isTsNode
  });

  child.stdout?.on('data', (data: Buffer) => {
    const lines = data.toString().trim().split('\n');
    lines.forEach((line: string) => {
      if (line.trim()) {
        console.log(`${color}[${name}]${colors.reset} ${line}`);
      }
    });
  });

  child.stderr?.on('data', (data: Buffer) => {
    const lines = data.toString().trim().split('\n');
    lines.forEach((line: string) => {
      if (line.trim()) {
        console.error(`${color}[${name}]${colors.reset} ${colors.red}${line}${colors.reset}`);
      }
    });
  });

  child.on('error', (err: Error) => {
    log(`[${name}] 启动失败: ${err.message}`, colors.red);
  });

  child.on('exit', (code: number | null) => {
    if (code !== 0 && code !== null) {
      log(`[${name}] 进程退出，退出码: ${code}`, colors.yellow);
    }
  });

  return child;
}

/**
 * 启动 MQTT Broker
 */
function startBroker(verbose: boolean = false): ChildProcess {
  log('🚀 正在启动 MQTT Broker...', colors.green);
  if (verbose) {
    log('   详细日志已启用', colors.yellow);
  }
  const scriptPath = path.join(__dirname, 'src', `index${scriptExt}`);
  return startProcess('Broker', scriptPath, colors.blue, verbose);
}

/**
 * 启动 Web 管理面板
 */
function startWeb(verbose: boolean = false): ChildProcess {
  log('🌐 正在启动 Web 管理面板...', colors.green);
  const scriptPath = path.join(__dirname, 'web', `index${scriptExt}`);
  return startProcess('Web', scriptPath, colors.cyan, verbose);
}

/**
 * 检查是否为开发环境（存在 web/angular 目录）
 */
function isDevEnvironment(): boolean {
  const angularDir = path.join(__dirname, '..', 'web', 'angular');
  return fs.existsSync(angularDir);
}

/**
 * 启动 Angular 开发服务器
 */
function startAngular(): ChildProcess {
  log('🅰️  正在启动 Angular 开发服务器...', colors.green);
  const angularDir = path.join(__dirname, '..', 'web', 'angular');
  
  const child = spawn('npm', ['start'], {
    cwd: angularDir,
    env: process.env,
    stdio: ['inherit', 'pipe', 'pipe'],
    shell: true
  });

  child.stdout?.on('data', (data: Buffer) => {
    const lines = data.toString().trim().split('\n');
    lines.forEach((line: string) => {
      if (line.trim()) {
        console.log(`${colors.yellow}[Angular]${colors.reset} ${line}`);
      }
    });
  });

  child.stderr?.on('data', (data: Buffer) => {
    const lines = data.toString().trim().split('\n');
    lines.forEach((line: string) => {
      if (line.trim()) {
        console.error(`${colors.yellow}[Angular]${colors.reset} ${colors.red}${line}${colors.reset}`);
      }
    });
  });

  child.on('error', (err: Error) => {
    log(`[Angular] 启动失败: ${err.message}`, colors.red);
  });

  child.on('exit', (code: number | null) => {
    if (code !== 0 && code !== null) {
      log(`[Angular] 进程退出，退出码: ${code}`, colors.yellow);
    }
  });

  return child;
}

/**
 * 启动所有服务
 */
function startAll(verbose: boolean = false): ChildProcess[] {
  printBanner();
  const isDev = isDevEnvironment();
  
  if (isDev) {
    log('📡 启动所有服务 (开发模式)...\n', colors.green);
  } else {
    log('📡 启动所有服务...\n', colors.green);
  }
  
  const processes: ChildProcess[] = [];
  
  // 启动 Broker
  processes.push(startBroker(verbose));
  
  // 稍微延迟启动 Web，确保数据库已初始化
  setTimeout(() => {
    processes.push(startWeb(verbose));
    
    // 开发环境下启动 Angular 开发服务器
    if (isDev) {
      setTimeout(() => {
        processes.push(startAngular());
      }, 500);
    }
  }, 1000);
  
  // 处理退出信号
  const cleanup = (): void => {
    log('\n🛑 正在关闭所有服务...', colors.yellow);
    processes.forEach(p => {
      if (p && !p.killed) {
        p.kill('SIGINT');
      }
    });
    
    // 给进程一些时间优雅关闭
    setTimeout(() => {
      process.exit(0);
    }, 2000);
  };

  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);
  
  return processes;
}

/**
 * 确保 Bridge 配置已生成
 * 首次启动时自动生成 BROKER_ID 和 BRIDGE_TOKEN 并写入 .env
 */
function ensureBridgeConfig(): void {
  const envPath = path.resolve(process.cwd(), '.env');
  let envContent = '';
  
  if (fs.existsSync(envPath)) {
    envContent = fs.readFileSync(envPath, 'utf-8');
  }

  const parsed = dotenvParse(envContent);
  let modified = false;
  const additions: string[] = [];

  // 检查是否已有 BROKER_ID
  if (!parsed.BROKER_ID) {
    const brokerId = `broker-${crypto.randomBytes(8).toString('hex')}`;
    additions.push(`BROKER_ID=${brokerId}`);
    log(`  🔑 已生成 BROKER_ID: ${brokerId}`, colors.green);
    modified = true;
  }

  // 检查是否已有 BRIDGE_TOKEN
  if (!parsed.BRIDGE_TOKEN) {
    const bridgeToken = crypto.randomBytes(32).toString('hex');
    additions.push(`BRIDGE_TOKEN=${bridgeToken}`);
    log(`  🔑 已生成 BRIDGE_TOKEN`, colors.green);
    modified = true;
  }

  // 检查是否已有 BRIDGE_ENABLED
  if (!parsed.BRIDGE_ENABLED) {
    additions.push(`BRIDGE_ENABLED=true`);
    log(`  ✅ 已启用 BRIDGE_ENABLED=true`, colors.green);
    modified = true;
  }

  if (modified) {
    const trimmed = envContent.trimEnd();
    const finalContent = (trimmed ? trimmed + '\n' : '') + additions.join('\n') + '\n';
    fs.writeFileSync(envPath, finalContent, 'utf-8');
    log(`  📝 Bridge 配置已写入 .env`, colors.green);
  }
}

// 主入口
function main(): void {
  const args = process.argv.slice(2);
  
  // 解析选项
  const verbose = args.includes('--verbose') || args.includes('-V');
  const filteredArgs = args.filter(arg => arg !== '--verbose' && arg !== '-V');
  const command = filteredArgs[0] || 'all';

  switch (command.toLowerCase()) {
    case 'all':
    case 'start':
      ensureBridgeConfig();
      startAll(verbose);
      break;
      
    case 'broker':
      printBanner();
      ensureBridgeConfig();
      startBroker(verbose);
      break;
      
    case 'web':
      printBanner();
      startWeb(verbose);
      break;
      
    case 'help':
    case '-h':
    case '--help':
      printHelp();
      break;
      
    case 'version':
    case '-v':
    case '--version':
      printVersion();
      break;
      
    default:
      log(`未知命令: ${command}`, colors.red);
      printHelp();
      process.exit(1);
  }
}

main();
