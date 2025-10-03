import { Router } from 'express';
// TR: Login kaldırıldığı için alışlar herkese açık uç noktalardan yapılacak
import { createPurchase } from '../services/purchaseService.js';
import pool from '../db.js';
import multer from 'multer';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const router = Router();

// Multer depolamasını yapılandır
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const uploadDir = path.join(__dirname, '..', '..', 'uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir), // Dosyaların kaydedileceği klasör
  filename: (req, file, cb) => {
    const ts = Date.now();
    const safe = file.originalname.replace(/[^a-zA-Z0-9_.-]/g, '_');
    cb(null, ts + '_' + safe); // Benzersiz ve güvenli bir dosya adı
  }
});
const upload = multer({ storage });

// TR: Alış oluştur (kalemlerle birlikte), stok güncelle ve fiyat uyarısı kaydet (public)
router.post('/', upload.single('invoice_file'), async (req, res) => {
  try {
    const body = req.body || {};
    const file = req.file || null;

    // items alanı string geldiyse JSON'a çevir
    let items = body.items;
    if (typeof items === 'string') {
      try { items = JSON.parse(items); } catch { items = []; }
    }

    const data = {
      supplier_id: body.supplier_id ? Number(body.supplier_id) : null,
      supplier: body.supplier ? JSON.parse(body.supplier) : undefined, // inline tedarikçi oluşturma
      purchase_date: body.purchase_date,
      invoice_number: body.invoice_number,
      invoice_file_path: file ? `/uploads/${file.filename}` : null,
      note: body.note || null,
      items
    };

    // TR: Sadece kullanıcı adı tutulacak; ID eşlemesi yapılmaz
    data.created_by_name = (body.created_by_name || '').trim() || null;
    const result = await createPurchase(data, null);
    return res.status(201).json(result);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: err.message || 'Server error' });
  }
});

// TR: Alışları listele (başlık ve kalemler) - public
router.get('/', async (req, res) => {
  try {
    const [purchases] = await pool.query(
      `SELECT p.id,
              p.supplier_id,
              s.name AS supplier_name,
              p.purchase_date,
              p.invoice_number,
              p.invoice_file_path,
              p.note,
              p.created_by_name
         FROM purchases p
         LEFT JOIN suppliers s ON s.id = p.supplier_id
        ORDER BY p.id DESC`
    );
    const ids = purchases.map(p => p.id);
    let items = [];
    if (ids.length > 0) {
      const [rows] = await pool.query(
        `SELECT pi.id,
                pi.purchase_id,
                pi.product_id,
                pr.name AS product_name,
                pr.sku AS sku,
                pi.quantity,
                pi.unit_price,
                pi.created_by_name AS item_created_by_name, -- TR: Kalem bazlı işlemi yapan
                pi.item_note AS item_note                   -- TR: Kalem bazlı not
           FROM purchase_items pi
           LEFT JOIN products pr ON pr.id = pi.product_id
          WHERE pi.purchase_id IN (${ids.map(()=>'?').join(',')})
          ORDER BY pi.id ASC`,
        ids
      );
      items = rows;
    }
    const grouped = purchases.map(p => ({
      ...p,
      // TR: Kalemlere yeni alanlar dahil edilmiştir (item_created_by_name, item_note)
      items: items.filter(i => i.purchase_id === p.id)
    }));
    return res.json(grouped);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Server error' });
  }
});
// TR: Alış silme (başlık + kalemler) ve stok geri alma (public)
router.delete('/:id', async (req, res) => {
  const id = Number(req.params.id);
  if (!id) return res.status(400).json({ error: 'Geçersiz id' });

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    // TR: Kalemleri oku
    const [items] = await conn.query(
      'SELECT id, product_id, quantity FROM purchase_items WHERE purchase_id = ?',
      [id]
    );

    // TR: Stokları geri al
    for (const it of items) {
      await conn.query(
        'UPDATE products SET current_stock = current_stock - ? WHERE id = ?',
        [it.quantity, it.product_id]
      );
    }

    // TR: Fiyat uyarılarını temizle
    if (items.length > 0) {
      const ids = items.map(i => i.id);
      await conn.query(
        `DELETE FROM price_alerts WHERE purchase_item_id IN (${ids.map(()=>'?').join(',')})`,
        ids
      );
    }

    // TR: Stok hareketlerini kaldır (not eşleşmesine göre)
    await conn.query('DELETE FROM inventory_transactions WHERE note = ?', [
      `Purchase ${id}`
    ]);

    // TR: Kalemler ve alış başlığını sil
    await conn.query('DELETE FROM purchase_items WHERE purchase_id = ?', [id]);
    const [resDel] = await conn.query('DELETE FROM purchases WHERE id = ?', [id]);

    await conn.commit();
    return res.json({ deleted: resDel.affectedRows > 0 });
  } catch (err) {
    await conn.rollback();
    console.error(err);
    return res.status(500).json({ error: 'Server error' });
  } finally {
    conn.release();
  }
});

export default router;
