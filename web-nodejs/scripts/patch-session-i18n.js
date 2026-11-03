'use strict';

/**
 * One-shot i18n patch for secure panel session keys.
 * Safe to re-run: merges keys into auth / audit / security_audit.
 */

const fs = require('fs');
const path = require('path');

const dir = path.join(__dirname, '..', 'lang');
const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json') && f !== 'en.json');

const packs = {
    ar: {
        auth: {
            session_expired: 'انتهت جلستك أو تم استبدالها بتسجيل دخول جديد. يرجى تسجيل الدخول مرة أخرى.',
            session_idle_warning_title: 'الجلسة على وشك الانتهاء',
            session_idle_warning_body: 'سيتم تسجيل خروجك بسبب عدم النشاط خلال {{seconds}} ثانية.',
            session_stay_signed_in: 'البقاء مسجلاً'
        },
        audit: {
            action_session_replaced: 'تم استبدال الجلسة',
            action_session_expired: 'انتهت الجلسة',
            action_session_ip_change: 'تغيّر عنوان IP للجلسة'
        },
        security_audit: {
            tab_sessions: 'جلسات اللوحة',
            sessions_hint: 'جلسات تسجيل الدخول إلى لوحة التحكم. يُسمح بجلسة نشطة واحدة لكل حساب؛ تسجيل دخول جديد ينهي الجلسة السابقة.',
            sessions_policy: 'مهلة الخمول: {{idle}} د · الحد الأقصى: {{max}} س · جلسة نشطة واحدة لكل حساب',
            no_sessions: 'لا توجد جلسات مسجلة بعد.',
            session_current: 'الحالية',
            session_active: 'نشطة',
            session_ended: 'منتهية',
            col_status: 'الحالة',
            col_started: 'البداية',
            col_last_activity: 'آخر نشاط',
            col_ended: 'الانتهاء',
            col_reason: 'سبب الانتهاء',
            col_user_agent: 'المتصفح',
            reason_logout: 'تسجيل الخروج',
            reason_replaced: 'استُبدلت بتسجيل دخول جديد',
            reason_idle: 'مهلة الخمول',
            reason_max_age: 'العمر الأقصى',
            reason_revoked: 'مُلغاة',
            reason_destroyed: 'مُدمَّرة'
        }
    },
    cs: {
        auth: {
            session_expired: 'Vaše relace vypršela nebo byla nahrazena novým přihlášením. Přihlaste se znovu.',
            session_idle_warning_title: 'Relace brzy vyprší',
            session_idle_warning_body: 'Budete odhlášeni kvůli nečinnosti za {{seconds}} s.',
            session_stay_signed_in: 'Zůstat přihlášen'
        },
        audit: {
            action_session_replaced: 'Relace nahrazena',
            action_session_expired: 'Relace vypršela',
            action_session_ip_change: 'Změna IP relace'
        },
        security_audit: {
            tab_sessions: 'Relace panelu',
            sessions_hint: 'Přihlášení do konzole. Na účet je povolena jen jedna aktivní relace; nové přihlášení ukončí předchozí.',
            sessions_policy: 'Nečinnost: {{idle}} min · Absolutní max: {{max}} h · Jedna aktivní relace na účet',
            no_sessions: 'Zatím nejsou zaznamenány žádné relace panelu.',
            session_current: 'Aktuální',
            session_active: 'Aktivní',
            session_ended: 'Ukončená',
            col_status: 'Stav',
            col_started: 'Začátek',
            col_last_activity: 'Poslední aktivita',
            col_ended: 'Konec',
            col_reason: 'Důvod ukončení',
            col_user_agent: 'Prohlížeč',
            reason_logout: 'Odhlášení',
            reason_replaced: 'Nahrazena novým přihlášením',
            reason_idle: 'Timeout nečinnosti',
            reason_max_age: 'Maximální životnost',
            reason_revoked: 'Zrušena',
            reason_destroyed: 'Zničena'
        }
    },
    da: {
        auth: {
            session_expired: 'Din session er udløbet eller erstattet af et nyt login. Log ind igen.',
            session_idle_warning_title: 'Session udløber snart',
            session_idle_warning_body: 'Du logges ud på grund af inaktivitet om {{seconds}} sekunder.',
            session_stay_signed_in: 'Forbliv logget ind'
        },
        audit: {
            action_session_replaced: 'Session erstattet',
            action_session_expired: 'Session udløbet',
            action_session_ip_change: 'Session-IP ændret'
        },
        security_audit: {
            tab_sessions: 'Panelsessioner',
            sessions_hint: 'Dine konsol-logins. Kun én aktiv session pr. konto; et nyt login afslutter den forrige.',
            sessions_policy: 'Idle-timeout: {{idle}} min · Absolut max: {{max}} t · Én aktiv session pr. konto',
            no_sessions: 'Ingen panelsessioner registreret endnu.',
            session_current: 'Nuværende',
            session_active: 'Aktiv',
            session_ended: 'Afsluttet',
            col_status: 'Status',
            col_started: 'Startet',
            col_last_activity: 'Seneste aktivitet',
            col_ended: 'Sluttet',
            col_reason: 'Årsag',
            col_user_agent: 'Browser',
            reason_logout: 'Log ud',
            reason_replaced: 'Erstattet af nyt login',
            reason_idle: 'Idle-timeout',
            reason_max_age: 'Maksimal levetid',
            reason_revoked: 'Tilbagekaldt',
            reason_destroyed: 'Destrueret'
        }
    },
    de: {
        auth: {
            session_expired: 'Ihre Sitzung ist abgelaufen oder wurde durch eine neue Anmeldung ersetzt. Bitte melden Sie sich erneut an.',
            session_idle_warning_title: 'Sitzung läuft bald ab',
            session_idle_warning_body: 'Sie werden wegen Inaktivität in {{seconds}} Sekunden abgemeldet.',
            session_stay_signed_in: 'Angemeldet bleiben'
        },
        audit: {
            action_session_replaced: 'Sitzung ersetzt',
            action_session_expired: 'Sitzung abgelaufen',
            action_session_ip_change: 'Sitzungs-IP geändert'
        },
        security_audit: {
            tab_sessions: 'Panel-Sitzungen',
            sessions_hint: 'Ihre Konsolen-Anmeldungen. Pro Konto ist nur eine aktive Sitzung erlaubt; eine neue Anmeldung beendet die vorherige.',
            sessions_policy: 'Idle-Timeout: {{idle}} Min · Absolutes Maximum: {{max}} Std · Eine aktive Sitzung pro Konto',
            no_sessions: 'Noch keine Panel-Sitzungen erfasst.',
            session_current: 'Aktuell',
            session_active: 'Aktiv',
            session_ended: 'Beendet',
            col_status: 'Status',
            col_started: 'Gestartet',
            col_last_activity: 'Letzte Aktivität',
            col_ended: 'Beendet',
            col_reason: 'Endgrund',
            col_user_agent: 'Browser',
            reason_logout: 'Abmeldung',
            reason_replaced: 'Durch neue Anmeldung ersetzt',
            reason_idle: 'Idle-Timeout',
            reason_max_age: 'Maximale Lebensdauer',
            reason_revoked: 'Widerrufen',
            reason_destroyed: 'Zerstört'
        }
    },
    es: {
        auth: {
            session_expired: 'Su sesión expiró o fue reemplazada por un nuevo inicio de sesión. Inicie sesión de nuevo.',
            session_idle_warning_title: 'La sesión expirará pronto',
            session_idle_warning_body: 'Se cerrará la sesión por inactividad en {{seconds}} segundos.',
            session_stay_signed_in: 'Seguir conectado'
        },
        audit: {
            action_session_replaced: 'Sesión reemplazada',
            action_session_expired: 'Sesión expirada',
            action_session_ip_change: 'Cambio de IP de sesión'
        },
        security_audit: {
            tab_sessions: 'Sesiones del panel',
            sessions_hint: 'Sus inicios de sesión en la consola. Solo se permite una sesión activa por cuenta; un nuevo inicio termina la anterior.',
            sessions_policy: 'Tiempo de inactividad: {{idle}} min · Máximo absoluto: {{max}} h · Una sesión activa por cuenta',
            no_sessions: 'Aún no hay sesiones del panel registradas.',
            session_current: 'Actual',
            session_active: 'Activa',
            session_ended: 'Finalizada',
            col_status: 'Estado',
            col_started: 'Inicio',
            col_last_activity: 'Última actividad',
            col_ended: 'Fin',
            col_reason: 'Motivo de fin',
            col_user_agent: 'Navegador',
            reason_logout: 'Cierre de sesión',
            reason_replaced: 'Reemplazada por nuevo inicio',
            reason_idle: 'Tiempo de inactividad',
            reason_max_age: 'Vida máxima',
            reason_revoked: 'Revocada',
            reason_destroyed: 'Destruida'
        }
    },
    fi: {
        auth: {
            session_expired: 'Istuntosi vanheni tai korvattiin uudella kirjautumisella. Kirjaudu uudelleen.',
            session_idle_warning_title: 'Istunto vanhenee pian',
            session_idle_warning_body: 'Sinut kirjataan ulos käyttämättömyyden vuoksi {{seconds}} sekunnin kuluttua.',
            session_stay_signed_in: 'Pysy kirjautuneena'
        },
        audit: {
            action_session_replaced: 'Istunto korvattu',
            action_session_expired: 'Istunto vanhentunut',
            action_session_ip_change: 'Istunnon IP vaihtui'
        },
        security_audit: {
            tab_sessions: 'Paneeli-istunnot',
            sessions_hint: 'Konsolin kirjautumiset. Tilillä voi olla vain yksi aktiivinen istunto; uusi kirjautuminen lopettaa edellisen.',
            sessions_policy: 'Joutenolo: {{idle}} min · Absoluuttinen max: {{max}} h · Yksi aktiivinen istunto per tili',
            no_sessions: 'Paneeli-istuntoja ei ole vielä tallennettu.',
            session_current: 'Nykyinen',
            session_active: 'Aktiivinen',
            session_ended: 'Päättynyt',
            col_status: 'Tila',
            col_started: 'Aloitettu',
            col_last_activity: 'Viimeisin toiminta',
            col_ended: 'Päättynyt',
            col_reason: 'Lopetussyy',
            col_user_agent: 'Selain',
            reason_logout: 'Uloskirjautuminen',
            reason_replaced: 'Korvattu uudella kirjautumisella',
            reason_idle: 'Joutenoloajan ylitys',
            reason_max_age: 'Enimmäiskesto',
            reason_revoked: 'Peruttu',
            reason_destroyed: 'Tuottu'
        }
    },
    fr: {
        auth: {
            session_expired: 'Votre session a expiré ou a été remplacée par une nouvelle connexion. Veuillez vous reconnecter.',
            session_idle_warning_title: 'Session bientôt expirée',
            session_idle_warning_body: 'Vous serez déconnecté pour inactivité dans {{seconds}} secondes.',
            session_stay_signed_in: 'Rester connecté'
        },
        audit: {
            action_session_replaced: 'Session remplacée',
            action_session_expired: 'Session expirée',
            action_session_ip_change: "Changement d'IP de session"
        },
        security_audit: {
            tab_sessions: 'Sessions du panneau',
            sessions_hint: 'Vos connexions à la console. Une seule session active est autorisée par compte ; une nouvelle connexion termine la précédente.',
            sessions_policy: "Délai d'inactivité : {{idle}} min · Maximum absolu : {{max}} h · Une session active par compte",
            no_sessions: 'Aucune session de panneau enregistrée pour le moment.',
            session_current: 'Actuelle',
            session_active: 'Active',
            session_ended: 'Terminée',
            col_status: 'État',
            col_started: 'Début',
            col_last_activity: 'Dernière activité',
            col_ended: 'Fin',
            col_reason: 'Motif de fin',
            col_user_agent: 'Navigateur',
            reason_logout: 'Déconnexion',
            reason_replaced: 'Remplacée par une nouvelle connexion',
            reason_idle: "Délai d'inactivité",
            reason_max_age: 'Durée maximale',
            reason_revoked: 'Révoquée',
            reason_destroyed: 'Détruite'
        }
    },
    hi: {
        auth: {
            session_expired: 'आपका सत्र समाप्त हो गया या नई लॉगिन से बदल दिया गया। कृपया फिर से साइन इन करें।',
            session_idle_warning_title: 'सत्र जल्द समाप्त होगा',
            session_idle_warning_body: 'निष्क्रियता के कारण {{seconds}} सेकंड में आपको साइन आउट किया जाएगा।',
            session_stay_signed_in: 'साइन इन रहें'
        },
        audit: {
            action_session_replaced: 'सत्र बदला गया',
            action_session_expired: 'सत्र समाप्त',
            action_session_ip_change: 'सत्र IP बदला'
        },
        security_audit: {
            tab_sessions: 'पैनल सत्र',
            sessions_hint: 'आपके कंसोल लॉगिन। प्रति खाता केवल एक सक्रिय सत्र; नया लॉगिन पिछले को समाप्त करता है।',
            sessions_policy: 'निष्क्रिय समय सीमा: {{idle}} मि · अधिकतम: {{max}} घं · प्रति खाता एक सक्रिय सत्र',
            no_sessions: 'अभी तक कोई पैनल सत्र दर्ज नहीं।',
            session_current: 'वर्तमान',
            session_active: 'सक्रिय',
            session_ended: 'समाप्त',
            col_status: 'स्थिति',
            col_started: 'शुरू',
            col_last_activity: 'अंतिम गतिविधि',
            col_ended: 'समाप्ति',
            col_reason: 'समाप्ति कारण',
            col_user_agent: 'ब्राउज़र',
            reason_logout: 'लॉगआउट',
            reason_replaced: 'नए लॉगिन से बदला',
            reason_idle: 'निष्क्रिय समय सीमा',
            reason_max_age: 'अधिकतम अवधि',
            reason_revoked: 'रद्द',
            reason_destroyed: 'नष्ट'
        }
    },
    hu: {
        auth: {
            session_expired: 'A munkamenet lejárt, vagy új bejelentkezés váltotta fel. Jelentkezzen be újra.',
            session_idle_warning_title: 'A munkamenet hamarosan lejár',
            session_idle_warning_body: 'Inaktivitás miatt {{seconds}} másodperc múlva kijelentkeztetjük.',
            session_stay_signed_in: 'Maradjon bejelentkezve'
        },
        audit: {
            action_session_replaced: 'Munkamenet lecserélve',
            action_session_expired: 'Munkamenet lejárt',
            action_session_ip_change: 'Munkamenet IP-változás'
        },
        security_audit: {
            tab_sessions: 'Panel munkamenetek',
            sessions_hint: 'Konzol-bejelentkezései. Fiókonként csak egy aktív munkamenet engedélyezett; az új bejelentkezés lezárja az előzőt.',
            sessions_policy: 'Tétlenségi időkorlát: {{idle}} perc · Abszolút max: {{max}} óra · Fiókonként egy aktív munkamenet',
            no_sessions: 'Még nincsenek rögzített panel munkamenetek.',
            session_current: 'Jelenlegi',
            session_active: 'Aktív',
            session_ended: 'Lezárt',
            col_status: 'Állapot',
            col_started: 'Kezdés',
            col_last_activity: 'Utolsó aktivitás',
            col_ended: 'Vége',
            col_reason: 'Lezárás oka',
            col_user_agent: 'Böngésző',
            reason_logout: 'Kijelentkezés',
            reason_replaced: 'Új bejelentkezés váltotta fel',
            reason_idle: 'Tétlenségi időtúllépés',
            reason_max_age: 'Maximális élettartam',
            reason_revoked: 'Visszavonva',
            reason_destroyed: 'Megsemmisítve'
        }
    },
    id: {
        auth: {
            session_expired: 'Sesi Anda kedaluwarsa atau digantikan oleh login baru. Silakan masuk lagi.',
            session_idle_warning_title: 'Sesi akan segera berakhir',
            session_idle_warning_body: 'Anda akan keluar karena tidak aktif dalam {{seconds}} detik.',
            session_stay_signed_in: 'Tetap masuk'
        },
        audit: {
            action_session_replaced: 'Sesi diganti',
            action_session_expired: 'Sesi kedaluwarsa',
            action_session_ip_change: 'IP sesi berubah'
        },
        security_audit: {
            tab_sessions: 'Sesi panel',
            sessions_hint: 'Login konsol Anda. Hanya satu sesi aktif per akun; login baru mengakhiri yang sebelumnya.',
            sessions_policy: 'Batas idle: {{idle}} mnt · Maks absolut: {{max}} j · Satu sesi aktif per akun',
            no_sessions: 'Belum ada sesi panel yang tercatat.',
            session_current: 'Saat ini',
            session_active: 'Aktif',
            session_ended: 'Berakhir',
            col_status: 'Status',
            col_started: 'Mulai',
            col_last_activity: 'Aktivitas terakhir',
            col_ended: 'Berakhir',
            col_reason: 'Alasan berakhir',
            col_user_agent: 'Browser',
            reason_logout: 'Keluar',
            reason_replaced: 'Diganti login baru',
            reason_idle: 'Batas idle',
            reason_max_age: 'Masa berlaku maksimum',
            reason_revoked: 'Dicabut',
            reason_destroyed: 'Dihancurkan'
        }
    },
    it: {
        auth: {
            session_expired: 'La sessione è scaduta o è stata sostituita da un nuovo accesso. Accedi di nuovo.',
            session_idle_warning_title: 'Sessione in scadenza',
            session_idle_warning_body: 'Verrai disconnesso per inattività tra {{seconds}} secondi.',
            session_stay_signed_in: 'Resta connesso'
        },
        audit: {
            action_session_replaced: 'Sessione sostituita',
            action_session_expired: 'Sessione scaduta',
            action_session_ip_change: 'Cambio IP sessione'
        },
        security_audit: {
            tab_sessions: 'Sessioni del pannello',
            sessions_hint: 'Accessi alla console. È consentita una sola sessione attiva per account; un nuovo accesso termina la precedente.',
            sessions_policy: 'Timeout inattività: {{idle}} min · Massimo assoluto: {{max}} h · Una sessione attiva per account',
            no_sessions: 'Nessuna sessione del pannello registrata.',
            session_current: 'Corrente',
            session_active: 'Attiva',
            session_ended: 'Terminata',
            col_status: 'Stato',
            col_started: 'Inizio',
            col_last_activity: 'Ultima attività',
            col_ended: 'Fine',
            col_reason: 'Motivo di fine',
            col_user_agent: 'Browser',
            reason_logout: 'Logout',
            reason_replaced: 'Sostituita da nuovo accesso',
            reason_idle: 'Timeout inattività',
            reason_max_age: 'Durata massima',
            reason_revoked: 'Revocata',
            reason_destroyed: 'Distrutta'
        }
    },
    ja: {
        auth: {
            session_expired: 'セッションの有効期限が切れたか、新しいログインに置き換えられました。再度サインインしてください。',
            session_idle_warning_title: 'セッションまもなく期限切れ',
            session_idle_warning_body: '操作がないため {{seconds}} 秒後にサインアウトされます。',
            session_stay_signed_in: 'サインインを維持'
        },
        audit: {
            action_session_replaced: 'セッション置換',
            action_session_expired: 'セッション期限切れ',
            action_session_ip_change: 'セッションIP変更'
        },
        security_audit: {
            tab_sessions: 'パネルセッション',
            sessions_hint: 'コンソールのログインセッションです。アカウントごとにアクティブなセッションは1つのみで、新しいログインは以前のセッションを終了します。',
            sessions_policy: 'アイドル: {{idle}} 分 · 絶対上限: {{max}} 時間 · アカウントごとに1セッション',
            no_sessions: 'パネルセッションはまだ記録されていません。',
            session_current: '現在',
            session_active: 'アクティブ',
            session_ended: '終了',
            col_status: '状態',
            col_started: '開始',
            col_last_activity: '最終アクティビティ',
            col_ended: '終了',
            col_reason: '終了理由',
            col_user_agent: 'ブラウザ',
            reason_logout: 'ログアウト',
            reason_replaced: '新しいログインで置換',
            reason_idle: 'アイドルタイムアウト',
            reason_max_age: '最大有効期間',
            reason_revoked: '取り消し',
            reason_destroyed: '破棄'
        }
    },
    ko: {
        auth: {
            session_expired: '세션이 만료되었거나 새 로그인으로 대체되었습니다. 다시 로그인해 주세요.',
            session_idle_warning_title: '세션이 곧 만료됩니다',
            session_idle_warning_body: '비활성으로 인해 {{seconds}}초 후 로그아웃됩니다.',
            session_stay_signed_in: '로그인 유지'
        },
        audit: {
            action_session_replaced: '세션 교체됨',
            action_session_expired: '세션 만료',
            action_session_ip_change: '세션 IP 변경'
        },
        security_audit: {
            tab_sessions: '패널 세션',
            sessions_hint: '콘솔 로그인 세션입니다. 계정당 활성 세션은 하나뿐이며, 새 로그인은 이전 세션을 종료합니다.',
            sessions_policy: '유휴 제한: {{idle}}분 · 절대 최대: {{max}}시간 · 계정당 활성 세션 1개',
            no_sessions: '기록된 패널 세션이 없습니다.',
            session_current: '현재',
            session_active: '활성',
            session_ended: '종료됨',
            col_status: '상태',
            col_started: '시작',
            col_last_activity: '마지막 활동',
            col_ended: '종료',
            col_reason: '종료 사유',
            col_user_agent: '브라우저',
            reason_logout: '로그아웃',
            reason_replaced: '새 로그인으로 교체됨',
            reason_idle: '유휴 시간 초과',
            reason_max_age: '최대 수명',
            reason_revoked: '취소됨',
            reason_destroyed: '삭제됨'
        }
    },
    nb: {
        auth: {
            session_expired: 'Økten er utløpt eller erstattet av en ny innlogging. Logg inn på nytt.',
            session_idle_warning_title: 'Økten utløper snart',
            session_idle_warning_body: 'Du logges ut på grunn av inaktivitet om {{seconds}} sekunder.',
            session_stay_signed_in: 'Forbli innlogget'
        },
        audit: {
            action_session_replaced: 'Økt erstattet',
            action_session_expired: 'Økt utløpt',
            action_session_ip_change: 'Økt-IP endret'
        },
        security_audit: {
            tab_sessions: 'Paneløkter',
            sessions_hint: 'Konsollinnloggingene dine. Kun én aktiv økt per konto; ny innlogging avslutter den forrige.',
            sessions_policy: 'Inaktivitet: {{idle}} min · Absolutt maks: {{max}} t · Én aktiv økt per konto',
            no_sessions: 'Ingen paneløkter registrert ennå.',
            session_current: 'Nåværende',
            session_active: 'Aktiv',
            session_ended: 'Avsluttet',
            col_status: 'Status',
            col_started: 'Startet',
            col_last_activity: 'Siste aktivitet',
            col_ended: 'Avsluttet',
            col_reason: 'Avslutningsårsak',
            col_user_agent: 'Nettleser',
            reason_logout: 'Logg ut',
            reason_replaced: 'Erstattet av ny innlogging',
            reason_idle: 'Inaktivitetstidsavbrudd',
            reason_max_age: 'Maksimal levetid',
            reason_revoked: 'Tilbakekalt',
            reason_destroyed: 'Ødelagt'
        }
    },
    nl: {
        auth: {
            session_expired: 'Uw sessie is verlopen of vervangen door een nieuwe login. Meld u opnieuw aan.',
            session_idle_warning_title: 'Sessie verloopt binnenkort',
            session_idle_warning_body: 'U wordt over {{seconds}} seconden uitgelogd wegens inactiviteit.',
            session_stay_signed_in: 'Ingelogd blijven'
        },
        audit: {
            action_session_replaced: 'Sessie vervangen',
            action_session_expired: 'Sessie verlopen',
            action_session_ip_change: 'Sessie-IP gewijzigd'
        },
        security_audit: {
            tab_sessions: 'Panelsessies',
            sessions_hint: 'Uw console-logins. Per account is slechts één actieve sessie toegestaan; een nieuwe login beëindigt de vorige.',
            sessions_policy: 'Idle-timeout: {{idle}} min · Absoluut max: {{max}} u · Eén actieve sessie per account',
            no_sessions: 'Nog geen panelsessies geregistreerd.',
            session_current: 'Huidig',
            session_active: 'Actief',
            session_ended: 'Beëindigd',
            col_status: 'Status',
            col_started: 'Gestart',
            col_last_activity: 'Laatste activiteit',
            col_ended: 'Beëindigd',
            col_reason: 'Eindreden',
            col_user_agent: 'Browser',
            reason_logout: 'Uitloggen',
            reason_replaced: 'Vervangen door nieuwe login',
            reason_idle: 'Idle-timeout',
            reason_max_age: 'Maximale levensduur',
            reason_revoked: 'Ingetrokken',
            reason_destroyed: 'Vernietigd'
        }
    },
    pl: {
        auth: {
            session_expired: 'Twoja sesja wygasła lub została zastąpiona nowym logowaniem. Zaloguj się ponownie.',
            session_idle_warning_title: 'Sesja wkrótce wygaśnie',
            session_idle_warning_body: 'Zostaniesz wylogowany z powodu bezczynności za {{seconds}} s.',
            session_stay_signed_in: 'Pozostań zalogowany'
        },
        audit: {
            action_session_replaced: 'Sesja zastąpiona',
            action_session_expired: 'Sesja wygasła',
            action_session_ip_change: 'Zmiana IP sesji'
        },
        security_audit: {
            tab_sessions: 'Sesje panelu',
            sessions_hint: 'Twoje logowania do konsoli. Na konto przypada tylko jedna aktywna sesja; nowe logowanie kończy poprzednią.',
            sessions_policy: 'Limit bezczynności: {{idle}} min · Absolutne max: {{max}} h · Jedna aktywna sesja na konto',
            no_sessions: 'Brak zarejestrowanych sesji panelu.',
            session_current: 'Bieżąca',
            session_active: 'Aktywna',
            session_ended: 'Zakończona',
            col_status: 'Status',
            col_started: 'Start',
            col_last_activity: 'Ostatnia aktywność',
            col_ended: 'Koniec',
            col_reason: 'Powód zakończenia',
            col_user_agent: 'Przeglądarka',
            reason_logout: 'Wylogowanie',
            reason_replaced: 'Zastąpiona nowym logowaniem',
            reason_idle: 'Limit bezczynności',
            reason_max_age: 'Maksymalny czas życia',
            reason_revoked: 'Unieważniona',
            reason_destroyed: 'Usunięta'
        }
    },
    pt: {
        auth: {
            session_expired: 'Sua sessão expirou ou foi substituída por um novo login. Entre novamente.',
            session_idle_warning_title: 'Sessão expirando em breve',
            session_idle_warning_body: 'Você será desconectado por inatividade em {{seconds}} segundos.',
            session_stay_signed_in: 'Permanecer conectado'
        },
        audit: {
            action_session_replaced: 'Sessão substituída',
            action_session_expired: 'Sessão expirada',
            action_session_ip_change: 'Alteração de IP da sessão'
        },
        security_audit: {
            tab_sessions: 'Sessões do painel',
            sessions_hint: 'Seus logins do console. Apenas uma sessão ativa por conta; um novo login encerra a anterior.',
            sessions_policy: 'Tempo ocioso: {{idle}} min · Máx. absoluto: {{max}} h · Uma sessão ativa por conta',
            no_sessions: 'Nenhuma sessão do painel registrada ainda.',
            session_current: 'Atual',
            session_active: 'Ativa',
            session_ended: 'Encerrada',
            col_status: 'Status',
            col_started: 'Início',
            col_last_activity: 'Última atividade',
            col_ended: 'Fim',
            col_reason: 'Motivo do fim',
            col_user_agent: 'Navegador',
            reason_logout: 'Logout',
            reason_replaced: 'Substituída por novo login',
            reason_idle: 'Tempo ocioso',
            reason_max_age: 'Vida máxima',
            reason_revoked: 'Revogada',
            reason_destroyed: 'Destruída'
        }
    },
    ro: {
        auth: {
            session_expired: 'Sesiunea a expirat sau a fost înlocuită de o autentificare nouă. Autentificați-vă din nou.',
            session_idle_warning_title: 'Sesiunea expiră în curând',
            session_idle_warning_body: 'Veți fi deconectat din cauza inactivității în {{seconds}} secunde.',
            session_stay_signed_in: 'Rămâneți autentificat'
        },
        audit: {
            action_session_replaced: 'Sesiune înlocuită',
            action_session_expired: 'Sesiune expirată',
            action_session_ip_change: 'Schimbare IP sesiune'
        },
        security_audit: {
            tab_sessions: 'Sesiuni panou',
            sessions_hint: 'Autentificările în consolă. Este permisă o singură sesiune activă per cont; o autentificare nouă o încheie pe cea anterioară.',
            sessions_policy: 'Timeout inactivitate: {{idle}} min · Maxim absolut: {{max}} h · O sesiune activă per cont',
            no_sessions: 'Nu există încă sesiuni de panou înregistrate.',
            session_current: 'Curentă',
            session_active: 'Activă',
            session_ended: 'Încheiată',
            col_status: 'Stare',
            col_started: 'Început',
            col_last_activity: 'Ultima activitate',
            col_ended: 'Sfârșit',
            col_reason: 'Motiv încheiere',
            col_user_agent: 'Browser',
            reason_logout: 'Deconectare',
            reason_replaced: 'Înlocuită de autentificare nouă',
            reason_idle: 'Timeout inactivitate',
            reason_max_age: 'Durată maximă',
            reason_revoked: 'Revocată',
            reason_destroyed: 'Distrusă'
        }
    },
    sv: {
        auth: {
            session_expired: 'Din session har gått ut eller ersatts av en ny inloggning. Logga in igen.',
            session_idle_warning_title: 'Sessionen går snart ut',
            session_idle_warning_body: 'Du loggas ut på grund av inaktivitet om {{seconds}} sekunder.',
            session_stay_signed_in: 'Förbli inloggad'
        },
        audit: {
            action_session_replaced: 'Session ersatt',
            action_session_expired: 'Session utgången',
            action_session_ip_change: 'Sessions-IP ändrad'
        },
        security_audit: {
            tab_sessions: 'Panelsessioner',
            sessions_hint: 'Dina konsolinloggningar. Endast en aktiv session per konto; en ny inloggning avslutar den föregående.',
            sessions_policy: 'Inaktivitet: {{idle}} min · Absolut max: {{max}} t · En aktiv session per konto',
            no_sessions: 'Inga panelsessioner registrerade ännu.',
            session_current: 'Nuvarande',
            session_active: 'Aktiv',
            session_ended: 'Avslutad',
            col_status: 'Status',
            col_started: 'Startad',
            col_last_activity: 'Senaste aktivitet',
            col_ended: 'Avslutad',
            col_reason: 'Avslutningsorsak',
            col_user_agent: 'Webbläsare',
            reason_logout: 'Logga ut',
            reason_replaced: 'Ersatt av ny inloggning',
            reason_idle: 'Inaktivitetstimeout',
            reason_max_age: 'Maximal livstid',
            reason_revoked: 'Återkallad',
            reason_destroyed: 'Förstörd'
        }
    },
    th: {
        auth: {
            session_expired: 'เซสชันของคุณหมดอายุหรือถูกแทนที่ด้วยการเข้าสู่ระบบใหม่ กรุณาเข้าสู่ระบบอีกครั้ง',
            session_idle_warning_title: 'เซสชันใกล้หมดอายุ',
            session_idle_warning_body: 'คุณจะถูกออกจากระบบเนื่องจากไม่มีการใช้งานใน {{seconds}} วินาที',
            session_stay_signed_in: 'คงสถานะเข้าสู่ระบบ'
        },
        audit: {
            action_session_replaced: 'เซสชันถูกแทนที่',
            action_session_expired: 'เซสชันหมดอายุ',
            action_session_ip_change: 'IP เซสชันเปลี่ยน'
        },
        security_audit: {
            tab_sessions: 'เซสชันแผงควบคุม',
            sessions_hint: 'การเข้าสู่ระบบคอนโซลของคุณ อนุญาตเพียงหนึ่งเซสชันที่ใช้งานต่อบัญชี การเข้าสู่ระบบใหม่จะสิ้นสุดเซสชันก่อนหน้า',
            sessions_policy: 'หมดเวลา idle: {{idle}} นาที · สูงสุดสัมบูรณ์: {{max}} ชม. · หนึ่งเซสชันที่ใช้งานต่อบัญชี',
            no_sessions: 'ยังไม่มีเซสชันแผงควบคุมที่บันทึก',
            session_current: 'ปัจจุบัน',
            session_active: 'ใช้งาน',
            session_ended: 'สิ้นสุดแล้ว',
            col_status: 'สถานะ',
            col_started: 'เริ่ม',
            col_last_activity: 'กิจกรรมล่าสุด',
            col_ended: 'สิ้นสุด',
            col_reason: 'เหตุผลสิ้นสุด',
            col_user_agent: 'เบราว์เซอร์',
            reason_logout: 'ออกจากระบบ',
            reason_replaced: 'ถูกแทนที่ด้วยการเข้าสู่ระบบใหม่',
            reason_idle: 'หมดเวลา idle',
            reason_max_age: 'อายุสูงสุด',
            reason_revoked: 'เพิกถอน',
            reason_destroyed: 'ทำลาย'
        }
    },
    tr: {
        auth: {
            session_expired: 'Oturumunuz sona erdi veya yeni bir girişle değiştirildi. Lütfen tekrar oturum açın.',
            session_idle_warning_title: 'Oturum yakında sona erecek',
            session_idle_warning_body: 'Hareketsizlik nedeniyle {{seconds}} saniye içinde oturumunuz kapatılacak.',
            session_stay_signed_in: 'Oturumda kal'
        },
        audit: {
            action_session_replaced: 'Oturum değiştirildi',
            action_session_expired: 'Oturum sona erdi',
            action_session_ip_change: 'Oturum IP değişimi'
        },
        security_audit: {
            tab_sessions: 'Panel oturumları',
            sessions_hint: 'Konsol oturumlarınız. Hesap başına yalnızca bir etkin oturuma izin verilir; yeni giriş öncekini sonlandırır.',
            sessions_policy: 'Boşta kalma: {{idle}} dk · Mutlak üst sınır: {{max}} sa · Hesap başına bir etkin oturum',
            no_sessions: 'Henüz kayıtlı panel oturumu yok.',
            session_current: 'Geçerli',
            session_active: 'Etkin',
            session_ended: 'Sona erdi',
            col_status: 'Durum',
            col_started: 'Başlangıç',
            col_last_activity: 'Son etkinlik',
            col_ended: 'Bitiş',
            col_reason: 'Bitiş nedeni',
            col_user_agent: 'Tarayıcı',
            reason_logout: 'Çıkış',
            reason_replaced: 'Yeni girişle değiştirildi',
            reason_idle: 'Boşta kalma zaman aşımı',
            reason_max_age: 'Maksimum ömür',
            reason_revoked: 'İptal edildi',
            reason_destroyed: 'Yok edildi'
        }
    },
    uk: {
        auth: {
            session_expired: 'Ваш сеанс закінчився або був замінений новим входом. Увійдіть знову.',
            session_idle_warning_title: 'Сеанс скоро завершиться',
            session_idle_warning_body: 'Вас буде виведено через неактивність за {{seconds}} с.',
            session_stay_signed_in: 'Залишатися в системі'
        },
        audit: {
            action_session_replaced: 'Сеанс замінено',
            action_session_expired: 'Сеанс завершено',
            action_session_ip_change: 'Зміна IP сеансу'
        },
        security_audit: {
            tab_sessions: 'Сеанси панелі',
            sessions_hint: 'Ваші входи в консоль. На обліковий запис дозволено лише один активний сеанс; новий вхід завершує попередній.',
            sessions_policy: 'Таймаут простою: {{idle}} хв · Абсолютний макс: {{max}} год · Один активний сеанс на обліковий запис',
            no_sessions: 'Ще немає записаних сеансів панелі.',
            session_current: 'Поточний',
            session_active: 'Активний',
            session_ended: 'Завершений',
            col_status: 'Статус',
            col_started: 'Початок',
            col_last_activity: 'Остання активність',
            col_ended: 'Кінець',
            col_reason: 'Причина завершення',
            col_user_agent: 'Браузер',
            reason_logout: 'Вихід',
            reason_replaced: 'Замінено новим входом',
            reason_idle: 'Таймаут простою',
            reason_max_age: 'Максимальний час життя',
            reason_revoked: 'Відкликано',
            reason_destroyed: 'Знищено'
        }
    },
    vi: {
        auth: {
            session_expired: 'Phiên của bạn đã hết hạn hoặc bị thay bằng lần đăng nhập mới. Vui lòng đăng nhập lại.',
            session_idle_warning_title: 'Phiên sắp hết hạn',
            session_idle_warning_body: 'Bạn sẽ bị đăng xuất do không hoạt động sau {{seconds}} giây.',
            session_stay_signed_in: 'Giữ đăng nhập'
        },
        audit: {
            action_session_replaced: 'Phiên bị thay',
            action_session_expired: 'Phiên hết hạn',
            action_session_ip_change: 'Đổi IP phiên'
        },
        security_audit: {
            tab_sessions: 'Phiên bảng điều khiển',
            sessions_hint: 'Phiên đăng nhập console. Mỗi tài khoản chỉ có một phiên đang hoạt động; đăng nhập mới sẽ kết thúc phiên trước.',
            sessions_policy: 'Hết hạn rảnh: {{idle}} phút · Tối đa tuyệt đối: {{max}} giờ · Một phiên hoạt động mỗi tài khoản',
            no_sessions: 'Chưa có phiên bảng điều khiển nào được ghi nhận.',
            session_current: 'Hiện tại',
            session_active: 'Đang hoạt động',
            session_ended: 'Đã kết thúc',
            col_status: 'Trạng thái',
            col_started: 'Bắt đầu',
            col_last_activity: 'Hoạt động cuối',
            col_ended: 'Kết thúc',
            col_reason: 'Lý do kết thúc',
            col_user_agent: 'Trình duyệt',
            reason_logout: 'Đăng xuất',
            reason_replaced: 'Bị thay bởi đăng nhập mới',
            reason_idle: 'Hết hạn rảnh',
            reason_max_age: 'Thời gian sống tối đa',
            reason_revoked: 'Đã thu hồi',
            reason_destroyed: 'Đã hủy'
        }
    },
    zh: {
        auth: {
            session_expired: '您的会话已过期或被新的登录替换。请重新登录。',
            session_idle_warning_title: '会话即将过期',
            session_idle_warning_body: '由于无操作，将在 {{seconds}} 秒后退出登录。',
            session_stay_signed_in: '保持登录'
        },
        audit: {
            action_session_replaced: '会话已替换',
            action_session_expired: '会话已过期',
            action_session_ip_change: '会话 IP 变更'
        },
        security_audit: {
            tab_sessions: '面板会话',
            sessions_hint: '您的控制台登录会话。每个账户仅允许一个活动会话；新登录会结束之前的会话。',
            sessions_policy: '空闲超时：{{idle}} 分钟 · 绝对上限：{{max}} 小时 · 每账户一个活动会话',
            no_sessions: '尚未记录面板会话。',
            session_current: '当前',
            session_active: '活动',
            session_ended: '已结束',
            col_status: '状态',
            col_started: '开始',
            col_last_activity: '最后活动',
            col_ended: '结束',
            col_reason: '结束原因',
            col_user_agent: '浏览器',
            reason_logout: '注销',
            reason_replaced: '被新登录替换',
            reason_idle: '空闲超时',
            reason_max_age: '最长生命周期',
            reason_revoked: '已吊销',
            reason_destroyed: '已销毁'
        }
    },
    'zh-TW': {
        auth: {
            session_expired: '您的工作階段已過期或被新的登入取代。請重新登入。',
            session_idle_warning_title: '工作階段即將過期',
            session_idle_warning_body: '因閒置將在 {{seconds}} 秒後登出。',
            session_stay_signed_in: '保持登入'
        },
        audit: {
            action_session_replaced: '工作階段已取代',
            action_session_expired: '工作階段已過期',
            action_session_ip_change: '工作階段 IP 變更'
        },
        security_audit: {
            tab_sessions: '面板工作階段',
            sessions_hint: '您的主控台登入工作階段。每個帳戶僅允許一個作用中工作階段；新登入會結束前一個。',
            sessions_policy: '閒置逾時：{{idle}} 分 · 絕對上限：{{max}} 小時 · 每帳戶一個作用中工作階段',
            no_sessions: '尚未記錄面板工作階段。',
            session_current: '目前',
            session_active: '作用中',
            session_ended: '已結束',
            col_status: '狀態',
            col_started: '開始',
            col_last_activity: '最後活動',
            col_ended: '結束',
            col_reason: '結束原因',
            col_user_agent: '瀏覽器',
            reason_logout: '登出',
            reason_replaced: '被新登入取代',
            reason_idle: '閒置逾時',
            reason_max_age: '最長生命週期',
            reason_revoked: '已撤銷',
            reason_destroyed: '已銷毀'
        }
    }
};

let missing = 0;
for (const file of files) {
    const locale = file.replace(/\.json$/, '');
    const pack = packs[locale];
    if (!pack) {
        console.error('Missing locale pack:', locale);
        missing += 1;
        continue;
    }
    const p = path.join(dir, file);
    const data = JSON.parse(fs.readFileSync(p, 'utf8'));
    data.auth = Object.assign({}, data.auth, pack.auth);
    data.audit = Object.assign({}, data.audit, pack.audit);
    data.security_audit = Object.assign({}, data.security_audit, pack.security_audit);
    fs.writeFileSync(p, `${JSON.stringify(data, null, 4)}\n`);
    console.log('updated', locale);
}
if (missing) process.exit(1);
