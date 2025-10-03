import { Router } from 'express';
import pool from '../db.js';
import { authenticate } from '../middleware/auth.js';
import { requireRole } from '../middleware/roles.js';

const router = Router();
// TR: Tercih 2: unit_id ve units ilişkisi tamamen kaldırıldı.

// Ürünleri listele
router.get('/', authenticate, async (req, res) => {
  try {
    // TR: units tablosu kaldırıldığı için sadece ürün alanları listelenir
    const [rows] = await pool.query(
      `SELECT p.id, p.name, p.sku, p.current_stock, p.min_stock_level, p.note
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
    const { name, sku, current_stock = null, min_stock_level = null, note = null } = req.body || {};
    if (!sku) return res.status(400).json({ error: 'sku required' });

    const [existing] = await pool.query('SELECT id FROM products WHERE sku = ? LIMIT 1', [sku]);
    if (existing.length > 0) {
      const id = existing[0].id;
      await pool.query(
        `UPDATE products SET 
           name = COALESCE(?, name),
           current_stock = COALESCE(?, current_stock),
           min_stock_level = COALESCE(?, min_stock_level),
           note = COALESCE(?, note)
         WHERE id = ?`,
        [name ?? null, current_stock, min_stock_level, note ?? null, id]
      );
      const [rows] = await pool.query('SELECT * FROM products WHERE id = ?', [id]);
      return res.json({ action: 'updated', product: rows[0] });
    } else {
      // TR: Yeni üründe isim yoksa SKU'yu isim olarak kullan
      const finalName = name || sku;
      // TR: DB'de category_id/location_id NOT NULL olabilir; NULL yazmak için alanları ekleyip null geçiyoruz
      const [result] = await pool.query(
        `INSERT INTO products (name, sku, category_id, location_id, current_stock, min_stock_level, note)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [finalName, sku, null, null, current_stock ?? 0, min_stock_level ?? 0, note ?? null]
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
  const { name, sku, current_stock = 0, min_stock_level = 0, note = null } = req.body || {};
  if (!name || !sku) return res.status(400).json({ error: 'name, sku required' });
  try {
    // TR: DB'de category_id/location_id NOT NULL olabilir; NULL yazmak için alanları ekleyip null geçiyoruz
    const [result] = await pool.query(
      `INSERT INTO products (name, sku, category_id, location_id, current_stock, min_stock_level, note)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [name, sku, null, null, current_stock, min_stock_level, note]
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
  const { name, sku, unit_id, current_stock, min_stock_level, note = null } = req.body || {};
  try {
    const [result] = await pool.query(
      `UPDATE products SET 
         name = COALESCE(?, name),
         sku = COALESCE(?, sku),
         unit_id = COALESCE(?, unit_id),
         current_stock = COALESCE(?, current_stock),
         min_stock_level = COALESCE(?, min_stock_level),
         note = COALESCE(?, note)
       WHERE id = ?`,
      [name ?? null, sku ?? null, unit_id ?? null, current_stock ?? null, min_stock_level ?? null, note ?? null, id]
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
  const { name, sku, current_stock = null, min_stock_level = null, note = null } = req.body || {};
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
           note = COALESCE(?, note)
         WHERE id = ?`,
        [name ?? null, current_stock, min_stock_level, note ?? null, id]
      );
      const [rows] = await pool.query('SELECT * FROM products WHERE id = ?', [id]);
      return res.json({ action: 'updated', product: rows[0] });
    } else {
      // TR: Yeni üründe isim yoksa SKU'yu isim olarak kullan
      const finalName = name || sku;
      // TR: DB'de category_id/location_id NOT NULL olabilir; NULL yazmak için alanları ekleyip null geçiyoruz
      const [result] = await pool.query(
        `INSERT INTO products (name, sku, category_id, location_id, current_stock, min_stock_level, note)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [finalName, sku, null, null, current_stock ?? 0, min_stock_level ?? 0, note ?? null]
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

export default router;
