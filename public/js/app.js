// Giriş ve token yönetimi kaldırıldı; uygulama giriş gerektirmez
  // Uyarı popup'larını tekrar tekrar göstermemek için son düşük stok durumunun özeti
  // Türkçe: Aynı düşük stok listesi tekrar oluşursa popup göstermemek için hash tutuyoruz
  window.__lastLowStockHash = window.__lastLowStockHash || '';
  
  // TR: Ürün listeleme UI durumu (arama, filtre, sayfalama) için basit global state
  window.__productUI = window.__productUI || {
    all: [],      // Tüm ürün verisi (fetch ile gelir)
    page: 1,      // Mevcut sayfa
    pageSize: 10, // Sayfa başına kayıt
    search: '',   // Arama metni (isim/sku)
    lowOnly: false, // Sadece düşük stok filtresi
    bound: false  // Event binding bir kez yapıldı mı?
  };
  // TR: SKU -> En güncel alışın fatura bilgisi (fatura no ve dosya URL) haritası
  window.__productInvoiceMap = window.__productInvoiceMap || {};
  // TR: SKU -> En güncel alışın tedarikçi adı (Üretici Firma) haritası
  window.__productSupplierMap = window.__productSupplierMap || {};

async function createProduct() {
  // Alan doğrulamaları (boş ve sayısal kontrol)
  const name = (document.getElementById('p_name').value || '').trim();
  const sku = (document.getElementById('p_sku').value || '').trim();
  const minStockRaw = (document.getElementById('p_min_stock').value || '0').trim();
  const min_stock_level = Number(minStockRaw || '0');
  // Adet (mevcut stok) alanı opsiyoneldir; boş bırakılırsa güncellenmez
  const qtyRaw = (document.getElementById('p_quantity')?.value || '').trim();
  let current_stock = null;
  if (qtyRaw !== '') {
    const qn = Number(qtyRaw);
    if (Number.isNaN(qn)) { alert('Adet sayısal bir değer olmalıdır'); return; }
    current_stock = qn;
  }

  if (!name) { alert('Ürün adı zorunludur'); return; }
  if (!sku) { alert('SKU zorunludur'); return; }

  const payload = {
    name,
    sku,
    // Kategori ID ve Lokasyon ID artık gönderilmiyor
    min_stock_level: Number.isNaN(min_stock_level) ? 0 : min_stock_level,
    // current_stock null ise backend COALESCE ile mevcut değeri korur
    current_stock,
    // Ürün notu (opsiyonel)
    note: (document.getElementById('p_note')?.value || '').trim() || null
  };
  // Login kaldırıldığı için her zaman public upsert endpoint'i kullanılır
  const upsertEndpoint = '/api/products/public-upsert';
  const res = await fetch(upsertEndpoint, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  const data = await res.json();
  if (!res.ok) return alert(data.error || 'Hata');
  const msg = data.action === 'updated' ? 'Güncellendi' : 'Oluşturuldu';
  alert(`${msg}: #${(data.product && data.product.id) || ''}`);
  // Türkçe: Ürün başarıyla güncellenince listeyi otomatik yenileyelim ki not alanı hemen görünsün
  try { await listProducts(); } catch {}
}

async function listProducts() {
  // TR: Veriyi sunucudan al, UI state'e yaz ve tablo + sayfalama + filtreyi uygula
  const res = await fetch('/api/products', { cache: 'no-store' });
  const data = await res.json();
  const container = document.getElementById('products_table_container');
  if (!container) return;
  if (!res.ok) {
    container.innerHTML = `<div style="color:#b00;">${(data && data.error) || 'Hata'}</div>`;
    return;
  }
  // TR: Tüm ürünleri sakla
  window.__productUI.all = Array.isArray(data) ? data : [];
  // TR: En güncel fatura bilgisini SKU bazında getir (alış listesinden)
  try {
    window.__productInvoiceMap = await buildLatestInvoiceMapBySku();
  } catch (e) {
    // TR: Fatura haritası oluşturulamazsa tablo yine de render edilecek
    window.__productInvoiceMap = {};
  }
  // TR: En güncel tedarikçi adını (Üretici Firma) SKU bazında getir (alış listesinden)
  try {
    window.__productSupplierMap = await buildLatestSupplierMapBySku();
  } catch (e) {
    window.__productSupplierMap = {};
  }
  // TR: Araç çubuğu eventleri bir kez bağla
  if (!window.__productUI.bound) bindProductToolbar();
  // TR: Düşük stok uyarısını (tüm veri üzerinden) göster
  try {
    const lowItems = window.__productUI.all
      .filter(r => Number(r.current_stock ?? 0) <= Number(r.min_stock_level ?? 0))
      .map(r => `${r.name || ''}${r.sku ? ` (SKU: ${r.sku})` : ''}`);
    const lowHash = lowItems.join('|');
    if (lowItems.length > 0 && lowHash !== window.__lastLowStockHash) {
      alert(`Düşük stok uyarısı:\n\n${lowItems.join('\n')}`);
      window.__lastLowStockHash = lowHash;
    }
  } catch {}
  // TR: İlk render
  renderProducts();
}

// TR: Ürünleri arama/filtre/sayfa kurallarına göre hesapla ve ekrana bas
function renderProducts() {
  const state = window.__productUI;
  const container = document.getElementById('products_table_container');
  if (!container) return;
  // TR: Filtre uygula (arama + düşük stok)
  const q = (state.search || '').toLowerCase();
  let filtered = state.all.filter(r => {
    const name = String(r.name || '').toLowerCase();
    const sku = String(r.sku || '').toLowerCase();
    const matchQ = !q || name.includes(q) || sku.includes(q);
    const cs = Number(r.current_stock ?? 0);
    const ms = Number(r.min_stock_level ?? 0);
    const isLow = cs <= ms;
    const matchLow = !state.lowOnly || isLow;
    return matchQ && matchLow;
  });
  // TR: Sayfalama hesapları
  const total = filtered.length;
  const pageSize = Math.max(1, Number(state.pageSize || 10));
  const maxPage = Math.max(1, Math.ceil(total / pageSize));
  if (state.page > maxPage) state.page = maxPage;
  const start = (state.page - 1) * pageSize;
  const pageRows = filtered.slice(start, start + pageSize);
  // TR: Tablo gövdesini üret
  const headerHtml = `
    <thead>
      <tr>
        <th>Üretici Firma</th>
        <th>SKU</th>
        <th>Ürün Resmi</th>
        <th>Orijinal Part Number</th>
        <th>China Part Number</th>
        <th>Fatura No</th>
        <th>Mevcut Stok</th>
        <th>Uyarı Stok Sayısı</th>
        <th>Not</th>
      </tr>
    </thead>`;
  const bodyHtml = pageRows.map(r => {
    const cs = Number(r.current_stock ?? 0);
    const ms = Number(r.min_stock_level ?? 0);
    const low = cs <= ms;
    const trClass = low ? 'low-stock' : '';
    const noteVal = (
      r.note ?? r.product_note ?? r.description ?? r.p_note ?? r.notes ?? r.remark ?? r.remarks ?? r.productNotes ?? r.product_notes ?? r.aciklama ?? ''
    );
    // TR: Bu ürünün en güncel fatura bilgisi (no + link) — SKU üzerinden bulunur
    const skuKey = String(r.sku || '');
    const invInfo = (window.__productInvoiceMap && window.__productInvoiceMap[skuKey]) || null;
    const invNo = invInfo && invInfo.invoice ? String(invInfo.invoice) : '';
    const invUrl = invInfo && invInfo.url ? String(invInfo.url) : '';
    const invoiceCell = invNo ? (invUrl ? `<a href="${invUrl}" target="_blank">${invNo}</a>` : invNo) : '';
    // TR: Üretici Firma: En güncel alıştan tedarikçi adı — SKU üzerinden bulunur
    const supInfo = (window.__productSupplierMap && window.__productSupplierMap[skuKey]) || '';
    const imgUrl = r.image_path ? `/uploads/${String(r.image_path)}` : '';
    const imgCell = `
      <div class="img-cell">
        ${imgUrl ? `<a href="${imgUrl}" target="_blank"><img src="${imgUrl}" alt="img" style="width:48px;height:48px;object-fit:cover;border-radius:4px;border:1px solid #ddd;"/></a>` : '<span style="color:#888;">Yok</span>'}
        <input type="file" accept="image/*" class="product-image-input" data-id="${r.id}" style="display:block;margin-top:4px;" />
      </div>`;
    const opn = String(r.original_part_number || '');
    const cpn = String(r.china_part_number || '');
    return `
      <tr class="${trClass}">
        <td>${supInfo}</td>
        <td><code>${(r.sku ?? '')}</code></td>
        <td>${imgCell}</td>
        <td><input type="text" class="prod-field" data-sku="${r.sku || ''}" data-field="original_part_number" value="${opn.replace(/"/g,'&quot;')}" /></td>
        <td><input type="text" class="prod-field" data-sku="${r.sku || ''}" data-field="china_part_number" value="${cpn.replace(/"/g,'&quot;')}" /></td>
        <td>${invoiceCell}</td>
        <td>${cs}</td>
        <td>${ms}</td>
        <td>${noteVal}</td>
      </tr>`;
  }).join('');
  container.innerHTML = `
    <table class="table-products">
      ${headerHtml}
      <tbody>
        ${bodyHtml || '<tr><td colspan="9">Kayıt bulunamadı</td></tr>'}
      </tbody>
    </table>
    <div class="legend"><span class="legend-box low"></span> Düşük stok (mevcut <= uyarı)</div>
  `;
  // TR: Sayfalama kontrolünü render et
  renderProductsPagination({ total, page: state.page, pageSize, maxPage });

  // TR: Satır içi input eventleri bağla (Orijinal/China Part Number)
  try {
    container.querySelectorAll('input.prod-field').forEach(inp => {
      const sku = inp.getAttribute('data-sku');
      const field = inp.getAttribute('data-field');
      inp.addEventListener('change', async () => {
        const value = inp.value || null;
        try {
          await upsertProductFieldsBySku(sku, { [field]: value });
          // Başarılıysa sessizce yenileyelim
          await listProducts();
        } catch (e) {
          alert('Güncelleme başarısız');
        }
      });
    });
  } catch {}

  // TR: Resim yükleme inputlarını bağla
  try {
    container.querySelectorAll('input.product-image-input').forEach(inp => {
      const id = inp.getAttribute('data-id');
      inp.addEventListener('change', async () => {
        const file = inp.files && inp.files[0];
        if (!file) return;
        try {
          await uploadProductImage(id, file);
          await listProducts();
        } catch (e) {
          alert('Resim yükleme başarısız');
        } finally {
          inp.value = '';
        }
      });
    });
  } catch {}
}

// TR: Sayfalama butonlarını ve sayfa bilgisini üret
function renderProductsPagination(meta) {
  const el = document.getElementById('products_pagination');
  if (!el) return;
  const { total, page, pageSize, maxPage } = meta;
  el.innerHTML = `
    <span class="page-info">Toplam: ${total} • Sayfa ${page}/${maxPage}</span>
    <button class="btn" ${page <= 1 ? 'disabled' : ''} data-page="first">« İlk</button>
    <button class="btn" ${page <= 1 ? 'disabled' : ''} data-page="prev">‹ Önceki</button>
    <button class="btn" ${page >= maxPage ? 'disabled' : ''} data-page="next">Sonraki ›</button>
    <button class="btn" ${page >= maxPage ? 'disabled' : ''} data-page="last">Son »</button>
  `;
  // TR: Olay bağla
  el.querySelectorAll('button[data-page]').forEach(btn => {
    btn.onclick = () => {
      const state = window.__productUI;
      const t = btn.getAttribute('data-page');
      if (t === 'first') state.page = 1;
      else if (t === 'prev') state.page = Math.max(1, state.page - 1);
      else if (t === 'next') state.page = state.page + 1;
      else if (t === 'last') state.page = meta.maxPage;
      renderProducts();
    };
  });
}

// TR: Araç çubuğu (arama kutusu, düşük stok filtresi, sayfa boyutu) event bağlama
function bindProductToolbar() {
  const s = document.getElementById('products_search');
  const low = document.getElementById('products_low_only');
  const ps = document.getElementById('products_page_size');
  if (s) s.addEventListener('input', (e) => { window.__productUI.search = e.target.value; window.__productUI.page = 1; renderProducts(); });
  if (low) low.addEventListener('change', (e) => { window.__productUI.lowOnly = !!e.target.checked; window.__productUI.page = 1; renderProducts(); });
  if (ps) ps.addEventListener('change', (e) => { window.__productUI.pageSize = Number(e.target.value || 10); window.__productUI.page = 1; renderProducts(); });
  window.__productUI.bound = true;
}

async function createPurchase() {
  // Tedarikçi ID alanı tamamen kaldırıldı; yalnızca isim üzerinden işlem yapılacak
  // Artık DOM'dan supplier_id okunmuyor ve backend'e gönderilmiyor
  const sName = (document.getElementById('s2_name')?.value || '').trim();
  // Adres alanı kaldırıldığı için artık okunmuyor
  const form = new FormData();
  form.append('purchase_date', document.getElementById('purchase_date').value);
  form.append('invoice_number', document.getElementById('invoice_number').value);
  form.append('note', document.getElementById('purchase_note').value || '');
  // İşlemi yapan kişi ismi (UI'daki select'ten)
  const createdByName = (document.getElementById('created_by')?.value || '').trim();
  if (createdByName) form.append('created_by_name', createdByName);
  // Kalem 1 için Ürün Güncelle alanları kullanılır; önce SKU'ya göre ürün upsert edilir
  const itemName = document.getElementById('item1_name').value;
  const itemSku = document.getElementById('item1_sku').value;
  // Birim ID kaldırıldı; varsayılan 'Adet' backend'de ayarlanır
  // item1_min_stock elemanı sayfada yok; güvenli erişim ile 0'a düş
  const itemMinStockRaw = document.getElementById('item1_min_stock')?.value || '0';
  const itemMinStock = Number(itemMinStockRaw);
  const itemQty = Number(document.getElementById('item1_quantity').value);
  const itemUnitPrice = Number(document.getElementById('item1_unit_price').value);

  if (!itemSku) {
    alert('SKU zorunludur');
    return;
  }
  if (!itemQty || !itemUnitPrice) {
    alert('Miktar ve Birim Fiyat zorunludur');
    return;
  }

  // Ürünü SKU'ya göre oluştur/güncelle, ID'yi al
  // Token yoksa public upsert endpoint'i kullan
  const upsertEndpoint2 = '/api/products/public-upsert';
  const upsertRes = await fetch(upsertEndpoint2, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: itemName || null,
      sku: itemSku,
      min_stock_level: itemMinStock
    })
  });
  const upsertData = await upsertRes.json();
  if (!upsertRes.ok) {
    // Ürün upsert başarısızsa kullanıcıyı bilgilendir
    alert(upsertData.error || 'Ürün upsert başarısız');
    return;
  }
  const productId = (upsertData.product && upsertData.product.id) || null;
  if (!productId) {
    alert('Ürün ID alınamadı');
    return;
  }

  // Aynı ürün için en son alıştaki birim fiyatı bul ve artış varsa popup ile uyar
  let lastUnitPrice = null;
  let lastDate = null;
  try {
    // Basit yaklaşım: tüm alışları çekip bu ürüne ait en güncel fiyatı bul
    const histRes = await fetch('/api/purchases');
    const hist = await histRes.json();
    if (Array.isArray(hist)) {
      for (const p of hist) {
        const items = Array.isArray(p.items) ? p.items : [];
        for (const it of items) {
          const sameBySku = (it.sku || '') === itemSku;
          const sameById = Number(it.product_id ?? 0) === Number(productId);
          if (sameBySku || sameById) {
            const d = p.purchase_date ? new Date(p.purchase_date) : null;
            if (!lastDate || (d && d > lastDate)) {
              lastDate = d;
              lastUnitPrice = Number(it.unit_price);
            }
          }
        }
      }
    }
  } catch (e) {
    // Geçmiş alışlar okunamazsa uyarı kontrolünü atla
  }
  if (lastUnitPrice != null && Number(itemUnitPrice) > Number(lastUnitPrice)) {
    alert(`Uyarı: Birim fiyat arttı.\nÖnceki: ${lastUnitPrice}\nYeni: ${itemUnitPrice}`);
  }

  const items = [
    {
      product_id: Number(productId),
      quantity: itemQty,
      unit_price: itemUnitPrice
    }
  ];
  form.append('items', JSON.stringify(items));
  // Tedarikçi Email, Telefon ve Adres artık gönderilmiyor; yalnızca ad kullanılır
  // supplier_id olmadığı için isim varsa her zaman supplier nesnesi gönderilir
  if (sName) {
    form.append('supplier', JSON.stringify({ name: sName }));
  }
  const fileInput = document.getElementById('invoice_file');
  if (fileInput && fileInput.files && fileInput.files[0]) {
    form.append('invoice_file', fileInput.files[0]);
  }

  // Login kaldırıldığı için Authorization başlığı gönderilmez; backend gerekirse daha sonra güncellenecek
  const res = await fetch('/api/purchases', { method: 'POST', body: form });
  const data = await res.json();
  const out = document.getElementById('purchases_out');
  if (out) out.textContent = JSON.stringify(data, null, 2);
  if (!res.ok) alert(data.error || 'Hata');
  // Alış oluşturulduktan sonra listeleri tazele
  try { await listProducts(); } catch {}
  try { await listPurchases(); } catch {}
}

// TR: Alış kayıtlarından SKU bazında en güncel fatura bilgisini (no + url) çıkarır
async function buildLatestInvoiceMapBySku() {
  const map = {};
  try {
    const res = await fetch('/api/purchases', { cache: 'no-store' });
    const rows = await res.json();
    if (!res.ok || !Array.isArray(rows)) return map;
    for (const p of rows) {
      const date = p.purchase_date ? new Date(p.purchase_date) : null;
      // TR: Muhtemel dosya URL alanlarını yakala (purchases tablosundaki mantıkla uyumlu)
      const directUrl = p.invoice_url || p.invoice_file_url || p.invoice_file_path || p.invoice_path || p.invoice_file || p.file_url || '';
      const fileName = p.invoice_filename || p.invoice_file_name || p.invoice_name || '';
      const inferredUrl = (!directUrl && fileName) ? `/uploads/${fileName}` : '';
      const fallbackUrl = (!directUrl && !inferredUrl && p.id) ? `/api/purchases/${p.id}/invoice` : '';
      const url = directUrl || inferredUrl || fallbackUrl;
      const invoiceNo = p.invoice_number || '';
      const items = Array.isArray(p.items) ? p.items : [];
      for (const it of items) {
        const sku = String(it.sku || '');
        if (!sku) continue;
        const prev = map[sku];
        if (!prev || (date && (!prev._date || date > prev._date))) {
          map[sku] = { invoice: invoiceNo, url, _date: date };
        }
      }
    }
  } catch (e) {
    // TR: Sessiz başarısızlık; fatura sütunu boş kalır
  }
  // TR: İçte sadece gerekli alanları döndür
  const out = {};
  Object.keys(map).forEach(k => { out[k] = { invoice: map[k].invoice, url: map[k].url }; });
  return out;
}

// TR: Alış kayıtlarından SKU bazında en güncel tedarikçi adını (Üretici Firma) çıkarır
async function buildLatestSupplierMapBySku() {
  const map = {};
  try {
    const res = await fetch('/api/purchases', { cache: 'no-store' });
    const rows = await res.json();
    if (!res.ok || !Array.isArray(rows)) return map;
    for (const p of rows) {
      const date = p.purchase_date ? new Date(p.purchase_date) : null;
      const supplierName = p.supplier_name || '';
      const items = Array.isArray(p.items) ? p.items : [];
      for (const it of items) {
        const sku = String(it.sku || '');
        if (!sku) continue;
        const prev = map[sku];
        if (!prev || (date && (!prev._date || date > prev._date))) {
          map[sku] = { name: supplierName, _date: date };
        }
      }
    }
  } catch (e) {
    // TR: Sessiz başarısızlık; üretici firma sütunu boş kalır
  }
  // TR: Dışa yalnızca ad bilgisini ver
  const out = {};
  Object.keys(map).forEach(k => { out[k] = map[k].name || ''; });
  return out;
}

// Global alana yalnızca gerekli fonksiyonları aç
window.createProduct = createProduct;
window.listProducts = listProducts;
window.createPurchase = createPurchase;

// Alışları listele
async function listPurchases() {
  // Login kaldırıldığı için Authorization başlığı gönderilmez
  const res = await fetch('/api/purchases');
  const data = await res.json();
  const container = document.getElementById('purchases_table_container');
  if (!container) return;
  if (!res.ok) {
    container.innerHTML = `<div style="color:#b00;">${(data && data.error) || 'Hata'}</div>`;
    return;
  }
  const purchases = Array.isArray(data) ? data : [];
  // TR: Artık düzleştirmek yerine başlık + içindeki kalemleri alt tabloda göstereceğiz (liste içinde liste)
  const tableRows = purchases.map(p => {
    const supplier = p.supplier_name || '';
    const dateStr = p.purchase_date ? String(p.purchase_date).slice(0, 10) : '';
    const headerNote = p.note || '';
    const headerActor = p.created_by_name || '';
    const invoiceNo = p.invoice_number || '';
    // TR: Fatura dosyası URL'sini belirle
    const invoiceFileUrl = p.invoice_url || p.invoice_file_url || p.invoice_file_path || p.invoice_path || p.invoice_file || p.file_url || '';
    const invoiceFileName = p.invoice_filename || p.invoice_file_name || p.invoice_name || '';
    const invoiceUploaded = Boolean(p.invoice_uploaded || p.has_invoice || invoiceFileUrl || invoiceFileName);
    const directUrl = invoiceFileUrl;
    const inferredUrl = (!directUrl && invoiceFileName) ? `/uploads/${invoiceFileName}` : '';
    const fallbackUrl = (!directUrl && !inferredUrl && p.id) ? `/api/purchases/${p.id}/invoice` : '';
    const url = directUrl || inferredUrl || fallbackUrl;
    const fileCell = url ? `<a href="${url}" target="_blank">Görüntüle</a>` : (invoiceUploaded ? '<span class="badge badge-file">Dosya eklendi</span>' : '');
    // TR: İç kalem tablosu
    const items = Array.isArray(p.items) ? p.items : [];
    const innerRows = items.map(it => {
      const itemActor = it.item_created_by_name || headerActor;
      const itemNote = (it.item_note != null && it.item_note !== '') ? it.item_note : headerNote;
      return `
        <tr>
          <td>${it.product_name || ''}</td>
          <td><code>${it.sku || ''}</code></td>
          <td>${it.quantity ?? ''}</td>
          <td>${it.unit_price ?? ''}</td>
          <td>${itemNote}</td>
          <td>${itemActor}</td>
        </tr>
      `;
    }).join('');
    const innerTable = `
      <table class="table-products table-nested">
        <thead>
          <tr>
            <th>Ürün Adı</th>
            <th>SKU</th>
            <th>Miktar</th>
            <th>Birim Fiyat</th>
            <th>Not</th>
            <th>İşlemi Yapan</th>
          </tr>
        </thead>
        <tbody>
          ${innerRows || '<tr><td colspan="6">Kalem yok</td></tr>'}
        </tbody>
      </table>
    `;
    // TR: Başlık satırı ve alt satır (iç tablo). Alt satır ilk açılışta gizli gelir; buton ile aç/kapat yapılır
    return `
      <tr class="purchase-header">
        <td><button class="btn btn-toggle" data-pid="${p.id}">Göster</button></td>
        <td>${supplier}</td>
        <td>${dateStr}</td>
        <td>${invoiceNo}</td>
        <td>${headerNote}</td>
        <td>${headerActor}</td>
        <td>${fileCell}</td>
        <td><button class="btn-del" onclick="deletePurchase(${p.id || ''})">Sil</button></td>
      </tr>
      <tr class="purchase-items" id="purchase-items-${p.id}" style="display:none;">
        <td colspan="8">${innerTable}</td>
      </tr>
    `;
  }).join('');

  // TR: Dış tablo başlıkları sadece başlık bilgilerini içerir; kalemler alt tabloda
  const header = `
    <thead>
      <tr>
        <th>Detay</th>
        <th>Tedarikçi</th>
        <th>Tarih</th>
        <th>Fatura No</th>
        <th>Not</th>
        <th>İşlemi Yapan</th>
        <th>Fatura</th>
        <th>Sil</th>
      </tr>
    </thead>`;

  container.innerHTML = `
    <table class="table-products">
      ${header}
      <tbody>
        ${tableRows || '<tr><td colspan="7">Kayıt bulunamadı</td></tr>'}
      </tbody>
    </table>
  `;

  // TR: Genişlet/Kapat butonlarını bağla — inline display toggle ile aç/kapat yapıyoruz
  container.querySelectorAll('.btn-toggle').forEach(btn => {
    btn.addEventListener('click', () => {
      const pid = btn.getAttribute('data-pid');
      const row = document.getElementById(`purchase-items-${pid}`);
      if (!row) return;
      const isHidden = row.style.display === 'none' || row.style.display === '';
      row.style.display = isHidden ? 'table-row' : 'none';
      // TR: Buton etiketini güncelle
      btn.textContent = isHidden ? 'Gizle' : 'Göster';
    });
  });
}
window.listPurchases = listPurchases;

// Alış silme işlemi
async function deletePurchase(id) {
  if (!id) return;
  if (!confirm('Bu alış kaydını silmek istediğinize emin misiniz?')) return;
  const res = await fetch(`/api/purchases/${id}`, { method: 'DELETE' });
  const data = await res.json();
  if (!res.ok || !data.deleted) {
    alert(data.error || 'Silme başarısız');
    return;
  }
  // Silme sonrası listeleri tazele
  try { await listProducts(); } catch {}
  try { await listPurchases(); } catch {}
}
window.deletePurchase = deletePurchase;

// ========== Yardımcılar ==========
async function upsertProductFieldsBySku(sku, fields) {
  if (!sku) throw new Error('sku required');
  const payload = { sku, ...fields };
  const res = await fetch('/api/products/public-upsert', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'upsert failed');
  return data;
}

async function uploadProductImage(id, file) {
  const form = new FormData();
  form.append('image', file);
  const res = await fetch(`/api/products/${id}/image`, { method: 'POST', body: form });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'upload failed');
  return data;
}
