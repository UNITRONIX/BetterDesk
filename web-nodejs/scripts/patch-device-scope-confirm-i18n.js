#!/usr/bin/env node
/**
 * Patch device-scope confirm/restart i18n keys across all locales.
 * Run: node web-nodejs/scripts/patch-device-scope-confirm-i18n.js
 */
'use strict';

const fs = require('fs');
const path = require('path');

const langDir = path.join(__dirname, '..', 'lang');

const translations = {
    en: {
        device_scope_confirm_title: 'Save device visibility default?',
        device_scope_confirm_open: 'Non-admin users without folder, group, or device grants will see all devices (open / legacy mode). Continue and save?',
        device_scope_confirm_restricted: 'Restricted mode: non-admin users without folder, group, or device grants will see an empty device list. Continue and save?',
        device_scope_restart_title: 'Restart services?',
        device_scope_restart_message: 'The visibility default is saved. Restart BetterDesk services now so every component reloads it, or continue later without restarting.',
        device_scope_restart_later: 'Later'
    },
    pl: {
        device_scope_confirm_title: 'Zapisać domyślną widoczność urządzeń?',
        device_scope_confirm_open: 'Użytkownicy bez roli admin i bez grantów folderów, grup lub urządzeń zobaczą wszystkie urządzenia (tryb otwarty / legacy). Kontynuować i zapisać?',
        device_scope_confirm_restricted: 'Tryb ograniczony: użytkownicy bez roli admin i bez grantów folderów, grup lub urządzeń zobaczą pustą listę. Kontynuować i zapisać?',
        device_scope_restart_title: 'Zrestartować usługi?',
        device_scope_restart_message: 'Domyślna widoczność została zapisana. Zrestartuj teraz usługi BetterDesk, aby wszystkie komponenty ją przeładowały, albo kontynuuj później bez restartu.',
        device_scope_restart_later: 'Później'
    },
    de: {
        device_scope_confirm_title: 'Standard-Gerätesichtbarkeit speichern?',
        device_scope_confirm_open: 'Nicht-Admin-Benutzer ohne Ordner-, Gruppen- oder Gerätefreigaben sehen alle Geräte (offener / Legacy-Modus). Fortfahren und speichern?',
        device_scope_confirm_restricted: 'Eingeschränkter Modus: Nicht-Admin-Benutzer ohne Ordner-, Gruppen- oder Gerätefreigaben sehen eine leere Geräteliste. Fortfahren und speichern?',
        device_scope_restart_title: 'Dienste neu starten?',
        device_scope_restart_message: 'Die Sichtbarkeit wurde gespeichert. BetterDesk-Dienste jetzt neu starten, damit alle Komponenten sie laden, oder später ohne Neustart fortfahren.',
        device_scope_restart_later: 'Später'
    },
    fr: {
        device_scope_confirm_title: 'Enregistrer la visibilité des appareils par défaut ?',
        device_scope_confirm_open: 'Les utilisateurs non administrateurs sans droits sur dossiers, groupes ou appareils verront tous les appareils (mode ouvert / legacy). Continuer et enregistrer ?',
        device_scope_confirm_restricted: 'Mode restreint : les utilisateurs non administrateurs sans droits sur dossiers, groupes ou appareils verront une liste vide. Continuer et enregistrer ?',
        device_scope_restart_title: 'Redémarrer les services ?',
        device_scope_restart_message: 'La visibilité par défaut est enregistrée. Redémarrez maintenant les services BetterDesk pour que chaque composant la recharge, ou continuez plus tard sans redémarrage.',
        device_scope_restart_later: 'Plus tard'
    },
    es: {
        device_scope_confirm_title: '¿Guardar la visibilidad predeterminada de dispositivos?',
        device_scope_confirm_open: 'Los usuarios no administradores sin permisos de carpetas, grupos o dispositivos verán todos los dispositivos (modo abierto / legacy). ¿Continuar y guardar?',
        device_scope_confirm_restricted: 'Modo restringido: los usuarios no administradores sin permisos de carpetas, grupos o dispositivos verán una lista vacía. ¿Continuar y guardar?',
        device_scope_restart_title: '¿Reiniciar servicios?',
        device_scope_restart_message: 'La visibilidad predeterminada está guardada. Reinicie ahora los servicios de BetterDesk para que todos los componentes la recarguen, o continúe más tarde sin reiniciar.',
        device_scope_restart_later: 'Más tarde'
    },
    it: {
        device_scope_confirm_title: 'Salvare la visibilità predefinita dei dispositivi?',
        device_scope_confirm_open: 'Gli utenti non admin senza concessioni di cartelle, gruppi o dispositivi vedranno tutti i dispositivi (modalità aperta / legacy). Continuare e salvare?',
        device_scope_confirm_restricted: 'Modalità limitata: gli utenti non admin senza concessioni di cartelle, gruppi o dispositivi vedranno un elenco vuoto. Continuare e salvare?',
        device_scope_restart_title: 'Riavviare i servizi?',
        device_scope_restart_message: 'La visibilità predefinita è stata salvata. Riavvia ora i servizi BetterDesk affinché ogni componente la ricarichi, oppure continua più tardi senza riavvio.',
        device_scope_restart_later: 'Più tardi'
    },
    pt: {
        device_scope_confirm_title: 'Guardar a visibilidade predefinida dos dispositivos?',
        device_scope_confirm_open: 'Utilizadores sem função de admin e sem concessões de pastas, grupos ou dispositivos verão todos os dispositivos (modo aberto / legacy). Continuar e guardar?',
        device_scope_confirm_restricted: 'Modo restrito: utilizadores sem função de admin e sem concessões de pastas, grupos ou dispositivos verão uma lista vazia. Continuar e guardar?',
        device_scope_restart_title: 'Reiniciar serviços?',
        device_scope_restart_message: 'A visibilidade predefinida foi guardada. Reinicie agora os serviços BetterDesk para que todos os componentes a recarreguem, ou continue mais tarde sem reiniciar.',
        device_scope_restart_later: 'Mais tarde'
    },
    nl: {
        device_scope_confirm_title: 'Standaard apparaatzichtbaarheid opslaan?',
        device_scope_confirm_open: 'Niet-beheerders zonder map-, groeps- of apparaattoegang zien alle apparaten (open / legacy-modus). Doorgaan en opslaan?',
        device_scope_confirm_restricted: 'Beperkte modus: niet-beheerders zonder map-, groeps- of apparaattoegang zien een lege lijst. Doorgaan en opslaan?',
        device_scope_restart_title: 'Services herstarten?',
        device_scope_restart_message: 'De zichtbaarheid is opgeslagen. Herstart BetterDesk-services nu zodat elk onderdeel ze opnieuw laadt, of ga later verder zonder herstart.',
        device_scope_restart_later: 'Later'
    },
    cs: {
        device_scope_confirm_title: 'Uložit výchozí viditelnost zařízení?',
        device_scope_confirm_open: 'Neadmin uživatelé bez grantů složek, skupin nebo zařízení uvidí všechna zařízení (otevřený / legacy režim). Pokračovat a uložit?',
        device_scope_confirm_restricted: 'Omezený režim: neadmin uživatelé bez grantů složek, skupin nebo zařízení uvidí prázdný seznam. Pokračovat a uložit?',
        device_scope_restart_title: 'Restartovat služby?',
        device_scope_restart_message: 'Výchozí viditelnost je uložena. Restartujte nyní služby BetterDesk, aby ji všechny komponenty znovu načetly, nebo pokračujte později bez restartu.',
        device_scope_restart_later: 'Později'
    },
    da: {
        device_scope_confirm_title: 'Gem standard synlighed for enheder?',
        device_scope_confirm_open: 'Ikke-admin-brugere uden mappe-, gruppe- eller enhedsrettigheder vil se alle enheder (åben / legacy-tilstand). Fortsæt og gem?',
        device_scope_confirm_restricted: 'Begrænset tilstand: ikke-admin-brugere uden mappe-, gruppe- eller enhedsrettigheder vil se en tom liste. Fortsæt og gem?',
        device_scope_restart_title: 'Genstart tjenester?',
        device_scope_restart_message: 'Standardsynligheden er gemt. Genstart BetterDesk-tjenester nu, så alle komponenter indlæser den, eller fortsæt senere uden genstart.',
        device_scope_restart_later: 'Senere'
    },
    fi: {
        device_scope_confirm_title: 'Tallennetaanko laitteiden oletusnäkyvyys?',
        device_scope_confirm_open: 'Ei-ylläpitäjät ilman kansio-, ryhmä- tai laiteoikeuksia näkevät kaikki laitteet (avoin / legacy-tila). Jatka ja tallenna?',
        device_scope_confirm_restricted: 'Rajoitettu tila: ei-ylläpitäjät ilman kansio-, ryhmä- tai laiteoikeuksia näkevät tyhjän listan. Jatka ja tallenna?',
        device_scope_restart_title: 'Käynnistetäänkö palvelut uudelleen?',
        device_scope_restart_message: 'Oletusnäkyvyys on tallennettu. Käynnistä BetterDesk-palvelut uudelleen, jotta kaikki komponentit lataavat sen, tai jatka myöhemmin ilman uudelleenkäynnistystä.',
        device_scope_restart_later: 'Myöhemmin'
    },
    hu: {
        device_scope_confirm_title: 'Mentse az eszközök alapértelmezett láthatóságát?',
        device_scope_confirm_open: 'A nem admin felhasználók mappa-, csoport- vagy eszközjogosultság nélkül az összes eszközt látják (nyílt / legacy mód). Folytatja és menti?',
        device_scope_confirm_restricted: 'Korlátozott mód: a nem admin felhasználók mappa-, csoport- vagy eszközjogosultság nélkül üres listát látnak. Folytatja és menti?',
        device_scope_restart_title: 'Újraindítsa a szolgáltatásokat?',
        device_scope_restart_message: 'Az alapértelmezett láthatóság elmentve. Indítsa újra most a BetterDesk szolgáltatásokat, hogy minden komponens újratöltse, vagy folytassa később újraindítás nélkül.',
        device_scope_restart_later: 'Később'
    },
    nb: {
        device_scope_confirm_title: 'Lagre standard synlighet for enheter?',
        device_scope_confirm_open: 'Ikke-admin-brukere uten mappe-, gruppe- eller enhetsrettigheter vil se alle enheter (åpen / legacy-modus). Fortsette og lagre?',
        device_scope_confirm_restricted: 'Begrenset modus: ikke-admin-brukere uten mappe-, gruppe- eller enhetsrettigheter vil se en tom liste. Fortsette og lagre?',
        device_scope_restart_title: 'Starte tjenester på nytt?',
        device_scope_restart_message: 'Standardsynligheten er lagret. Start BetterDesk-tjenestene på nytt nå slik at alle komponenter laster den inn, eller fortsett senere uten omstart.',
        device_scope_restart_later: 'Senere'
    },
    ro: {
        device_scope_confirm_title: 'Salvați vizibilitatea implicită a dispozitivelor?',
        device_scope_confirm_open: 'Utilizatorii non-admin fără drepturi pe foldere, grupuri sau dispozitive vor vedea toate dispozitivele (mod deschis / legacy). Continuați și salvați?',
        device_scope_confirm_restricted: 'Mod restricționat: utilizatorii non-admin fără drepturi pe foldere, grupuri sau dispozitive vor vedea o listă goală. Continuați și salvați?',
        device_scope_restart_title: 'Reporniți serviciile?',
        device_scope_restart_message: 'Vizibilitatea implicită este salvată. Reporniți acum serviciile BetterDesk pentru ca toate componentele să o reîncarce, sau continuați mai târziu fără repornire.',
        device_scope_restart_later: 'Mai târziu'
    },
    sv: {
        device_scope_confirm_title: 'Spara standard synlighet för enheter?',
        device_scope_confirm_open: 'Icke-admin-användare utan mapp-, grupp- eller enhetsbehörigheter ser alla enheter (öppet / legacy-läge). Fortsätta och spara?',
        device_scope_confirm_restricted: 'Begränsat läge: icke-admin-användare utan mapp-, grupp- eller enhetsbehörigheter ser en tom lista. Fortsätta och spara?',
        device_scope_restart_title: 'Starta om tjänster?',
        device_scope_restart_message: 'Standardsynligheten är sparad. Starta om BetterDesk-tjänsterna nu så att alla komponenter laddar om den, eller fortsätt senare utan omstart.',
        device_scope_restart_later: 'Senare'
    },
    tr: {
        device_scope_confirm_title: 'Varsayılan cihaz görünürlüğü kaydedilsin mi?',
        device_scope_confirm_open: 'Klasör, grup veya cihaz yetkisi olmayan yönetici olmayan kullanıcılar tüm cihazları görür (açık / eski mod). Devam edip kaydedilsin mi?',
        device_scope_confirm_restricted: 'Kısıtlı mod: klasör, grup veya cihaz yetkisi olmayan yönetici olmayan kullanıcılar boş liste görür. Devam edip kaydedilsin mi?',
        device_scope_restart_title: 'Hizmetler yeniden başlatılsın mı?',
        device_scope_restart_message: 'Varsayılan görünürlük kaydedildi. Tüm bileşenlerin yeniden yüklemesi için BetterDesk hizmetlerini şimdi yeniden başlatın veya yeniden başlatmadan sonra devam edin.',
        device_scope_restart_later: 'Sonra'
    },
    uk: {
        device_scope_confirm_title: 'Зберегти типову видимість пристроїв?',
        device_scope_confirm_open: 'Користувачі без ролі admin і без прав на папки, групи чи пристрої бачитимуть усі пристрої (відкритий / legacy режим). Продовжити і зберегти?',
        device_scope_confirm_restricted: 'Обмежений режим: користувачі без ролі admin і без прав на папки, групи чи пристрої бачитимуть порожній список. Продовжити і зберегти?',
        device_scope_restart_title: 'Перезапустити служби?',
        device_scope_restart_message: 'Типову видимість збережено. Перезапустіть служби BetterDesk зараз, щоб усі компоненти її перезавантажили, або продовжте пізніше без перезапуску.',
        device_scope_restart_later: 'Пізніше'
    },
    vi: {
        device_scope_confirm_title: 'Lưu chế độ hiển thị thiết bị mặc định?',
        device_scope_confirm_open: 'Người dùng không phải admin nếu không có quyền thư mục, nhóm hoặc thiết bị sẽ thấy tất cả thiết bị (chế độ mở / legacy). Tiếp tục và lưu?',
        device_scope_confirm_restricted: 'Chế độ hạn chế: người dùng không phải admin nếu không có quyền thư mục, nhóm hoặc thiết bị sẽ thấy danh sách trống. Tiếp tục và lưu?',
        device_scope_restart_title: 'Khởi động lại dịch vụ?',
        device_scope_restart_message: 'Chế độ hiển thị mặc định đã được lưu. Khởi động lại dịch vụ BetterDesk ngay để mọi thành phần tải lại, hoặc tiếp tục sau mà không khởi động lại.',
        device_scope_restart_later: 'Để sau'
    },
    ar: {
        device_scope_confirm_title: 'حفظ إعداد ظهور الأجهزة الافتراضي؟',
        device_scope_confirm_open: 'سيشاهد المستخدمون غير المسؤولين بدون صلاحيات مجلدات أو مجموعات أو أجهزة كل الأجهزة (الوضع المفتوح / السابق). المتابعة والحفظ؟',
        device_scope_confirm_restricted: 'الوضع المقيد: سيرى المستخدمون غير المسؤولين بدون صلاحيات مجلدات أو مجموعات أو أجهزة قائمة فارغة. المتابعة والحفظ؟',
        device_scope_restart_title: 'إعادة تشغيل الخدمات؟',
        device_scope_restart_message: 'تم حفظ إعداد الظهور. أعد تشغيل خدمات BetterDesk الآن ليُحمّلها كل مكوّن، أو تابع لاحقًا دون إعادة التشغيل.',
        device_scope_restart_later: 'لاحقًا'
    },
    hi: {
        device_scope_confirm_title: 'डिफ़ॉल्ट डिवाइस दृश्यता सहेजें?',
        device_scope_confirm_open: 'फ़ोल्डर, समूह या डिवाइस अनुदान के बिना गैर-एडमिन उपयोगकर्ता सभी डिवाइस देखेंगे (खुला / लेगेसी मोड)। जारी रखें और सहेजें?',
        device_scope_confirm_restricted: 'प्रतिबंधित मोड: फ़ोल्डर, समूह या डिवाइस अनुदान के बिना गैर-एडमिन उपयोगकर्ता खाली सूची देखेंगे। जारी रखें और सहेजें?',
        device_scope_restart_title: 'सेवाएँ पुनः आरंभ करें?',
        device_scope_restart_message: 'डिफ़ॉल्ट दृश्यता सहेज ली गई है। सभी घटकों के पुनः लोड के लिए अभी BetterDesk सेवाएँ पुनः आरंभ करें, या बाद में बिना पुनः आरंभ जारी रखें।',
        device_scope_restart_later: 'बाद में'
    },
    id: {
        device_scope_confirm_title: 'Simpan visibilitas perangkat default?',
        device_scope_confirm_open: 'Pengguna non-admin tanpa hak folder, grup, atau perangkat akan melihat semua perangkat (mode terbuka / legacy). Lanjutkan dan simpan?',
        device_scope_confirm_restricted: 'Mode terbatas: pengguna non-admin tanpa hak folder, grup, atau perangkat akan melihat daftar kosong. Lanjutkan dan simpan?',
        device_scope_restart_title: 'Mulai ulang layanan?',
        device_scope_restart_message: 'Visibilitas default telah disimpan. Mulai ulang layanan BetterDesk sekarang agar semua komponen memuatnya ulang, atau lanjutkan nanti tanpa mulai ulang.',
        device_scope_restart_later: 'Nanti'
    },
    ja: {
        device_scope_confirm_title: 'デバイスのデフォルト表示を保存しますか？',
        device_scope_confirm_open: 'フォルダー・グループ・デバイスの権限がない非管理者ユーザーは、すべてのデバイスを表示します（オープン / レガシー）。続行して保存しますか？',
        device_scope_confirm_restricted: '制限モード: フォルダー・グループ・デバイスの権限がない非管理者ユーザーには空の一覧が表示されます。続行して保存しますか？',
        device_scope_restart_title: 'サービスを再起動しますか？',
        device_scope_restart_message: 'デフォルト表示は保存済みです。すべてのコンポーネントが再読み込みするよう BetterDesk サービスを今すぐ再起動するか、再起動せずに後で続行できます。',
        device_scope_restart_later: '後で'
    },
    ko: {
        device_scope_confirm_title: '기본 장치 가시성을 저장할까요?',
        device_scope_confirm_open: '폴더·그룹·장치 권한이 없는 비관리자 사용자는 모든 장치를 봅니다(개방 / 레거시 모드). 계속하고 저장할까요?',
        device_scope_confirm_restricted: '제한 모드: 폴더·그룹·장치 권한이 없는 비관리자 사용자는 빈 목록을 봅니다. 계속하고 저장할까요?',
        device_scope_restart_title: '서비스를 다시 시작할까요?',
        device_scope_restart_message: '기본 가시성이 저장되었습니다. 모든 구성 요소가 다시 로드되도록 BetterDesk 서비스를 지금 다시 시작하거나, 다시 시작 없이 나중에 계속하세요.',
        device_scope_restart_later: '나중에'
    },
    th: {
        device_scope_confirm_title: 'บันทึกการแสดงผลอุปกรณ์เริ่มต้นหรือไม่?',
        device_scope_confirm_open: 'ผู้ใช้ที่ไม่ใช่ผู้ดูแลระบบและไม่มีสิทธิ์โฟลเดอร์ กลุ่ม หรืออุปกรณ์ จะเห็นอุปกรณ์ทั้งหมด (โหมดเปิด / เดิม) ดำเนินการและบันทึกหรือไม่?',
        device_scope_confirm_restricted: 'โหมดจำกัด: ผู้ใช้ที่ไม่ใช่ผู้ดูแลระบบและไม่มีสิทธิ์โฟลเดอร์ กลุ่ม หรืออุปกรณ์ จะเห็นรายการว่าง ดำเนินการและบันทึกหรือไม่?',
        device_scope_restart_title: 'รีสตาร์ทบริการหรือไม่?',
        device_scope_restart_message: 'บันทึกการแสดงผลเริ่มต้นแล้ว รีสตาร์ทบริการ BetterDesk ทันทีเพื่อให้ทุกส่วนโหลดใหม่ หรือดำเนินการภายหลังโดยไม่รีสตาร์ท',
        device_scope_restart_later: 'ภายหลัง'
    },
    zh: {
        device_scope_confirm_title: '保存默认设备可见性？',
        device_scope_confirm_open: '没有文件夹、组或设备授权的非管理员用户将看到所有设备（开放 / 旧版模式）。是否继续并保存？',
        device_scope_confirm_restricted: '受限模式：没有文件夹、组或设备授权的非管理员用户将看到空列表。是否继续并保存？',
        device_scope_restart_title: '重启服务？',
        device_scope_restart_message: '默认可见性已保存。立即重启 BetterDesk 服务以使所有组件重新加载，或稍后不重启继续。',
        device_scope_restart_later: '稍后'
    },
    'zh-TW': {
        device_scope_confirm_title: '儲存預設裝置可見性？',
        device_scope_confirm_open: '沒有資料夾、群組或裝置授權的非管理員使用者會看到所有裝置（開放 / 舊版模式）。是否繼續並儲存？',
        device_scope_confirm_restricted: '受限模式：沒有資料夾、群組或裝置授權的非管理員使用者會看到空白清單。是否繼續並儲存？',
        device_scope_restart_title: '重新啟動服務？',
        device_scope_restart_message: '預設可見性已儲存。立即重新啟動 BetterDesk 服務，讓所有元件重新載入，或稍後不重新啟動繼續。',
        device_scope_restart_later: '稍後'
    }
};

const keys = Object.keys(translations.en);

for (const file of fs.readdirSync(langDir).filter((f) => f.endsWith('.json'))) {
    const locale = file.slice(0, -5);
    const filePath = path.join(langDir, file);
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, ''));
    if (!data.settings) data.settings = {};
    const pack = translations[locale] || translations.en;
    for (const key of keys) {
        data.settings[key] = pack[key] || translations.en[key];
    }
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + '\n', 'utf8');
    console.log('patched', locale);
}
