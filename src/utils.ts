/**
 * 公共工具函数
 */
import crypto from 'crypto';

/**
 * 生成随机字符串
 */
export function generateRandomString(length: number = 32): string {
  return crypto.randomBytes(length).toString('hex').slice(0, length);
}

/**
 * 生成authKey
 */
export function generateAuthKey(): string {
  return generateRandomString(16);
}

/**
 * 生成clientId
 */
export function generateClientId(): string {
  return generateRandomString(16);
}

/**
 * 生成密码
 */
export function generatePassword(): string {
  return generateRandomString(16);
}
