import * as esbuild from 'esbuild';
import * as fs from 'fs';
import * as path from 'path';

const distDir = path.join(__dirname, '..', 'dist');

// 确保 dist 目录存在
if (!fs.existsSync(distDir)) {
  fs.mkdirSync(distDir, { recursive: true });
}

// 公共配置
const commonOptions: esbuild.BuildOptions = {
  bundle: true,
  platform: 'node',
  target: 'node18',
  format: 'cjs',
  sourcemap: false,
  minify: false,
  // 外部依赖（原生模块需要保持外部）
  external: ['better-sqlite3'],
};

async function build() {
  console.log('🔨 开始打包...\n');

  try {
    // 打包 CLI 入口
    await esbuild.build({
      ...commonOptions,
      entryPoints: ['cli.ts'],
      outfile: 'dist/cli.js',
      banner: {
        js: '#!/usr/bin/env node'
      }
    });
    console.log('✅ cli.js 打包完成');

    // 打包 Broker 服务
    await esbuild.build({
      ...commonOptions,
      entryPoints: ['src/index.ts'],
      outfile: 'dist/src/index.js',
    });
    console.log('✅ src/index.js 打包完成');

    // 打包 Web 服务
    await esbuild.build({
      ...commonOptions,
      entryPoints: ['web/index.ts'],
      outfile: 'dist/web/index.js',
    });
    console.log('✅ web/index.js 打包完成');

    console.log('\n🎉 打包完成！');
    console.log(`📁 输出目录: ${distDir}`);
  } catch (error) {
    console.error('❌ 打包失败:', error);
    process.exit(1);
  }
}

build();
