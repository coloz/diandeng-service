import Database, { Statement, Database as BetterSqlite3Database, RunResult } from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { Device, Group } from './types';

let db: BetterSqlite3Database | null = null;

/**
 * 预编译语句缓存
 * 避免每次查询都重新编译 SQL，显著提升性能
 */
const stmtCache = new Map<string, Statement<unknown[], unknown>>();

/**
 * 获取预编译语句（懒加载 + 缓存）
 * @param key - 语句的唯一标识
 * @param sql - SQL 语句
 * @returns 预编译语句
 */
function getStmt(key: string, sql: string): Statement<unknown[], unknown> {
  if (!stmtCache.has(key)) {
    stmtCache.set(key, getDb().prepare(sql));
  }
  return stmtCache.get(key) as Statement<unknown[], unknown>;
}

/**
 * 清除语句缓存（数据库重新初始化时调用）
 */
function clearStmtCache(): void {
  stmtCache.clear();
}

/**
 * 初始化数据库
 */
export function initDatabase(): BetterSqlite3Database {
  const dbPath = path.join(__dirname, '..', 'data', 'broker.db');
  
  // 确保data目录存在
  const dataDir = path.dirname(dbPath);
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  // 清除旧的语句缓存
  clearStmtCache();

  db = new Database(dbPath);
  
  // 启用WAL模式提升性能
  db.pragma('journal_mode = WAL');
  
  // 额外性能优化配置
  db.pragma('synchronous = NORMAL');   // 降低同步级别，提升写入速度
  db.pragma('cache_size = 10000');     // 增大页面缓存（约40MB）
  db.pragma('temp_store = MEMORY');    // 临时表存储在内存中

  // 创建设备表
  db.exec(`
    CREATE TABLE IF NOT EXISTS devices (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      uuid TEXT UNIQUE NOT NULL,
      token TEXT NOT NULL,
      auth_key TEXT UNIQUE NOT NULL,
      client_id TEXT,
      username TEXT,
      password TEXT,
      iot_token TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // 创建设备组表
  db.exec(`
    CREATE TABLE IF NOT EXISTS groups (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // 创建设备-组关联表
  db.exec(`
    CREATE TABLE IF NOT EXISTS device_groups (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      device_id INTEGER NOT NULL,
      group_id INTEGER NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (device_id) REFERENCES devices(id),
      FOREIGN KEY (group_id) REFERENCES groups(id),
      UNIQUE(device_id, group_id)
    )
  `);

  // 创建索引
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_devices_auth_key ON devices(auth_key);
    CREATE INDEX IF NOT EXISTS idx_devices_uuid ON devices(uuid);
    CREATE INDEX IF NOT EXISTS idx_devices_client_id ON devices(client_id);
    CREATE INDEX IF NOT EXISTS idx_device_groups_device_id ON device_groups(device_id);
    CREATE INDEX IF NOT EXISTS idx_device_groups_group_id ON device_groups(group_id);
  `);

  console.log('数据库表结构初始化完成');
  return db;
}

/**
 * 获取数据库实例
 */
export function getDb(): BetterSqlite3Database {
  if (!db) {
    throw new Error('数据库未初始化');
  }
  return db;
}

/**
 * 创建设备
 */
export function createDevice(uuid: string, token: string, authKey: string): RunResult {
  const stmt = getStmt('createDevice', `
    INSERT INTO devices (uuid, token, auth_key)
    VALUES (?, ?, ?)
  `);
  return stmt.run(uuid, token, authKey);
}

/**
 * 通过authKey获取设备
 */
export function getDeviceByAuthKey(authKey: string): Device | undefined {
  const stmt = getStmt('getDeviceByAuthKey', `
    SELECT * FROM devices WHERE auth_key = ?
  `);
  return stmt.get(authKey) as Device | undefined;
}

/**
 * 通过uuid获取设备
 */
export function getDeviceByUuid(uuid: string): Device | undefined {
  const stmt = getStmt('getDeviceByUuid', `
    SELECT * FROM devices WHERE uuid = ?
  `);
  return stmt.get(uuid) as Device | undefined;
}

/**
 * 通过clientId获取设备
 */
export function getDeviceByClientId(clientId: string): Device | undefined {
  const stmt = getStmt('getDeviceByClientId', `
    SELECT * FROM devices WHERE client_id = ?
  `);
  return stmt.get(clientId) as Device | undefined;
}

/**
 * 更新设备连接信息
 */
export function updateDeviceConnection(
  authKey: string,
  clientId: string,
  username: string,
  password: string,
  iotToken: string
): RunResult {
  const stmt = getStmt('updateDeviceConnection', `
    UPDATE devices 
    SET client_id = ?, username = ?, password = ?, iot_token = ?, updated_at = CURRENT_TIMESTAMP
    WHERE auth_key = ?
  `);
  return stmt.run(clientId, username, password, iotToken, authKey);
}

/**
 * 创建组
 */
export function createGroup(name: string): RunResult {
  const stmt = getStmt('createGroup', `
    INSERT OR IGNORE INTO groups (name) VALUES (?)
  `);
  return stmt.run(name);
}

/**
 * 获取组
 */
export function getGroupByName(name: string): Group | undefined {
  const stmt = getStmt('getGroupByName', `
    SELECT * FROM groups WHERE name = ?
  `);
  return stmt.get(name) as Group | undefined;
}

/**
 * 将设备添加到组
 */
export function addDeviceToGroup(deviceId: number, groupId: number): RunResult {
  const stmt = getStmt('addDeviceToGroup', `
    INSERT OR IGNORE INTO device_groups (device_id, group_id) VALUES (?, ?)
  `);
  return stmt.run(deviceId, groupId);
}

/**
 * 获取设备所在的所有组
 */
export function getDeviceGroups(deviceId: number): Group[] {
  const stmt = getStmt('getDeviceGroups', `
    SELECT g.* FROM groups g
    INNER JOIN device_groups dg ON g.id = dg.group_id
    WHERE dg.device_id = ?
  `);
  return stmt.all(deviceId) as Group[];
}

/**
 * 获取组内所有设备
 */
export function getGroupDevices(groupId: number): Device[] {
  const stmt = getStmt('getGroupDevices', `
    SELECT d.* FROM devices d
    INNER JOIN device_groups dg ON d.id = dg.device_id
    WHERE dg.group_id = ?
  `);
  return stmt.all(groupId) as Device[];
}

/**
 * 检查设备是否在指定组中
 */
export function isDeviceInGroup(deviceId: number, groupName: string): boolean {
  const stmt = getStmt('isDeviceInGroup', `
    SELECT 1 FROM device_groups dg
    INNER JOIN groups g ON g.id = dg.group_id
    WHERE dg.device_id = ? AND g.name = ?
  `);
  return stmt.get(deviceId, groupName) !== undefined;
}

/**
 * 获取所有设备
 */
export function getAllDevices(): Device[] {
  const stmt = getStmt('getAllDevices', `
    SELECT * FROM devices ORDER BY created_at DESC
  `);
  return stmt.all([]) as Device[];
}
