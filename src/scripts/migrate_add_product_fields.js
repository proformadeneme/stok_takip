import dotenv from 'dotenv';
import pool from '../db.js';

// Adds columns to products table if they do not exist:
// - original_part_number VARCHAR(191) NULL
// - china_part_number VARCHAR(191) NULL
// - image_path VARCHAR(255) NULL

dotenv.config();

async function columnExists(table, column) {
  const [rows] = await pool.query(
    `SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ? LIMIT 1`,
    [table, column]
  );
  return rows.length > 0;
}

async function addColumnIfMissing(table, ddl) {
  const col = ddl.match(/ADD\s+COLUMN\s+`?([a-zA-Z0-9_]+)`?/i)?.[1];
  if (!col) throw new Error('Cannot infer column name from DDL: ' + ddl);
  const exists = await columnExists(table, col);
  if (exists) {
    console.log(`Skip: ${table}.${col} already exists`);
    return;
  }
  console.log(`Altering table ${table}: ${ddl}`);
  await pool.query(`ALTER TABLE ${table} ${ddl}`);
}

async function run() {
  try {
    await addColumnIfMissing('products', 'ADD COLUMN `original_part_number` VARCHAR(191) NULL');
    await addColumnIfMissing('products', 'ADD COLUMN `china_part_number` VARCHAR(191) NULL');
    await addColumnIfMissing('products', 'ADD COLUMN `image_path` VARCHAR(255) NULL');
    console.log('Migration completed.');
  } catch (err) {
    console.error('Migration failed:', err);
    process.exitCode = 1;
  } finally {
    try { await pool.end(); } catch {}
  }
}

run();
