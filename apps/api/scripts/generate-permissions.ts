import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import {
  permissionMatrix,
  roleKeys,
} from '../../../packages/shared/src/permissions.js';

const path = fileURLToPath(
  new URL('../../../docs/PERMISSIONS.md', import.meta.url),
);
const start = '<!-- permission-matrix:start -->';
const end = '<!-- permission-matrix:end -->';
const rows = [
  ['Permission', ...roleKeys],
  ['---', ...roleKeys.map(() => '---')],
  ...Object.entries(permissionMatrix).map(([key, grants]) => [key, ...grants]),
];
const widths = rows[0]!.map((_, index) =>
  Math.max(...rows.map((row) => row[index]!.length)),
);
const table = rows
  .map(
    (row) =>
      '| ' +
      row.map((cell, index) => cell.padEnd(widths[index]!)).join(' | ') +
      ' |',
  )
  .join('\n');
const original = await readFile(path, 'utf8');
const first = original.indexOf(start);
const last = original.indexOf(end);
if (first < 0 || last <= first)
  throw new Error('Permission matrix markers missing');
const expected =
  original.slice(0, first + start.length) +
  '\n' +
  table +
  '\n' +
  original.slice(last);
if (process.argv.includes('--check')) {
  if (expected.replaceAll('\r\n', '\n') !== original.replaceAll('\r\n', '\n'))
    throw new Error('docs/PERMISSIONS.md matrix is stale');
} else {
  await writeFile(path, expected);
}
