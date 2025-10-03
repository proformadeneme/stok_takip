import pool from '../db.js';

// veri: {
//   supplier_id?,
//   supplier?: { name, email?, phone?, address? },
//   purchase_date, invoice_number, invoice_file_path, note,
//   items: [{product_id, quantity, unit_price}]
// }
export async function createPurchase(data, userId) {
  if (!data || !data.purchase_date || !data.invoice_number || !Array.isArray(data.items) || data.items.length === 0) {
    throw new Error('purchase_date, invoice_number ve en az 1 item gerekli');
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    // Tedarikçi id'sini çöz: varsa supplier_id kullan, yoksa supplier bilgisinden oluştur
    let supplierId = data.supplier_id || null;
    if (!supplierId) {
      const s = data.supplier || {};
      if (!s.name) {
        throw new Error('supplier_id yoksa supplier.name zorunlu');
      }
      try {
        const [sRes] = await conn.query(
          'INSERT INTO suppliers (name, email, phone, address) VALUES (?, ?, ?, ?)',
          [s.name, s.email || null, s.phone || null, s.address || null]
        );
        supplierId = sRes.insertId;
      } catch (err) {
        if (err && err.code === 'ER_DUP_ENTRY') {
          // Benzersiz isme göre mevcut kaydı seç
          const [exRows] = await conn.query('SELECT id FROM suppliers WHERE name = ? LIMIT 1', [s.name]);
          if (!exRows || exRows.length === 0) throw err;
          supplierId = exRows[0].id;
        } else {
        }
      }
    }

    // Alış başlığını oluştur
    // TR: Aynı tedarikçi + fatura no kombinasyonu için mevcut alış başlığı var mı kontrol et
    // TR: Amaç: Aynı fatura numarasıyla tekrar ekleme yapılırken yeni başlık açmak yerine aynı başlığa kalem eklemek
    let purchaseId = null;
    const [existRows] = await conn.query(
      'SELECT id, invoice_file_path FROM purchases WHERE supplier_id = ? AND invoice_number = ? LIMIT 1',
      [supplierId, data.invoice_number]
    );
    if (existRows && existRows.length > 0) {
      // TR: Mevcut başlık bulundu; kalemleri bu başlığa ekleyeceğiz
      purchaseId = existRows[0].id;
      // TR: Eğer bu istekte fatura dosyası yüklendiyse ve başlıkta henüz yoksa başlığı dosya yolu ile güncelle
      if (data.invoice_file_path && !existRows[0].invoice_file_path) {
        await conn.query('UPDATE purchases SET invoice_file_path = ? WHERE id = ?', [data.invoice_file_path, purchaseId]);
      }
      // TR: Not alanı mevcut başlıkta güncellenmez; yeni kalem eklerken başlık notunu değiştirmiyoruz
    } else {
      // TR: Mevcut başlık yok; yeni alış başlığı oluştur
      // TR: Sadece created_by_name alanı saklanır (yalnızca isim tutulur); şemanızda bu kolon yoksa ekleyiniz.
      try {
        const [purchaseResult] = await conn.query(
          `INSERT INTO purchases (supplier_id, purchase_date, invoice_number, invoice_file_path, note, created_by_name)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [supplierId, data.purchase_date, data.invoice_number, data.invoice_file_path || null, data.note || null, data.created_by_name || null]
        );
        purchaseId = purchaseResult.insertId;
      } catch (e) {
        // TR: Nadir yarış koşulunda benzersiz kısıt hatası olursa mevcut başlığı tekrar bul ve kullan
        if (e && e.code === 'ER_DUP_ENTRY') {
          const [rows2] = await conn.query(
            'SELECT id FROM purchases WHERE supplier_id = ? AND invoice_number = ? LIMIT 1',
            [supplierId, data.invoice_number]
          );
          if (!rows2 || rows2.length === 0) throw e;
          purchaseId = rows2[0].id;
        } else {
          throw e;
        }
      }
    }

    const createdItems = [];

    // TR: Kalemler üzerinde dön ve ekle
    for (const item of data.items) {
      if (!item.product_id || !item.quantity || !item.unit_price) {
        throw new Error('Her item için product_id, quantity, unit_price zorunlu');
      }

      // TR: Alış kalemi ekle — mümkünse kalem bazında işlemi yapan ve notu da kaydet
      // TR: Şemanızda purchase_items.created_by_name ve purchase_items.item_note kolonları varsa bunları doldururuz
      let purchaseItemId = null;
      try {
        const [piRes] = await conn.query(
          `INSERT INTO purchase_items (purchase_id, product_id, quantity, unit_price, created_by_name, item_note)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [purchaseId, item.product_id, item.quantity, item.unit_price, (data.created_by_name || null), (data.note || null)]
        );
        purchaseItemId = piRes.insertId;
      } catch (e) {
        // TR: Eğer kolonlar yoksa (ör. üretimde henüz migrate edilmediyse) eski şemaya geri düş
        const [piRes2] = await conn.query(
          `INSERT INTO purchase_items (purchase_id, product_id, quantity, unit_price)
           VALUES (?, ?, ?, ?)`,
          [purchaseId, item.product_id, item.quantity, item.unit_price]
        );
        purchaseItemId = piRes2.insertId;
      }

      // TR: Stok hareketi (+) - user_id kaldırıldı, sadece hareket bilgisi tutulur
      await conn.query(
        `INSERT INTO inventory_transactions (product_id, quantity_change, unit_price, occurred_at, note)
         VALUES (?, ?, ?, NOW(), ?)`,
        [item.product_id, item.quantity, item.unit_price, `Purchase ${purchaseId}`]
      );

      // Ürünün anlık stok değerini güncelle
      await conn.query(
        `UPDATE products SET current_stock = current_stock + ? WHERE id = ?`,
        [item.quantity, item.product_id]
      );

      const [prevRows] = await conn.query(
        `SELECT pi.unit_price
           FROM purchase_items pi
           JOIN purchases p ON p.id = pi.purchase_id
          WHERE pi.product_id = ?
           AND p.id <> ?
         ORDER BY pi.id DESC
         LIMIT 1`,
        [item.product_id, purchaseId]
      );

      if (prevRows && prevRows.length > 0) {
        const oldPrice = Number(prevRows[0].unit_price);
        const newPrice = Number(item.unit_price);
        // TR: Birim fiyat değiştiyse uyarı kaydı oluştur
        if (oldPrice !== newPrice) {
          await conn.query(
            `INSERT INTO price_alerts (product_id, supplier_id, purchase_item_id, old_unit_price, new_unit_price, created_at, note)
             VALUES (?, ?, ?, ?, ?, NOW(), ?)`,
            [item.product_id, supplierId, purchaseItemId, oldPrice, newPrice, 'Auto-generated on purchase']
          );
        }
      }

      createdItems.push({ id: purchaseItemId, ...item });
    }

    await conn.commit();

    return {
      purchase: {
        id: purchaseId,
        supplier_id: supplierId,
        purchase_date: data.purchase_date,
        invoice_number: data.invoice_number,
        invoice_file_path: data.invoice_file_path || null,
        note: data.note || null,
        // TR: Yanıta created_by_name eklenir
        created_by_name: data.created_by_name || null
      },
      items: createdItems
    };
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}
