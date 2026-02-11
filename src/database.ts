import Database, { Statement, Database as BetterSqlite3Database, RunResult } from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { Device, Group, BridgeRemote } from './types';
import config from './config';

let db: BetterSqlite3Database | null = null;

/**
 * 预编译语句缓存
 * 避免每次查询都重新编译 SQL，显著提升性能
 */
const stmtCache = new Map<string, Statement<unknown[], unknown>>();

/** 已验证存在的时序数据分表缓存 */
const verifiedTimeseriesTables = new Set<string>();

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
  verifiedTimeseriesTables.clear();
}

/**
 * 初始化数据库
 */
export function initDatabase(): BetterSqlite3Database {
  const dbPath = path.join(__dirname, '..', 'data', config.database.filename);
  
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
      auth_key TEXT UNIQUE NOT NULL,
      client_id TEXT,
      username TEXT,
      password TEXT,
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

  // 创建设备状态表
  db.exec(`
    CREATE TABLE IF NOT EXISTS device_status (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      device_id INTEGER UNIQUE NOT NULL,
      status INTEGER DEFAULT 0,
      mode TEXT DEFAULT 'mqtt',
      last_active_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (device_id) REFERENCES devices(id)
    )
  `);

  // 创建 Bridge 远程 Broker 表
  db.exec(`
    CREATE TABLE IF NOT EXISTS bridge_remotes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      broker_id TEXT UNIQUE NOT NULL,
      url TEXT NOT NULL,
      token TEXT NOT NULL,
      enabled INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // 创建 Bridge 共享设备表
  db.exec(`
    CREATE TABLE IF NOT EXISTS bridge_shared_devices (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      broker_id TEXT NOT NULL,
      device_id INTEGER NOT NULL,
      permissions TEXT DEFAULT 'readwrite',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (device_id) REFERENCES devices(id),
      UNIQUE(broker_id, device_id)
    )
  `);

  // 创建索引
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_devices_auth_key ON devices(auth_key);
    CREATE INDEX IF NOT EXISTS idx_devices_uuid ON devices(uuid);
    CREATE INDEX IF NOT EXISTS idx_devices_client_id ON devices(client_id);
    CREATE INDEX IF NOT EXISTS idx_device_groups_device_id ON device_groups(device_id);
    CREATE INDEX IF NOT EXISTS idx_device_groups_group_id ON device_groups(group_id);
    CREATE INDEX IF NOT EXISTS idx_device_status_device_id ON device_status(device_id);
    CREATE INDEX IF NOT EXISTS idx_device_status_status ON device_status(status);
    CREATE INDEX IF NOT EXISTS idx_bridge_shared_devices_broker ON bridge_shared_devices(broker_id);
    CREATE INDEX IF NOT EXISTS idx_bridge_shared_devices_device ON bridge_shared_devices(device_id);
  `);

  console.log('数据库表结构初始化完成');

  // 首次初始化：检查是否有设备，如果没有则创建一个默认设备
  const deviceCount = db.prepare('SELECT COUNT(*) as count FROM devices').get() as { count: number };
  if (deviceCount.count === 0) {
    const defaultUuid = crypto.randomBytes(16).toString('hex').slice(0, 16);
    const defaultAuthKey = crypto.randomBytes(16).toString('hex').slice(0, 16);
    db.prepare('INSERT INTO devices (uuid, auth_key) VALUES (?, ?)').run(defaultUuid, defaultAuthKey);
    console.log('首次初始化：已创建默认设备');
    console.log(`  UUID: ${defaultUuid}`);
    console.log(`  AuthKey: ${defaultAuthKey}`);
  }

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
export function createDevice(uuid: string, authKey: string): RunResult {
  const stmt = getStmt('createDevice', `
    INSERT INTO devices (uuid, auth_key)
    VALUES (?, ?)
  `);
  return stmt.run(uuid, authKey);
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
  password: string
): RunResult {
  const stmt = getStmt('updateDeviceConnection', `
    UPDATE devices 
    SET client_id = ?, username = ?, password = ?, updated_at = CURRENT_TIMESTAMP
    WHERE auth_key = ?
  `);
  return stmt.run(clientId, username, password, authKey);
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

/**
 * 更新设备在线状态
 * @param deviceId 设备ID
 * @param isOnline 是否在线
 * @param mode 连接模式 mqtt | http
 */
export function updateDeviceOnlineStatus(
  deviceId: number,
  isOnline: boolean,
  mode: 'mqtt' | 'http' = 'mqtt'
): RunResult {
  const stmt = getStmt('updateDeviceOnlineStatus', `
    INSERT INTO device_status (device_id, status, mode, last_active_at, updated_at)
    VALUES (?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    ON CONFLICT(device_id) DO UPDATE SET
      status = excluded.status,
      mode = excluded.mode,
      last_active_at = CURRENT_TIMESTAMP,
      updated_at = CURRENT_TIMESTAMP
  `);
  return stmt.run(deviceId, isOnline ? 1 : 0, mode);
}

/**
 * 更新设备最后活动时间
 * @param deviceId 设备ID
 */
export function updateDeviceLastActive(deviceId: number): RunResult {
  const stmt = getStmt('updateDeviceLastActive', `
    UPDATE device_status
    SET last_active_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
    WHERE device_id = ?
  `);
  return stmt.run(deviceId);
}

/**
 * 批量更新MQTT设备状态（每分钟调用）
 * @param clientIds 在线的clientId列表
 */
export function batchUpdateMqttDeviceStatus(clientIds: string[]): void {
  if (clientIds.length === 0) return;
  
  const db = getDb();
  const updateStmt = db.prepare(`
    UPDATE device_status
    SET status = 1, last_active_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
    WHERE device_id = (SELECT id FROM devices WHERE client_id = ?)
  `);
  
  const transaction = db.transaction((ids: string[]) => {
    for (const clientId of ids) {
      updateStmt.run(clientId);
    }
  });
  
  transaction(clientIds);
}

/**
 * 将HTTP设备标记为离线（超过10分钟无活动）
 */
export function markInactiveHttpDevicesOffline(): RunResult {
  const stmt = getStmt('markInactiveHttpDevicesOffline', `
    UPDATE device_status
    SET status = 0, updated_at = CURRENT_TIMESTAMP
    WHERE mode = 'http'
      AND status = 1
      AND datetime(last_active_at) < datetime('now', '-10 minutes')
  `);
  return stmt.run();
}

/**
 * 将设备标记为离线
 * @param deviceId 设备ID
 */
export function markDeviceOffline(deviceId: number): RunResult {
  const stmt = getStmt('markDeviceOffline', `
    UPDATE device_status
    SET status = 0, updated_at = CURRENT_TIMESTAMP
    WHERE device_id = ?
  `);
  return stmt.run(deviceId);
}

/**
 * 获取设备在线状态
 * @param deviceId 设备ID
 */
export function getDeviceStatus(deviceId: number): { status: number; mode: string; last_active_at: string } | undefined {
  const stmt = getStmt('getDeviceStatus', `
    SELECT status, mode, last_active_at FROM device_status WHERE device_id = ?
  `);
  return stmt.get(deviceId) as { status: number; mode: string; last_active_at: string } | undefined;
}

/**
 * 获取所有在线设备
 */
export function getOnlineDevices(): Device[] {
  const stmt = getStmt('getOnlineDevices', `
    SELECT d.* FROM devices d
    INNER JOIN device_status ds ON d.id = ds.device_id
    WHERE ds.status = 1
    ORDER BY ds.last_active_at DESC
  `);
  return stmt.all([]) as Device[];
}

// ========== Bridge Remote CRUD ==========

/**
 * 获取所有已启用的远程 Broker
 */
export function getEnabledBridgeRemotes(): BridgeRemote[] {
  const stmt = getStmt('getEnabledBridgeRemotes', `
    SELECT * FROM bridge_remotes WHERE enabled = 1 ORDER BY created_at ASC
  `);
  return stmt.all([]) as BridgeRemote[];
}

/**
 * 获取所有远程 Broker（含禁用）
 */
export function getAllBridgeRemotes(): BridgeRemote[] {
  const stmt = getStmt('getAllBridgeRemotes', `
    SELECT * FROM bridge_remotes ORDER BY created_at ASC
  `);
  return stmt.all([]) as BridgeRemote[];
}

/**
 * 通过 brokerId 获取远程 Broker
 */
export function getBridgeRemoteByBrokerId(brokerId: string): BridgeRemote | undefined {
  const stmt = getStmt('getBridgeRemoteByBrokerId', `
    SELECT * FROM bridge_remotes WHERE broker_id = ?
  `);
  return stmt.get(brokerId) as BridgeRemote | undefined;
}

/**
 * 添加远程 Broker
 */
export function addBridgeRemote(brokerId: string, url: string, token: string): RunResult {
  const stmt = getStmt('addBridgeRemote', `
    INSERT INTO bridge_remotes (broker_id, url, token) VALUES (?, ?, ?)
  `);
  return stmt.run(brokerId, url, token);
}

/**
 * 更新远程 Broker
 */
export function updateBridgeRemote(brokerId: string, updates: { url?: string; token?: string; enabled?: number }): RunResult {
  const fields: string[] = [];
  const values: unknown[] = [];

  if (updates.url !== undefined) {
    fields.push('url = ?');
    values.push(updates.url);
  }
  if (updates.token !== undefined) {
    fields.push('token = ?');
    values.push(updates.token);
  }
  if (updates.enabled !== undefined) {
    fields.push('enabled = ?');
    values.push(updates.enabled);
  }

  if (fields.length === 0) {
    return { changes: 0 } as RunResult;
  }

  fields.push('updated_at = CURRENT_TIMESTAMP');
  values.push(brokerId);

  const sql = `UPDATE bridge_remotes SET ${fields.join(', ')} WHERE broker_id = ?`;
  return getDb().prepare(sql).run(...values);
}

/**
 * 删除远程 Broker
 */
export function deleteBridgeRemote(brokerId: string): RunResult {
  const stmt = getStmt('deleteBridgeRemote', `
    DELETE FROM bridge_remotes WHERE broker_id = ?
  `);
  return stmt.run(brokerId);
}

// ========== Bridge 共享设备 CRUD ==========

/**
 * 通过 ID 获取设备
 */
export function getDeviceById(id: number): Device | undefined {
  const stmt = getStmt('getDeviceById', 'SELECT * FROM devices WHERE id = ?');
  return stmt.get(id) as Device | undefined;
}

/**
 * 添加共享设备记录
 */
export function addBridgeSharedDevice(brokerId: string, deviceId: number, permissions: string = 'readwrite'): RunResult {
  const stmt = getStmt('addBridgeSharedDevice', `
    INSERT OR IGNORE INTO bridge_shared_devices (broker_id, device_id, permissions) VALUES (?, ?, ?)
  `);
  return stmt.run(brokerId, deviceId, permissions);
}

/**
 * 移除共享设备记录
 */
export function removeBridgeSharedDevice(brokerId: string, deviceId: number): RunResult {
  const stmt = getStmt('removeBridgeSharedDevice', `
    DELETE FROM bridge_shared_devices WHERE broker_id = ? AND device_id = ?
  `);
  return stmt.run(brokerId, deviceId);
}

/**
 * 获取指定 Broker 的共享设备列表（带设备信息）
 */
export function getSharedDevicesForBroker(brokerId: string): Array<{ id: number; broker_id: string; device_id: number; permissions: string; created_at: string; uuid: string; client_id: string | null }> {
  const stmt = getStmt('getSharedDevicesForBroker', `
    SELECT bsd.*, d.uuid, d.client_id
    FROM bridge_shared_devices bsd
    INNER JOIN devices d ON d.id = bsd.device_id
    WHERE bsd.broker_id = ?
    ORDER BY bsd.created_at ASC
  `);
  return stmt.all(brokerId) as Array<{ id: number; broker_id: string; device_id: number; permissions: string; created_at: string; uuid: string; client_id: string | null }>;
}

/**
 * 删除指定 Broker 的所有共享设备记录
 */
export function deleteAllBridgeSharedDevices(brokerId: string): RunResult {
  const stmt = getStmt('deleteAllBridgeSharedDevices', `
    DELETE FROM bridge_shared_devices WHERE broker_id = ?
  `);
  return stmt.run(brokerId);
}

/**
 * 获取设备被共享给了哪些 Broker
 */
export function getSharedBrokerIdsForDevice(deviceId: number): string[] {
  const stmt = getStmt('getSharedBrokerIdsForDevice', `
    SELECT broker_id FROM bridge_shared_devices WHERE device_id = ?
  `);
  return (stmt.all(deviceId) as Array<{ broker_id: string }>).map(r => r.broker_id);
}

/**
 * Bridge 设备访问控制检查
 * 返回值:
 *   'all'       - 无 ACL 记录，允许所有访问（向下兼容）
 *   'readwrite' - 有读写权限
 *   'read'      - 仅有只读权限
 *   'none'      - 未授权
 */
export function checkBridgeDeviceAccess(targetClientId: string, fromBrokerId: string): 'none' | 'all' | 'read' | 'readwrite' {
  const countStmt = getStmt('countSharedDevicesForBroker', `
    SELECT COUNT(*) as count FROM bridge_shared_devices WHERE broker_id = ?
  `);
  const { count } = countStmt.get(fromBrokerId) as { count: number };

  // 无 ACL 记录 → 不做限制（向下兼容）
  if (count === 0) return 'all';

  // 有 ACL 记录 → 检查具体设备
  const permStmt = getStmt('getDeviceSharePermission', `
    SELECT bsd.permissions FROM bridge_shared_devices bsd
    INNER JOIN devices d ON d.id = bsd.device_id
    WHERE bsd.broker_id = ? AND d.client_id = ?
  `);
  const result = permStmt.get(fromBrokerId, targetClientId) as { permissions: string } | undefined;
  return result ? (result.permissions as 'read' | 'readwrite') : 'none';
}

// ========== 时序数据（按天分表） ==========

/**
 * 根据时间戳生成时序数据分表名
 * @param timestamp 毫秒时间戳
 * @returns 表名，格式 ts_YYYYMMDD
 */
function getTimeseriesTableName(timestamp: number): string {
  const date = new Date(timestamp);
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `ts_${y}${m}${d}`;
}

/**
 * 确保指定日期的时序数据表存在（懒创建 + 内存缓存）
 */
function ensureTimeseriesTable(tableName: string): void {
  if (verifiedTimeseriesTables.has(tableName)) return;
  const database = getDb();
  database.exec(`
    CREATE TABLE IF NOT EXISTS ${tableName} (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      device_uuid TEXT NOT NULL,
      data_key TEXT NOT NULL,
      value REAL NOT NULL,
      timestamp INTEGER NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
  database.exec(`
    CREATE INDEX IF NOT EXISTS idx_${tableName}_device ON ${tableName}(device_uuid);
    CREATE INDEX IF NOT EXISTS idx_${tableName}_device_key ON ${tableName}(device_uuid, data_key);
    CREATE INDEX IF NOT EXISTS idx_${tableName}_ts ON ${tableName}(timestamp);
  `);
  verifiedTimeseriesTables.add(tableName);
}

/**
 * 获取数据库中所有时序数据分表名（已排序）
 */
function getAllTimeseriesTables(): string[] {
  const rows = getDb().prepare(
    `SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'ts_%' ORDER BY name ASC`
  ).all() as Array<{ name: string }>;
  return rows.map(r => r.name);
}

/**
 * 获取指定时间范围内的分表名列表
 */
function getTimeseriesTablesInRange(startTime: number, endTime: number): string[] {
  const startTable = getTimeseriesTableName(startTime);
  const endTable = getTimeseriesTableName(endTime);

  if (startTable === endTable) {
    return [startTable];
  }

  const tables: string[] = [];
  const current = new Date(startTime);
  current.setHours(0, 0, 0, 0);
  const endDate = new Date(endTime);

  while (current <= endDate) {
    tables.push(getTimeseriesTableName(current.getTime()));
    current.setDate(current.getDate() + 1);
  }

  return tables;
}

/**
 * 检查时序数据表是否存在
 */
function timeseriesTableExists(tableName: string): boolean {
  if (verifiedTimeseriesTables.has(tableName)) return true;
  const result = getDb().prepare(
    `SELECT 1 FROM sqlite_master WHERE type='table' AND name=?`
  ).get(tableName);
  return result !== undefined;
}

/**
 * 清理过期时序数据（按天删除整张表）
 * @param retentionDays 保留天数
 * @returns 删除的表数量
 */
export function cleanExpiredTimeseriesData(retentionDays: number): number {
  const cutoffTimestamp = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
  const cutoffTable = getTimeseriesTableName(cutoffTimestamp);

  const tables = getAllTimeseriesTables();
  const database = getDb();
  let droppedCount = 0;

  for (const name of tables) {
    // 表名按字典序比较，小于截止日期的表都需要删除
    if (name < cutoffTable) {
      database.exec(`DROP TABLE IF EXISTS ${name}`);
      verifiedTimeseriesTables.delete(name);
      stmtCache.delete(`insertTs_${name}`);
      droppedCount++;
    }
  }

  return droppedCount;
}

/**
 * 插入时序数据（自动路由到对应日期的分表）
 */
export function insertTimeseriesData(deviceUuid: string, dataKey: string, value: number, timestamp: number): RunResult {
  const tableName = getTimeseriesTableName(timestamp);
  ensureTimeseriesTable(tableName);
  const cacheKey = `insertTs_${tableName}`;
  const stmt = getStmt(cacheKey, `
    INSERT INTO ${tableName} (device_uuid, data_key, value, timestamp)
    VALUES (?, ?, ?, ?)
  `);
  return stmt.run(deviceUuid, dataKey, value, timestamp);
}

/**
 * 批量插入时序数据（按天分组，事务写入）
 */
export function batchInsertTimeseriesData(records: Array<{ deviceUuid: string; dataKey: string; value: number; timestamp: number }>): void {
  if (records.length === 0) return;

  // 按日期分组
  const groups = new Map<string, typeof records>();
  for (const record of records) {
    const tableName = getTimeseriesTableName(record.timestamp);
    if (!groups.has(tableName)) {
      groups.set(tableName, []);
    }
    groups.get(tableName)!.push(record);
  }

  const database = getDb();
  const transaction = database.transaction(() => {
    for (const [tableName, items] of groups) {
      ensureTimeseriesTable(tableName);
      const stmt = database.prepare(`
        INSERT INTO ${tableName} (device_uuid, data_key, value, timestamp)
        VALUES (?, ?, ?, ?)
      `);
      for (const item of items) {
        stmt.run(item.deviceUuid, item.dataKey, item.value, item.timestamp);
      }
    }
  });

  transaction();
}

/**
 * 查询设备时序数据（自动跨分表查询）
 * 单日范围直接查对应分表，跨天则 UNION ALL 合并
 */
export function queryTimeseriesData(
  deviceUuid: string,
  dataKey?: string,
  startTime?: number,
  endTime?: number,
  page: number = 1,
  pageSize: number = 1000
): { data: Array<{ device_uuid: string; data_key: string; value: number; timestamp: number; created_at: string }>; total: number; page: number; pageSize: number; totalPages: number } {
  // 确定要查询的分表
  let targetTables: string[];

  if (startTime !== undefined && endTime !== undefined) {
    targetTables = getTimeseriesTablesInRange(startTime, endTime);
  } else if (startTime !== undefined) {
    targetTables = getTimeseriesTablesInRange(startTime, Date.now());
  } else if (endTime !== undefined) {
    const allTables = getAllTimeseriesTables();
    const endTable = getTimeseriesTableName(endTime);
    targetTables = allTables.filter(t => t <= endTable);
  } else {
    // 无时间范围，查询所有现有分表
    targetTables = getAllTimeseriesTables();
  }

  // 过滤出实际存在的表
  const existingTables = targetTables.filter(t => timeseriesTableExists(t));
  if (existingTables.length === 0) return { data: [], total: 0, page, pageSize, totalPages: 0 };

  // 构建 WHERE 条件
  const conditions: string[] = ['device_uuid = ?'];
  const baseParams: unknown[] = [deviceUuid];

  if (dataKey) {
    conditions.push('data_key = ?');
    baseParams.push(dataKey);
  }
  if (startTime !== undefined) {
    conditions.push('timestamp >= ?');
    baseParams.push(startTime);
  }
  if (endTime !== undefined) {
    conditions.push('timestamp <= ?');
    baseParams.push(endTime);
  }

  const whereClause = conditions.join(' AND ');
  const offset = (page - 1) * pageSize;
  const database = getDb();

  if (existingTables.length === 1) {
    const table = existingTables[0];
    // 查总数
    const countSql = `SELECT COUNT(*) as count FROM ${table} WHERE ${whereClause}`;
    const { count: total } = database.prepare(countSql).get(...baseParams) as { count: number };
    // 查分页数据
    const dataSql = `SELECT device_uuid, data_key, value, timestamp, created_at FROM ${table} WHERE ${whereClause} ORDER BY timestamp DESC LIMIT ? OFFSET ?`;
    const data = database.prepare(dataSql).all(...baseParams, pageSize, offset) as Array<{ device_uuid: string; data_key: string; value: number; timestamp: number; created_at: string }>;
    return { data, total, page, pageSize, totalPages: Math.ceil(total / pageSize) };
  }

  // 多表 UNION ALL
  const countSelects = existingTables.map(t => `SELECT COUNT(*) as count FROM ${t} WHERE ${whereClause}`);
  const countSql = `SELECT SUM(count) as count FROM (${countSelects.join(' UNION ALL ')})`;
  const countParams: unknown[] = [];
  for (let i = 0; i < existingTables.length; i++) {
    countParams.push(...baseParams);
  }
  const { count: total } = database.prepare(countSql).get(...countParams) as { count: number };

  const dataSelects = existingTables.map(t =>
    `SELECT device_uuid, data_key, value, timestamp, created_at FROM ${t} WHERE ${whereClause}`
  );
  const dataSql = `SELECT * FROM (${dataSelects.join(' UNION ALL ')}) ORDER BY timestamp DESC LIMIT ? OFFSET ?`;
  const dataParams: unknown[] = [...countParams, pageSize, offset];
  const data = database.prepare(dataSql).all(...dataParams) as Array<{ device_uuid: string; data_key: string; value: number; timestamp: number; created_at: string }>;

  return { data, total: total || 0, page, pageSize, totalPages: Math.ceil((total || 0) / pageSize) };
}
