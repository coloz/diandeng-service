#!/usr/bin/env node

/**
 * 构建脚本
 * 将 src 和 web 目录的内容打包到 dist 目录
 */

const fs = require('fs');
const path = require('path');

const ROOT_DIR = path.join(__dirname, '..');
const DIST_DIR = path.join(ROOT_DIR, 'dist');

// 需要复制的目录和文件
const COPY_ITEMS = [
  { src: 'src', dest: 'src' },
  { src: 'web/index.js', dest: 'web/index.js' },
  { src: 'web/routes.js', dest: 'web/routes.js' },
  { src: 'data', dest: 'data', createIfNotExists: true },
  { src: 'cli.js', dest: 'cli.js' },
  { src: 'scripts/dist-readme.md', dest: 'README.md' },
];

/**
 * 递归复制目录
 */
function copyDir(src, dest) {
  if (!fs.existsSync(src)) {
    console.log(`  跳过不存在的目录: ${src}`);
    return;
  }
  
  fs.mkdirSync(dest, { recursive: true });
  const entries = fs.readdirSync(src, { withFileTypes: true });
  
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    
    if (entry.isDirectory()) {
      copyDir(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

/**
 * 复制文件
 */
function copyFile(src, dest) {
  const destDir = path.dirname(dest);
  fs.mkdirSync(destDir, { recursive: true });
  fs.copyFileSync(src, dest);
}

/**
 * 清空目录
 */
function cleanDir(dir) {
  if (fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  fs.mkdirSync(dir, { recursive: true });
}

/**
 * 主构建流程
 */
async function build() {
  console.log('🚀 开始构建 diandeng-broker...\n');
  
  // 清空 dist 目录
  console.log('🗑️  清空 dist 目录...');
  cleanDir(DIST_DIR);
  
  // 复制后端文件
  console.log('\n📁 复制后端文件...');
  for (const item of COPY_ITEMS) {
    const srcPath = path.join(ROOT_DIR, item.src);
    const destPath = path.join(DIST_DIR, item.dest);
    
    if (item.createIfNotExists && !fs.existsSync(srcPath)) {
      console.log(`  创建目录: ${item.dest}`);
      fs.mkdirSync(destPath, { recursive: true });
      continue;
    }
    
    if (!fs.existsSync(srcPath)) {
      console.log(`  跳过: ${item.src} (不存在)`);
      continue;
    }
    
    const stat = fs.statSync(srcPath);
    if (stat.isDirectory()) {
      console.log(`  复制目录: ${item.src} -> ${item.dest}`);
      copyDir(srcPath, destPath);
    } else {
      console.log(`  复制文件: ${item.src} -> ${item.dest}`);
      copyFile(srcPath, destPath);
    }
  }
  
  // 生成 package.json
  console.log('\n📝 生成 package.json...');
  const packageJson = require(path.join(ROOT_DIR, 'package.json'));
  const distPackageJson = {
    name: packageJson.name,
    version: packageJson.version,
    description: packageJson.description,
    main: 'cli.js',
    bin: {
      'diandeng-broker': './cli.js'
    },
    scripts: {
      start: 'node cli.js',
      broker: 'node cli.js broker',
      web: 'node cli.js web',
      all: 'node cli.js all'
    },
    keywords: packageJson.keywords,
    author: packageJson.author,
    license: packageJson.license,
    dependencies: packageJson.dependencies
  };
  
  fs.writeFileSync(
    path.join(DIST_DIR, 'package.json'),
    JSON.stringify(distPackageJson, null, 2)
  );
  
  console.log('\n✅ 构建完成！');
  console.log(`\n📂 输出目录: ${DIST_DIR}`);
  console.log('\n使用方法:');
  console.log('  cd dist');
  console.log('  npm install');
  console.log('  node cli.js          # 启动所有服务');
  console.log('  node cli.js broker   # 仅启动 MQTT Broker');
  console.log('  node cli.js web      # 仅启动 Web 用户接口服务');
}

build().catch(err => {
  console.error('构建失败:', err);
  process.exit(1);
});
