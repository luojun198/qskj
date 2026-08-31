/**
 * ⚠️ DEPRECATED - 此文件已废弃，请勿使用
 * 
 * 本文件是早期的 ACD 解析实现，存在以下问题：
 * 1. 头部结构理解错误（flag+unknown+size 不符合实际格式）
 * 2. 使用 utf8 解码而非 gbk
 * 3. 扫描策略不够严格，可能产生假阳性
 * 
 * 请使用 importAcdToCurrentAccountSet.ts 中的 parseAcdFileTables 函数
 * 该函数已经过生产验证，采用严格的定长头解析策略
 */

import * as fs from 'fs';
import * as path from 'path';
import * as zlib from 'zlib';

interface AcdFileEntry {
  fileName: string;
  offset: number;
  compressedSize: number;
  uncompressedSize: number;
  data?: Buffer;
}

interface AcdFileData {
  entries: AcdFileEntry[];
  tables: Map<string, string>;
}

/**
 * @deprecated 使用 importAcdToCurrentAccountSet.ts 中的 parseAcdFileTables
 */
export function parseAcdFile(filePath: string): AcdFileData {
  throw new Error('parseAcdFile 已废弃，请使用 importAcdToCurrentAccountSet.ts 中的 parseAcdFileTables');
}

/**
 * @deprecated 使用 importAcdToCurrentAccountSet.ts 中的相关函数
 */
export function exportToJson(acdData: AcdFileData, outputPath: string): void {
  throw new Error('exportToJson 已废弃');
}

/**
 * @deprecated
 */
async function main() {
  console.error('❌ parseAcdFile.ts 已废弃');
  console.error('请使用: tsx server/src/scripts/importAcdToCurrentAccountSet.ts <acd文件路径>');
  process.exit(1);
}

// 运行主函数
main();
