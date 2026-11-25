#!/usr/bin/env node
/**
 * Patch settings.public_endpoints_hint — manual setup, no auto-detect wording.
 * Run: node web-nodejs/scripts/patch-public-endpoints-hint-i18n.js
 */
'use strict';

const fs = require('fs');
const path = require('path');

const langDir = path.join(__dirname, '..', 'lang');

const translations = {
    en: 'Set these values manually for RustDesk clients (ID server, relay, API URL). Required when the console hostname differs from ID/relay/API (reverse proxy / split DNS). Do not leave them empty — there is no auto-detection.',
    pl: 'Ustaw te wartości ręcznie dla klientów RustDesk (serwer ID, relay, URL API). Wymagane, gdy hostname konsoli różni się od ID/relay/API (reverse proxy / osobne DNS). Nie zostawiaj pustych pól — nie ma auto-wykrywania.',
    de: 'Setzen Sie diese Werte manuell für RustDesk-Clients (ID-Server, Relay, API-URL). Erforderlich, wenn der Konsolen-Hostname von ID/Relay/API abweicht (Reverse Proxy / getrenntes DNS). Nicht leer lassen — es gibt keine Auto-Erkennung.',
    fr: 'Définissez ces valeurs manuellement pour les clients RustDesk (serveur ID, relais, URL API). Requis lorsque l’hôte de la console diffère de l’ID/relai/API (proxy inverse / DNS séparé). Ne les laissez pas vides — il n’y a pas de détection automatique.',
    es: 'Configure estos valores manualmente para los clientes RustDesk (servidor ID, relay, URL de API). Obligatorio cuando el hostname de la consola difiere del ID/relay/API (proxy inverso / DNS separado). No los deje vacíos: no hay autodetección.',
    it: 'Imposta questi valori manualmente per i client RustDesk (server ID, relay, URL API). Necessario quando l’hostname della console differisce da ID/relay/API (reverse proxy / DNS separato). Non lasciarli vuoti: non c’è rilevamento automatico.',
    pt: 'Defina estes valores manualmente para os clientes RustDesk (servidor ID, relay, URL da API). Necessário quando o hostname da consola difere do ID/relay/API (proxy inverso / DNS separado). Não os deixe vazios — não há deteção automática.',
    nl: 'Stel deze waarden handmatig in voor RustDesk-clients (ID-server, relay, API-URL). Vereist wanneer de console-hostnaam afwijkt van ID/relay/API (reverse proxy / gesplitst DNS). Laat ze niet leeg — er is geen autodetectie.',
    cs: 'Nastavte tyto hodnoty ručně pro klienty RustDesk (ID server, relay, URL API). Vyžadováno, když se hostname konzole liší od ID/relay/API (reverse proxy / rozdělené DNS). Nenechávejte je prázdné — automatická detekce neexistuje.',
    da: 'Angiv disse værdier manuelt til RustDesk-klienter (ID-server, relay, API-URL). Påkrævet når konsolens værtsnavn adskiller sig fra ID/relay/API (reverse proxy / opdelt DNS). Lad dem ikke være tomme — der er ingen autodetektering.',
    fi: 'Aseta nämä arvot manuaalisesti RustDesk-asiakkaille (ID-palvelin, relay, API-URL). Pakollinen, kun konsolin isäntänimi poikkeaa ID/relay/API:sta (käänteinen välityspalvelin / erillinen DNS). Älä jätä tyhjiksi — automaattista tunnistusta ei ole.',
    hu: 'Állítsa be ezeket az értékeket kézzel a RustDesk kliensekhez (ID-szerver, relay, API URL). Kötelező, ha a konzol hostname eltér az ID/relay/API-tól (reverse proxy / külön DNS). Ne hagyja üresen — nincs automatikus felismerés.',
    nb: 'Sett disse verdiene manuelt for RustDesk-klienter (ID-server, relay, API-URL). Påkrevd når konsollvertsnavnet skiller seg fra ID/relay/API (reverse proxy / delt DNS). Ikke la dem stå tomme — det finnes ingen autodetektering.',
    ro: 'Setați aceste valori manual pentru clienții RustDesk (server ID, relay, URL API). Necesar când hostname-ul consolei diferă de ID/relay/API (proxy invers / DNS separat). Nu le lăsați goale — nu există detectare automată.',
    sv: 'Ange dessa värden manuellt för RustDesk-klienter (ID-server, relay, API-URL). Krävs när konsolens värdnamn skiljer sig från ID/relay/API (reverse proxy / separat DNS). Lämna dem inte tomma — det finns ingen automatisk upptäckt.',
    tr: 'Bu değerleri RustDesk istemcileri için elle ayarlayın (ID sunucusu, relay, API URL). Konsol hostname’i ID/relay/API’den farklıysa gereklidir (ters vekil / ayrı DNS). Boş bırakmayın — otomatik algılama yoktur.',
    uk: 'Встановіть ці значення вручну для клієнтів RustDesk (сервер ID, relay, URL API). Потрібно, якщо хост консолі відрізняється від ID/relay/API (reverse proxy / окремий DNS). Не залишайте порожніми — автовизначення немає.',
    vi: 'Đặt các giá trị này thủ công cho máy khách RustDesk (máy chủ ID, relay, URL API). Bắt buộc khi hostname console khác ID/relay/API (reverse proxy / DNS tách). Không để trống — không có tự động phát hiện.',
    ar: 'اضبط هذه القيم يدويًا لعملاء RustDesk (خادم ID والترحيل ورابط API). مطلوب عندما يختلف اسم مضيف لوحة الويب عن ID/الترحيل/API (proxy عكسي / DNS منفصل). لا تتركها فارغة — لا يوجد اكتشاف تلقائي.',
    hi: 'RustDesk क्लाइंट के लिए ये मान मैन्युअल सेट करें (ID सर्वर, relay, API URL)। जब कंसोल होस्टनाम ID/relay/API से अलग हो तो आवश्यक (रिवर्स प्रॉक्सी / अलग DNS)। खाली न छोड़ें — ऑटो-डिटेक्ट नहीं है।',
    id: 'Atur nilai ini secara manual untuk klien RustDesk (server ID, relay, URL API). Wajib jika hostname konsol berbeda dari ID/relay/API (reverse proxy / DNS terpisah). Jangan biarkan kosong — tidak ada deteksi otomatis.',
    ja: 'RustDesk クライアント向けにこれらの値を手動で設定してください（ID サーバー、リレー、API URL）。コンソールのホスト名が ID/リレー/API と異なる場合に必要です（リバースプロキシ / 分割 DNS）。空欄にしないでください — 自動検出はありません。',
    ko: 'RustDesk 클라이언트용 값을 수동으로 설정하세요(ID 서버, 릴레이, API URL). 콘솔 호스트명이 ID/relay/API와 다를 때 필요합니다(리버스 프록시/분리 DNS). 비워 두지 마세요 — 자동 감지가 없습니다.',
    th: 'ตั้งค่าเหล่านี้ด้วยตนเองสำหรับไคลเอนต์ RustDesk (เซิร์ฟเวอร์ ID, รีเลย์, URL API) จำเป็นเมื่อชื่อโฮสต์คอนโซลต่างจาก ID/relay/API (reverse proxy / DNS แยก) อย่าเว้นว่าง — ไม่มีการตรวจจับอัตโนมัติ',
    zh: '请为 RustDesk 客户端手动设置这些值（ID 服务器、中继、API URL）。当控制台 hostname 与 ID/中继/API 不同时需要（反向代理/分离 DNS）。请勿留空 — 没有自动检测。',
    'zh-TW': '請為 RustDesk 用戶端手動設定這些值（ID 伺服器、中繼、API URL）。當控制台 hostname 與 ID/中繼/API 不同時需要（反向代理/分離 DNS）。請勿留空 — 沒有自動偵測。'
};

for (const file of fs.readdirSync(langDir).filter((f) => f.endsWith('.json'))) {
    const locale = file.slice(0, -5);
    const filePath = path.join(langDir, file);
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, ''));
    if (!data.settings) data.settings = {};
    data.settings.public_endpoints_hint = translations[locale] || translations.en;
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + '\n', 'utf8');
    console.log('patched', locale);
}
