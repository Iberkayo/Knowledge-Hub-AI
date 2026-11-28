# Güvenlik Mimarisi ve Sınırlar (v0.5.0)

Bu belge Knowledge Hub AI'ın yerel güvenlik tasarımını, veri koruma mekanizmalarını ve bilinen güvenlik sınırlarını özetler.

---

## 1. API Anahtarı Saklama Mimarisi (`knowledge_hub/secrets.py`)

- **Windows (DPAPI):** Windows üzerinde `CryptProtectData` / `CryptUnprotectData` kullanılarak API anahtarları mevcut Windows kullanıcı profiline bağlı olarak şifrelenir (`encoding: "dpapi-b64"`) ve varsayılan olarak `outputs/.secrets.json` dosyasına atomik olarak yazılır.
- **POSIX (macOS / Linux):** DPAPI bulunmayan ortamlarda anahtarlar yerel dosyada (`encoding: "plain-b64"`) `0o600` (yalnızca dosya sahibi okuyabilir/yazabilir) izinleriyle saklanır.
- **Ortam Değişkeni Desteği:** `OPENROUTER_API_KEY`, `OPENAI_API_KEY`, `ELEVENLABS_API_KEY` ve `KH_CUSTOM_LLM_API_KEY` ortam değişkenleri desteklenir.
- **SQLite İzolasyonu:** API anahtarları hiçbir zaman `outputs/library.sqlite3` veritabanına yazılmaz.
- **Maskeleme ve Sıfır Ham Anahtar Politikası:** HTTP yanıtları (ör. `/api/settings`) ham API anahtarını hiçbir zaman tarayıcıya/frontend'e döndürmez; yalnızca `mask_secret()` ile üretilmiş maskelenmiş önizleme (ör. `sk-o••••9f1a` veya kısa anahtarlar için `••••`) iletilir.
- **Git Koruması:** `.gitignore` dosyası `.env`, `outputs/`, `.secrets*`, `*.dpapi`, `*.sqlite3`, `*.db` ve ses dosyalarını hariç tutar.

---

## 2. Ağ ve SSRF Koruması (`knowledge_hub/fetch_public.py`)

Kullanıcının açıkça tetiklediği URL, RSS/Atom ve ses indirme isteklerinde aşağıdaki korumalar uygulanır:

- **Yalnızca Genel HTTPS (Port 443):** `http://`, standart dışı portlar, URL içi kullanıcı adı/parola, fragment veya kontrol karakterleri reddedilir.
- **Tek Seferlik DNS Çözümleme ve Public-IP Pinning:** Hedef alan adı tek seferde çözümlenir; dönen **tüm** IP adreslerinin `ipaddress.is_global` olduğu ve multicast olmadığı doğrulanır (loopback, RFC1918 özel ağlar, link-local, bulut metadata IP'leri engellenir). Bağlantı `PinnedHTTPS` üzerinden doğrudan doğrulanan IP'ye açılır ve TLS sertifikası `server_hostname` (SNI) ile doğrulanır (DNS rebinding riskini azaltır).
- **Yönlendirme (Redirect) Sınırları:**
  - `fetch_public()` varsayılan olarak yönlendirmeleri kapalı tutar (`max_redirects=0`).
  - Kullanıcı tetiklemeli makale/besleme içe aktarmada her yönlendirme adımı yeniden `resolve_public()` kontrolünden geçer (en fazla 2 adım; ses indirmede en fazla 3 adım).
- **MIME ve İçerik Türü Beyaz Listesi:**
  - HTML: `text/html`, `application/xhtml+xml`
  - Feed/XML: `application/rss+xml`, `application/atom+xml`, `application/xml`, `text/xml`
  - Ses: `audio/*`, `application/octet-stream`, `binary/octet-stream`, `video/mp4`
- **Boyut ve Sıkıştırma (Zip/Gzip Bomb) Sınırları:**
  - HTML üst sınırı: **3 MB**
  - XML/Feed üst sınırı: **2.5 MB**
  - Ses dosyası üst sınırı: **100 MB**
  - `gzip`/`deflate` açılımı artımlı olarak yapılır ve açılmış boyut üst sınırı aşarsa istek reddedilir (`max_redirects=0` modunda sıkıştırılmış yanıt hiç kabul edilmez).
- **Kimlik Bilgisi Yok:** Çerez, yetkilendirme başlığı veya proxy kullanılmaz; arka planda habersiz ağ isteği yapılmaz.

---

## 3. XSS'siz Pure-DOM Render (`knowledge_hub/static/render.js`)

- Dış kaynaklardan gelen makale, besleme, başlık, not ve çeviri metinleri `innerHTML` ile doğrudan DOM'a basılmaz.
- Arayüz, `document.createElement`, `textContent` ve güvenli özellik atamaları (pure-DOM) kullanarak içerikleri oluşturur.
- Bu yaklaşım, içe aktarılan HTML/RSS veya yapay zekâ çıktılarından kaynaklanabilecek Cross-Site Scripting (XSS) riskini önemli ölçüde azaltır.

---

## 4. Belge ve EPUB Zip-Slip Koruması (`knowledge_hub/media.py`)

- **Dosya Boyutu Sınırı:** PDF ve EPUB dosyaları en fazla **50 MB** olabilir.
- **PDF Sayfa Sınırı:** En fazla **500 sayfa** işlenir.
- **EPUB Zip-Slip Koruması:** Arşiv içindeki `container.xml` ve `manifest` yolları `_safe_zip_member()` ile normalize edilir; `../` veya `/` ile başlayan dışarı taşma girişimleri reddedilir.
- **EPUB Genişleme (Zip Bomb) Sınırı:** Arşiv içindeki dosyaların toplam açılmış boyutu **100 MB** ile sınırlıdır.
- **XXE Koruması:** EPUB XML ayrıştırması standart `xml.etree` yerine **`defusedxml`** ile yapılır.

---

## 5. Loopback-Only Uyarısı ve Bilinen Güvenlik Sınırları

- **Yalnızca `127.0.0.1`:** Sunucu tek kullanıcılı yerel masaüstü kullanımı için tasarlanmıştır ve kimlik doğrulama/oturum yönetimi içermez. Sunucuyu `--host 0.0.0.0` ile yerel ağa veya internete **açmayın**.
- **SSRF Sertifikasyonu Değildir:** `fetch_public.py` katmanlı ve iyi niyetli bir koruma sunar ancak kurumsal düzeyde çok kiracılı bir SSRF güvenlik duvarının yerini tutmaz.
- **POSIX Anahtar Dosyası:** Windows dışındaki sistemlerde `0o600` izinli dosya işletim sistemi düzeyinde şifreleme sağlamaz; bu sistemlerde anahtarları ortam değişkeni olarak vermek veya sistem anahtarlığı kullanmak tercih edilmelidir.
- **Üçüncü Taraf API Maliyeti ve Gizliliği:** OpenRouter, OpenAI veya ElevenLabs kullanıldığında gönderilen metinler ilgili sağlayıcının gizlilik ve ücretlendirme politikalarına tabidir. Yetkisiz veya gizli/kurumsal verileri harici API'lere göndermeyin.
- **İçerik Hakları:** Yalnızca okuma/işleme yetkiniz olan kaynakları içe aktarın ve üretilen çıktıları izinsiz yeniden dağıtmayın.
