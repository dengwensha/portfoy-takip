# Portföy Takip

Borsalara göre gruplu kripto portföy takip uygulaması. React + Vite ile yazıldı, CoinGecko API'sinden canlı fiyat çeker.

## Yerelde çalıştırmak (opsiyonel)

```
npm install
npm run dev
```

## Vercel'e deploy etmek

1. Bu klasördeki tüm dosyaları bir GitHub reposuna yükle (node_modules ve dist hariç — .gitignore zaten onları dışarıda bırakıyor).
2. vercel.com adresine git, "Continue with GitHub" ile giriş yap.
3. "Add New… → Project" de, az önce yüklediğin reponu seç.
4. Vercel, Vite projesini otomatik tanır — hiçbir ayar değiştirmeden "Deploy" butonuna bas.
5. Birkaç saniye içinde `senin-proje-adin.vercel.app` linkin hazır olur.

## Notlar

- CoinGecko API anahtarı isteğe bağlı; uygulama içinde "API anahtarı ekle" bölümünden ekleyebilirsin. Ücretsiz anahtar: coingecko.com/en/api/pricing
- Portföy verilerin ve API anahtarın tarayıcının localStorage'ında saklanır, sunucuya gönderilmez.
