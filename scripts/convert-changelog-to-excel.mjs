/**
 * 将 优化日志.txt 解析为 Excel 表格（优化日志.xlsx）
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import ExcelJS from 'exceljs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const inputPath = path.join(rootDir, '优化日志.txt');
const outputPath = path.join(rootDir, '优化日志.xlsx');

function parseChangelog(text) {
  const lines = text.split(/\r?\n/);
  const entries = [];
  let currentDate = '';
  let current = null;
  let currentSection = '';

  const pushCurrent = () => {
    if (current) entries.push(current);
  };

  for (const line of lines) {
    const dateMatch = line.match(/^\s*日期：(\d{4}-\d{2}-\d{2})/);
    if (dateMatch) {
      currentDate = dateMatch[1];
      continue;
    }

    const titleMatch = line.match(/^●\s*(.+)$/);
    if (titleMatch) {
      pushCurrent();
      current = {
        date: currentDate,
        title: titleMatch[1].trim(),
        content: '',
        reason: '',
        usage: '',
      };
      currentSection = '';
      continue;
    }

    if (!current) continue;

    if (line.match(/^\s*【更新内容】/)) {
      currentSection = 'content';
      continue;
    }
    if (line.match(/^\s*【改进原因】/)) {
      currentSection = 'reason';
      continue;
    }
    if (line.match(/^\s*【使用说明】/)) {
      currentSection = 'usage';
      continue;
    }

    if (!currentSection) continue;

    const contentMatch = line.match(/^\s{4,}(.*)$/);
    if (!contentMatch) continue;

    let textLine = contentMatch[1].trim();
    if (!textLine) continue;

    // 去掉列表前缀
    textLine = textLine.replace(/^·\s*/, '');

    const key = currentSection;
    current[key] = current[key] ? `${current[key]}\n${textLine}` : textLine;
  }

  pushCurrent();
  return entries;
}

async function main() {
  const text = fs.readFileSync(inputPath, 'utf8');
  const entries = parseChangelog(text);

  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'CW Finance';
  workbook.created = new Date();

  const sheet = workbook.addWorksheet('优化日志', {
    views: [{ state: 'frozen', ySplit: 1 }],
  });

  sheet.columns = [
    { header: '序号', key: 'index', width: 6 },
    { header: '日期', key: 'date', width: 12 },
    { header: '功能名称', key: 'title', width: 36 },
    { header: '更新内容', key: 'content', width: 60 },
    { header: '改进原因', key: 'reason', width: 40 },
    { header: '使用说明', key: 'usage', width: 36 },
  ];

  const headerRow = sheet.getRow(1);
  headerRow.height = 24;
  headerRow.eachCell((cell) => {
    cell.font = { bold: true, name: 'Microsoft YaHei', size: 11 };
    cell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFE7E6E6' },
    };
    cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    cell.border = {
      top: { style: 'thin' },
      left: { style: 'thin' },
      bottom: { style: 'thin' },
      right: { style: 'thin' },
    };
  });

  entries.forEach((entry, i) => {
    const row = sheet.addRow({
      index: i + 1,
      date: entry.date,
      title: entry.title,
      content: entry.content,
      reason: entry.reason,
      usage: entry.usage,
    });

    row.eachCell((cell, colNumber) => {
      cell.font = { name: 'Microsoft YaHei', size: 10 };
      cell.alignment = {
        vertical: 'top',
        horizontal: colNumber === 1 || colNumber === 2 ? 'center' : 'left',
        wrapText: true,
      };
      cell.border = {
        top: { style: 'thin', color: { argb: 'FFD0D0D0' } },
        left: { style: 'thin', color: { argb: 'FFD0D0D0' } },
        bottom: { style: 'thin', color: { argb: 'FFD0D0D0' } },
        right: { style: 'thin', color: { argb: 'FFD0D0D0' } },
      };
    });
  });

  sheet.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: entries.length + 1, column: 6 },
  };

  await workbook.xlsx.writeFile(outputPath);

  console.log(`已解析 ${entries.length} 条记录`);
  console.log(`输出文件: ${outputPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
