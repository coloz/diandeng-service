#!/usr/bin/env node

/**
 * 点灯Broker CLI
 * 统一入口，用于启动 MQTT Broker 和 Web 管理面板
 */

const { spawn } = require('child_process');
const path = require('path');

// 版本信息
const VERSION = '1.0.0';

// 颜色输出
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  red: '\x1b[31m'
};

function log(message, color = '') {
  console.log(`${color}${message}${colors.reset}`);
}

function printBanner() {
  log('\n╔════════════════════════════════════════╗', colors.cyan);
  log('║       点灯Broker Lite v' + VERSION.padEnd(17) + '║', colors.cyan);
  log('║   Lightweight MQTT Broker Service      ║', colors.cyan);
  log('╚════════════════════════════════════════╝\n', colors.cyan);
}

function printHelp() {
  printBanner();
  log('使用方法:', colors.bright);
  log('  node cli.js [命令] [选项]\n');
  
  log('命令:', colors.bright);
  log('  all, start    启动所有服务 (MQTT Broker + Web 管理面板) [默认]');
  log('                开发环境下会同时启动 Angular 开发服务器');
  log('  broker        仅启动 MQTT Broker 服务');
  log('  web           仅启动 Web 管理面板');
  log('  help          显示帮助信息');
  log('  version       显示版本信息\n');
  
  log('环境变量:', colors.bright);
  log('  MQTT_PORT     MQTT 服务端口 (默认: 1883)');
  log('  HTTP_PORT     HTTP API 端口 (默认: 3000)');
  log('  WEB_PORT      Web 面板端口 (默认: 3001)');
  log('  WS_PORT       WebSocket 端口 (默认: 8083)\n');
  
  log('示例:', colors.bright);
  log('  node cli.js                  # 启动所有服务');
  log('  node cli.js broker           # 仅启动 MQTT Broker');
  log('  node cli.js web              # 仅启动 Web 面板');
  log('  MQTT_PORT=1884 node cli.js   # 使用自定义端口\n');
}

function printVersion() {
  log(`diandeng-broker v${VERSION}`);
}

/**
 * 启动子进程
 */
function startProcess(name, scriptPath, color) {
  const child = spawn('node', [scriptPath], {
    cwd: path.dirname(scriptPath),
    env: process.env,
    stdio: ['inherit', 'pipe', 'pipe']
  });

  child.stdout.on('data', (data) => {
    const lines = data.toString().trim().split('\n');
    lines.forEach(line => {
      if (line.trim()) {
        console.log(`${color}[${name}]${colors.reset} ${line}`);
      }
    });
  });

  child.stderr.on('data', (data) => {
    const lines = data.toString().trim().split('\n');
    lines.forEach(line => {
      if (line.trim()) {
        console.error(`${color}[${name}]${colors.reset} ${colors.red}${line}${colors.reset}`);
      }
    });
  });

  child.on('error', (err) => {
    log(`[${name}] 启动失败: ${err.message}`, colors.red);
  });

  child.on('exit', (code) => {
    if (code !== 0 && code !== null) {
      log(`[${name}] 进程退出，退出码: ${code}`, colors.yellow);
    }
  });

  return child;
}

/**
 * 启动 MQTT Broker
 */
function startBroker() {
  log('🚀 正在启动 MQTT Broker...', colors.green);
  const scriptPath = path.join(__dirname, 'src', 'index.js');
  return startProcess('Broker', scriptPath, colors.blue);
}

/**
 * 启动 Web 管理面板
 */
function startWeb() {
  log('🌐 正在启动 Web 管理面板...', colors.green);
  const scriptPath = path.join(__dirname, 'web', 'index.js');
  return startProcess('Web', scriptPath, colors.cyan);
}

/**
 * 检查是否为开发环境（存在 web/angular 目录）
 */
function isDevEnvironment() {
  const angularDir = path.join(__dirname, 'web', 'angular');
  return require('fs').existsSync(angularDir);
}

/**
 * 启动 Angular 开发服务器
 */
function startAngular() {
  log('🅰️  正在启动 Angular 开发服务器...', colors.green);
  const angularDir = path.join(__dirname, 'web', 'angular');
  
  const child = spawn('npm', ['start'], {
    cwd: angularDir,
    env: process.env,
    stdio: ['inherit', 'pipe', 'pipe'],
    shell: true
  });

  child.stdout.on('data', (data) => {
    const lines = data.toString().trim().split('\n');
    lines.forEach(line => {
      if (line.trim()) {
        console.log(`${colors.yellow}[Angular]${colors.reset} ${line}`);
      }
    });
  });

  child.stderr.on('data', (data) => {
    const lines = data.toString().trim().split('\n');
    lines.forEach(line => {
      if (line.trim()) {
        console.error(`${colors.yellow}[Angular]${colors.reset} ${colors.red}${line}${colors.reset}`);
      }
    });
  });

  child.on('error', (err) => {
    log(`[Angular] 启动失败: ${err.message}`, colors.red);
  });

  child.on('exit', (code) => {
    if (code !== 0 && code !== null) {
      log(`[Angular] 进程退出，退出码: ${code}`, colors.yellow);
    }
  });

  return child;
}

/**
 * 启动所有服务
 */
function startAll() {
  printBanner();
  const isDev = isDevEnvironment();
  
  if (isDev) {
    log('📡 启动所有服务 (开发模式)...\n', colors.green);
  } else {
    log('📡 启动所有服务...\n', colors.green);
  }
  
  const processes = [];
  
  // 启动 Broker
  processes.push(startBroker());
  
  // 稍微延迟启动 Web，确保数据库已初始化
  setTimeout(() => {
    processes.push(startWeb());
    
    // 开发环境下启动 Angular 开发服务器
    if (isDev) {
      setTimeout(() => {
        processes.push(startAngular());
      }, 500);
    }
  }, 1000);
  
  // 处理退出信号
  const cleanup = () => {
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

// 主入口
function main() {
  const args = process.argv.slice(2);
  const command = args[0] || 'all';

  switch (command.toLowerCase()) {
    case 'all':
    case 'start':
      startAll();
      break;
      
    case 'broker':
      printBanner();
      startBroker();
      break;
      
    case 'web':
      printBanner();
      startWeb();
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
