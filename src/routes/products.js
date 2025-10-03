import { Router } from 'express';
import pool from '../db.js';
import { authenticate } from '../middleware/auth.js';
import { requireRole } from '../middleware/roles.js';
import multer from 'multer';
import path from 'path';
import fs from 'fs';

const router = Router();
// TR: Tercih 2: unit_id ve units ilişkisi tamamen kaldırıldı.

// Ürünleri listele
router.get('/', authenticate, async (req, res) => {
  try {
    // TR: units tablosu kaldırıldığı için sadece ürün alanları listelenir
    const [rows] = await pool.query(
      `SELECT p.id, p.name, p.sku, p.current_stock, p.min_stock_level, p.note,
              p.original_part_number, p.china_part_number, p.image_path
       FROM products p
       ORDER BY p.id DESC`
    );
    return res.json(rows);
  } catch (err) {
    console.error(err);
    // TR: Hata durumunda 500 dön
    return res.status(500).json({ error: 'Server error' });
  }
});

// TR: Giriş yapmadan ürün upsert (Sadece geliştirme/özel kullanım için)
// TR: Güvenlik için .env içinde PUBLIC_PRODUCT_UPSERT = 'true' olduğunda aktif olur
router.post('/public-upsert', async (req, res) => {
  try {
    if (process.env.PUBLIC_PRODUCT_UPSERT !== 'true') {
      return res.status(403).json({ error: 'Public upsert disabled' });
    }
    // TR: unit_id tamamen kaldırıldı
    const { name, sku, current_stock = null, min_stock_level = null, note = null,
      original_part_number = null, china_part_number = null } = req.body || {};
    if (!sku) return res.status(400).json({ error: 'sku required' });

    const [existing] = await pool.query('SELECT id FROM products WHERE sku = ? LIMIT 1', [sku]);
    if (existing.length > 0) {
      const id = existing[0].id;
      await pool.query(
        `UPDATE products SET 
           name = COALESCE(?, name),
           current_stock = COALESCE(?, current_stock),
           min_stock_level = COALESCE(?, min_stock_level),
           note = COALESCE(?, note),
           original_part_number = COALESCE(?, original_part_number),
           china_part_number = COALESCE(?, china_part_number)
         WHERE id = ?`,
        [name ?? null, current_stock, min_stock_level, note ?? null, original_part_number ?? null, china_part_number ?? null, id]
      );
      const [rows] = await pool.query('SELECT * FROM products WHERE id = ?', [id]);
      return res.json({ action: 'updated', product: rows[0] });
    } else {
      // TR: Yeni üründe isim yoksa SKU'yu isim olarak kullan
      const finalName = name || sku;
      // TR: DB'de category_id/location_id NOT NULL olabilir; NULL yazmak için alanları ekleyip null geçiyoruz
      const [result] = await pool.query(
        `INSERT INTO products (name, sku, category_id, location_id, current_stock, min_stock_level, note, original_part_number, china_part_number)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [finalName, sku, null, null, current_stock ?? 0, min_stock_level ?? 0, note ?? null, original_part_number ?? null, china_part_number ?? null]
      );
      const [rows] = await pool.query('SELECT * FROM products WHERE id = ?', [result.insertId]);
      return res.status(201).json({ action: 'created', product: rows[0] });
    }
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: err.message || 'Server error' });
  }
});

// Ürün oluştur (admin)
router.post('/', authenticate, requireRole(['admin']), async (req, res) => {
  // TR: Kategori ID ve Lokasyon ID artık kabul edilmiyor
  const { name, sku, current_stock = 0, min_stock_level = 0, note = null, original_part_number = null, china_part_number = null } = req.body || {};
  if (!name || !sku) return res.status(400).json({ error: 'name, sku required' });
  try {
    // TR: DB'de category_id/location_id NOT NULL olabilir; NULL yazmak için alanları ekleyip null geçiyoruz
    const [result] = await pool.query(
      `INSERT INTO products (name, sku, category_id, location_id, current_stock, min_stock_level, note, original_part_number, china_part_number)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [name, sku, null, null, current_stock, min_stock_level, note, original_part_number ?? null, china_part_number ?? null]
    );
    const [rows] = await pool.query('SELECT * FROM products WHERE id = ?', [result.insertId]);
    return res.status(201).json(rows[0]);
  } catch (err) {
    if (err && err.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'SKU already exists' });
    // TR: Hata mesajını ilet (debug için)
    return res.status(500).json({ error: err.message || 'Server error' });
  }
});

// Ürün güncelle (admin)
router.put('/:id', authenticate, requireRole(['admin']), async (req, res) => {
  const { id } = req.params;
  // TR: Kategori ID ve Lokasyon ID güncelleme kapsamından çıkarıldı
  const { name, sku, unit_id, current_stock, min_stock_level, note = null, original_part_number = null, china_part_number = null, image_path = null } = req.body || {};
  try {
    const [result] = await pool.query(
      `UPDATE products SET 
         name = COALESCE(?, name),
         sku = COALESCE(?, sku),
         unit_id = COALESCE(?, unit_id),
         current_stock = COALESCE(?, current_stock),
         min_stock_level = COALESCE(?, min_stock_level),
         note = COALESCE(?, note),
         original_part_number = COALESCE(?, original_part_number),
         china_part_number = COALESCE(?, china_part_number),
         image_path = COALESCE(?, image_path)
       WHERE id = ?`,
      [name ?? null, sku ?? null, unit_id ?? null, current_stock ?? null, min_stock_level ?? null, note ?? null, original_part_number ?? null, china_part_number ?? null, image_path ?? null, id]
    );
    if (result.affectedRows === 0) return res.status(404).json({ error: 'Not found' });
    const [rows] = await pool.query('SELECT * FROM products WHERE id = ?', [id]);
    return res.json(rows[0]);
  } catch (err) {
    if (err && err.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'SKU already exists' });
    console.error(err);
    return res.status(500).json({ error: 'Server error' });
  }
});

// SKU'ya göre upsert (admin): SKU varsa güncelle, yoksa oluştur
router.post('/upsert', authenticate, requireRole(['admin']), async (req, res) => {
  // TR: Kategori ID ve Lokasyon ID upsert sürecinden çıkarıldı
  const { name, sku, current_stock = null, min_stock_level = null, note = null, original_part_number = null, china_part_number = null } = req.body || {};
  if (!sku) return res.status(400).json({ error: 'sku required' });
  try {
    // Check existing by SKU
    const [existing] = await pool.query('SELECT id FROM products WHERE sku = ? LIMIT 1', [sku]);
    if (existing.length > 0) {
      const id = existing[0].id;
      await pool.query(
        `UPDATE products SET 
           name = COALESCE(?, name),
           current_stock = COALESCE(?, current_stock),
           min_stock_level = COALESCE(?, min_stock_level),
           note = COALESCE(?, note),
           original_part_number = COALESCE(?, original_part_number),
           china_part_number = COALESCE(?, china_part_number)
         WHERE id = ?`,
        [name ?? null, current_stock, min_stock_level, note ?? null, original_part_number ?? null, china_part_number ?? null, id]
      );
      const [rows] = await pool.query('SELECT * FROM products WHERE id = ?', [id]);
      return res.json({ action: 'updated', product: rows[0] });
    } else {
      // TR: Yeni üründe isim yoksa SKU'yu isim olarak kullan
      const finalName = name || sku;
      // TR: DB'de category_id/location_id NOT NULL olabilir; NULL yazmak için alanları ekleyip null geçiyoruz
      const [result] = await pool.query(
        `INSERT INTO products (name, sku, category_id, location_id, current_stock, min_stock_level, note, original_part_number, china_part_number)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [finalName, sku, null, null, current_stock ?? 0, min_stock_level ?? 0, note ?? null, original_part_number ?? null, china_part_number ?? null]
      );
      const [rows] = await pool.query('SELECT * FROM products WHERE id = ?', [result.insertId]);
      return res.status(201).json({ action: 'created', product: rows[0] });
    }
  } catch (err) {
    console.error(err);
    // TR: Hata mesajını ilet (debug için)
    return res.status(500).json({ error: err.message || 'Server error' });
  }
});

// ========== Ürün Resmi Yükleme ==========
// uploads/products klasörünü garanti altına al
const uploadsRoot = path.join(process.cwd(), 'uploads');
const productUploadsDir = path.join(uploadsRoot, 'products');
try {
  if (!fs.existsSync(uploadsRoot)) fs.mkdirSync(uploadsRoot);
  if (!fs.existsSync(productUploadsDir)) fs.mkdirSync(productUploadsDir);
} catch {}

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, productUploadsDir);
  },
  filename: function (req, file, cb) {
    const ext = path.extname(file.originalname || '').toLowerCase();
    const base = path.basename(file.originalname || 'file', ext).replace(/[^a-zA-Z0-9_-]/g, '_');
    const ts = Date.now();
    cb(null, `${base}_${ts}${ext}`);
  }
});
const upload = multer({ storage });

// TR: Resim yükleme ve image_path güncelleme
router.post('/:id/image', upload.single('image'), async (req, res) => {
  const { id } = req.params;
  if (!req.file) return res.status(400).json({ error: 'image file required' });
  // URL, app.js içindeki static mount ile /uploads/products/... şeklinde servis edilir
  const relPath = path.join('products', req.file.filename).replace(/\\/g, '/');
  try {
    const [result] = await pool.query('UPDATE products SET image_path = ? WHERE id = ?', [relPath, id]);
    if (result.affectedRows === 0) return res.status(404).json({ error: 'Not found' });
    const [rows] = await pool.query('SELECT * FROM products WHERE id = ?', [id]);
    return res.json({ uploaded: true, product: rows[0], url: `/uploads/${relPath}` });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: err.message || 'Server error' });
  }
});

export default router;
