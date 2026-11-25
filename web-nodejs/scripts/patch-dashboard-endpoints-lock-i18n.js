#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const langDir = path.join(__dirname, '..', 'lang');

const translations = {
    en: {
        client_config_endpoints_required_title: 'Public client endpoints required',
        client_config_endpoints_required_text: 'Set the public ID server, relay, and API URL in Settings before copying client configuration.',
        client_config_endpoints_required_cta: 'Open public endpoints settings'
    },
    pl: {
        client_config_endpoints_required_title: 'Wymagane publiczne endpointy klienta',
        client_config_endpoints_required_text: 'Ustaw publiczny serwer ID, relay i URL API w Ustawieniach, zanim skopiujesz konfigurację klienta.',
        client_config_endpoints_required_cta: 'Otwórz ustawienia publicznych endpointów'
    },
    de: {
        client_config_endpoints_required_title: 'Öffentliche Client-Endpunkte erforderlich',
        client_config_endpoints_required_text: 'Legen Sie ID-Server, Relay und API-URL in den Einstellungen fest, bevor Sie die Client-Konfiguration kopieren.',
        client_config_endpoints_required_cta: 'Öffentliche Endpunkte öffnen'
    },
    fr: {
        client_config_endpoints_required_title: 'Points de terminaison clients publics requis',
        client_config_endpoints_required_text: 'Définissez le serveur ID, le relais et l’URL API dans Paramètres avant de copier la configuration client.',
        client_config_endpoints_required_cta: 'Ouvrir les points de terminaison publics'
    },
    es: {
        client_config_endpoints_required_title: 'Se requieren endpoints públicos del cliente',
        client_config_endpoints_required_text: 'Configure el servidor ID, el relay y la URL de API en Ajustes antes de copiar la configuración del cliente.',
        client_config_endpoints_required_cta: 'Abrir endpoints públicos'
    },
    it: {
        client_config_endpoints_required_title: 'Endpoint client pubblici obbligatori',
        client_config_endpoints_required_text: 'Imposta server ID, relay e URL API in Impostazioni prima di copiare la configurazione client.',
        client_config_endpoints_required_cta: 'Apri endpoint pubblici'
    },
    pt: {
        client_config_endpoints_required_title: 'Endpoints públicos do cliente obrigatórios',
        client_config_endpoints_required_text: 'Defina o servidor ID, o relay e o URL da API em Definições antes de copiar a configuração do cliente.',
        client_config_endpoints_required_cta: 'Abrir endpoints públicos'
    },
    nl: {
        client_config_endpoints_required_title: 'Openbare client-eindpunten vereist',
        client_config_endpoints_required_text: 'Stel ID-server, relay en API-URL in bij Instellingen voordat u de clientconfiguratie kopieert.',
        client_config_endpoints_required_cta: 'Openbare eindpunten openen'
    },
    cs: {
        client_config_endpoints_required_title: 'Vyžadovány veřejné klientské endpointy',
        client_config_endpoints_required_text: 'Než zkopírujete konfiguraci klienta, nastavte ID server, relay a URL API v Nastavení.',
        client_config_endpoints_required_cta: 'Otevřít veřejné endpointy'
    },
    da: {
        client_config_endpoints_required_title: 'Offentlige klient-endpoints påkrævet',
        client_config_endpoints_required_text: 'Angiv ID-server, relay og API-URL i Indstillinger, før du kopierer klientkonfigurationen.',
        client_config_endpoints_required_cta: 'Åbn offentlige endpoints'
    },
    fi: {
        client_config_endpoints_required_title: 'Julkiset asiakaspäätepisteet vaaditaan',
        client_config_endpoints_required_text: 'Aseta ID-palvelin, relay ja API-URL Asetuksissa ennen asiakaskonfiguraation kopioimista.',
        client_config_endpoints_required_cta: 'Avaa julkiset päätepisteet'
    },
    hu: {
        client_config_endpoints_required_title: 'Nyilvános kliensvégpontok szükségesek',
        client_config_endpoints_required_text: 'Állítsa be az ID-szervert, a relayt és az API URL-t a Beállításokban, mielőtt kimásolja a klienskonfigurációt.',
        client_config_endpoints_required_cta: 'Nyilvános végpontok megnyitása'
    },
    nb: {
        client_config_endpoints_required_title: 'Offentlige klientendepunkter kreves',
        client_config_endpoints_required_text: 'Sett ID-server, relay og API-URL i Innstillinger før du kopierer klientkonfigurasjonen.',
        client_config_endpoints_required_cta: 'Åpne offentlige endepunkter'
    },
    ro: {
        client_config_endpoints_required_title: 'Endpoint-uri publice client necesare',
        client_config_endpoints_required_text: 'Setați serverul ID, relay și URL-ul API în Setări înainte de a copia configurația clientului.',
        client_config_endpoints_required_cta: 'Deschide endpoint-urile publice'
    },
    sv: {
        client_config_endpoints_required_title: 'Offentliga klientslutpunkter krävs',
        client_config_endpoints_required_text: 'Ange ID-server, relay och API-URL i Inställningar innan du kopierar klientkonfigurationen.',
        client_config_endpoints_required_cta: 'Öppna offentliga slutpunkter'
    },
    tr: {
        client_config_endpoints_required_title: 'Genel istemci uç noktaları gerekli',
        client_config_endpoints_required_text: 'İstemci yapılandırmasını kopyalamadan önce Ayarlar’da ID sunucusu, relay ve API URL’sini ayarlayın.',
        client_config_endpoints_required_cta: 'Genel uç noktaları aç'
    },
    uk: {
        client_config_endpoints_required_title: 'Потрібні публічні клієнтські endpoint’и',
        client_config_endpoints_required_text: 'Перш ніж копіювати конфігурацію клієнта, задайте сервер ID, relay і URL API в Налаштуваннях.',
        client_config_endpoints_required_cta: 'Відкрити публічні endpoint’и'
    },
    vi: {
        client_config_endpoints_required_title: 'Cần endpoint công khai của máy khách',
        client_config_endpoints_required_text: 'Hãy đặt máy chủ ID, relay và URL API trong Cài đặt trước khi sao chép cấu hình máy khách.',
        client_config_endpoints_required_cta: 'Mở endpoint công khai'
    },
    ar: {
        client_config_endpoints_required_title: 'نقاط نهاية العميل العامة مطلوبة',
        client_config_endpoints_required_text: 'عيّن خادم ID والترحيل ورابط API في الإعدادات قبل نسخ إعدادات العميل.',
        client_config_endpoints_required_cta: 'فتح نقاط النهاية العامة'
    },
    hi: {
        client_config_endpoints_required_title: 'सार्वजनिक क्लाइंट एंडपॉइंट आवश्यक',
        client_config_endpoints_required_text: 'क्लाइंट कॉन्फ़िगरेशन कॉपी करने से पहले सेटिंग्स में ID सर्वर, relay और API URL सेट करें।',
        client_config_endpoints_required_cta: 'सार्वजनिक एंडपॉइंट खोलें'
    },
    id: {
        client_config_endpoints_required_title: 'Endpoint klien publik wajib',
        client_config_endpoints_required_text: 'Atur server ID, relay, dan URL API di Pengaturan sebelum menyalin konfigurasi klien.',
        client_config_endpoints_required_cta: 'Buka endpoint publik'
    },
    ja: {
        client_config_endpoints_required_title: '公開クライアントエンドポイントが必要です',
        client_config_endpoints_required_text: 'クライアント設定をコピーする前に、設定で ID サーバー、リレー、API URL を指定してください。',
        client_config_endpoints_required_cta: '公開エンドポイントを開く'
    },
    ko: {
        client_config_endpoints_required_title: '공용 클라이언트 엔드포인트 필요',
        client_config_endpoints_required_text: '클라이언트 구성을 복사하기 전에 설정에서 ID 서버, 릴레이, API URL을 지정하세요.',
        client_config_endpoints_required_cta: '공용 엔드포인트 열기'
    },
    th: {
        client_config_endpoints_required_title: 'ต้องตั้งค่า endpoint สาธารณะของไคลเอนต์',
        client_config_endpoints_required_text: 'ตั้งค่าเซิร์ฟเวอร์ ID, รีเลย์ และ URL API ในการตั้งค่าก่อนคัดลอกการกำหนดค่าไคลเอนต์',
        client_config_endpoints_required_cta: 'เปิด endpoint สาธารณะ'
    },
    zh: {
        client_config_endpoints_required_title: '需要公共客户端端点',
        client_config_endpoints_required_text: '复制客户端配置前，请先在设置中配置 ID 服务器、中继和 API URL。',
        client_config_endpoints_required_cta: '打开公共端点设置'
    },
    'zh-TW': {
        client_config_endpoints_required_title: '需要公用用戶端端點',
        client_config_endpoints_required_text: '複製用戶端設定前，請先在設定中設定 ID 伺服器、中繼與 API URL。',
        client_config_endpoints_required_cta: '開啟公用端點設定'
    }
};

const keys = Object.keys(translations.en);

for (const file of fs.readdirSync(langDir).filter((f) => f.endsWith('.json'))) {
    const locale = file.slice(0, -5);
    const filePath = path.join(langDir, file);
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, ''));
    if (!data.dashboard) data.dashboard = {};
    const pack = translations[locale] || translations.en;
    for (const key of keys) {
        data.dashboard[key] = pack[key] || translations.en[key];
    }
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + '\n', 'utf8');
    console.log('patched', locale);
}
