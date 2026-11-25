#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const langDir = path.join(__dirname, '..', 'lang');

const translations = {
    en: 'Saving also writes the NTP / clock options from the panel below.',
    pl: 'Zapis obejmuje także opcje NTP / zegara z panelu poniżej.',
    de: 'Beim Speichern werden auch die NTP-/Uhr-Optionen aus dem unteren Bereich übernommen.',
    fr: 'L’enregistrement applique aussi les options NTP / horloge du panneau ci-dessous.',
    es: 'Al guardar también se escriben las opciones NTP / reloj del panel inferior.',
    it: 'Il salvataggio include anche le opzioni NTP / orologio del pannello sotto.',
    pt: 'Guardar também grava as opções NTP / relógio do painel abaixo.',
    nl: 'Opslaan schrijft ook de NTP-/klokopties uit het paneel hieronder.',
    cs: 'Uložení také zapíše volby NTP / hodin z panelu níže.',
    da: 'Gemning skriver også NTP-/urindstillingerne fra panelet nedenfor.',
    fi: 'Tallennus kirjoittaa myös alla olevan paneelin NTP-/kelloasetukset.',
    hu: 'A mentés az alábbi panel NTP / óra beállításait is rögzíti.',
    nb: 'Lagring skriver også NTP-/klokkeinnstillingene fra panelet under.',
    ro: 'Salvarea scrie și opțiunile NTP / ceas din panoul de mai jos.',
    sv: 'Sparning skriver också NTP-/klockinställningarna från panelen nedan.',
    tr: 'Kaydetmek ayrıca aşağıdaki paneldeki NTP / saat seçeneklerini de yazar.',
    uk: 'Збереження також записує параметри NTP / годинника з панелі нижче.',
    vi: 'Lưu cũng ghi các tùy chọn NTP / đồng hồ từ bảng bên dưới.',
    ar: 'الحفظ يكتب أيضًا خيارات NTP / الساعة من اللوحة أدناه.',
    hi: 'सहेजने पर नीचे के पैनल के NTP / घड़ी विकल्प भी लिखे जाते हैं।',
    id: 'Menyimpan juga menulis opsi NTP / jam dari panel di bawah.',
    ja: '保存すると下のパネルの NTP / 時計オプションも書き込まれます。',
    ko: '저장 시 아래 패널의 NTP / 시계 옵션도 함께 기록됩니다.',
    th: 'การบันทึกจะเขียนตัวเลือก NTP / นาฬิกาจากแผงด้านล่างด้วย',
    zh: '保存时也会写入下方面板中的 NTP / 时钟选项。',
    'zh-TW': '儲存時也會寫入下方面板的 NTP / 時鐘選項。'
};

for (const file of fs.readdirSync(langDir).filter((f) => f.endsWith('.json'))) {
    const locale = file.slice(0, -5);
    const filePath = path.join(langDir, file);
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, ''));
    if (!data.settings) data.settings = {};
    if (!data.settings.time) data.settings.time = {};
    data.settings.time.save_includes_ntp = translations[locale] || translations.en;
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + '\n', 'utf8');
    console.log('patched', locale);
}
