# Stok Takip Backend (Node.js + Express + MySQL)

Bu proje, verilen MySQL şeması üzerine kullanıcı girişi (JWT), rol bazlı yetki, ürün yönetimi, satın alma işlemleri, stok hareketleri ve fiyat uyarısı mantığını içeren örnek bir backend uygular. Basit bir HTML arayüz ile test edilebilir.

## Kurulum

1) Ortam değişkenleri

```
cp .env.example .env
```

`.env` dosyasını kendi MySQL kullanıcı/parolanızla ve JWT secret ile güncelleyin.

2) Bağımlılıklar

```
npm install
```

3) Çalıştırma

```
npm run dev
```

Tarayıcı: http://localhost:3000

## Gerekli Tablolar

İsteminizde belirtilen tabloların MySQL'de oluşturulmuş olması gerekir. (Önceden oluşturduğunuz şemayı kullanın.)

## Örnek Kullanım

- Giriş: `/api/auth/login` (POST) `{ email, password }`
- Ürün listesi: `/api/products` (GET)
- Ürün ekleme: `/api/products` (POST, admin/manager)
- Alış ekleme: `/api/purchases` (POST)

`public/index.html` içindeki basit arayüz ile bu istekleri test edebilirsiniz.

## Admin Kullanıcı

Veritabanına en az bir aktif kullanıcı ekleyin. Parolayı bcrypt ile hashleyin. Örnek Node.js snippet:

```js
import bcrypt from 'bcryptjs';
const hash = await bcrypt.hash('Admin123!', 10);
// INSERT INTO users (full_name, email, password_hash, role, is_active) VALUES ('Admin', 'admin@example.com', hash, 'admin', 1)
```

## Notlar

- `createPurchase` servisinde tüm işlem tek bir DB transaction'ı içinde yapılır: purchase, items, inventory_transactions, product stok güncelleme ve gerekiyorsa price_alerts.
- Fiyat kıyası, aynı ürüne ait bir önceki `purchase_items` kaydının birim fiyatı ile yapılır. Fark varsa `price_alerts` tablosuna eklenir.
- Kod yapısı modülerdir: `routes/`, `services/`, `middleware/`, `db.js`.
