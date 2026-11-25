#!/usr/bin/env node
/**
 * Patch security_audit check detail/fix i18n keys across all locales.
 * Run: node web-nodejs/scripts/patch-security-check-detail-i18n.js
 */
'use strict';

const fs = require('fs');
const path = require('path');

const langDir = path.join(__dirname, '..', 'lang');

const en = {
    check_detail_title: 'Security check result',
    check_detail_status: 'Status',
    check_detail_result: 'Test result',
    check_detail_fix: 'How to fix',
    check_detail_ok_note: 'No action required for this check.',
    check_detail_close: 'Close',

    check_tls_api_name: 'API TLS',
    check_tls_api_result_ok: 'TLS is enabled on the Go API (health.tls=true).',
    check_tls_api_result_fail: 'TLS is disabled on the Go API (health.tls=false).',
    check_tls_api_fix: 'Terminate TLS in front of the Go API (reverse proxy) or enable TLS certificates on the Go server, restart services, then re-check this overview.',

    check_api_key_age_name: 'API Key Rotation (< 90 days)',
    check_api_key_age_result_ok: 'All {total_keys} API keys are newer than {threshold_days} days.',
    check_api_key_age_result_fail: '{old_keys} of {total_keys} API keys are older than {threshold_days} days.',
    check_api_key_age_fix: 'Open Keys and rotate or replace keys older than 90 days. Prefer shorter rotation intervals in production.',

    check_failed_logins_name: 'Low Failed Login Rate',
    check_failed_logins_result_ok: '{count} failed logins in the last {window_hours} hours (threshold: {threshold}).',
    check_failed_logins_result_fail: '{count} failed logins in the last {window_hours} hours exceed the threshold of {threshold}.',
    check_failed_logins_fix: 'Review Audit Events for failed logins, investigate source IPs, enable 2FA, and use the blocklist if needed.',

    check_no_bans_name: 'No Active Bans',
    check_no_bans_result_ok: 'No active blocklist entries.',
    check_no_bans_result_fail: '{count} active blocklist entries.',
    check_no_bans_fix: 'Review active bans/blocklist entries, investigate the original incidents, and remove stale entries when safe.',

    check_audit_log_name: 'Audit Logging',
    check_audit_log_result_ok: 'Audit events API is reachable.',
    check_audit_log_result_fail: 'Could not load audit events from the Go server.',
    check_audit_log_fix: 'Ensure the Go server is running and the console can reach its API. Check /audit/events and service logs.',

    check_blocklist_name: 'Blocklist Available',
    check_blocklist_result_ok: 'Blocklist API is reachable.',
    check_blocklist_result_fail: 'Could not load the blocklist from the Go server.',
    check_blocklist_fix: 'Ensure the Go server is running and the blocklist endpoint responds. Check service health and network between console and Go.'
};

const translations = {
    en,
    pl: {
        check_detail_title: 'Wynik kontroli bezpieczeństwa',
        check_detail_status: 'Status',
        check_detail_result: 'Wynik testu',
        check_detail_fix: 'Jak naprawić',
        check_detail_ok_note: 'Ta kontrola nie wymaga działań.',
        check_detail_close: 'Zamknij',

        check_tls_api_name: 'API TLS',
        check_tls_api_result_ok: 'TLS jest włączony na API Go (health.tls=true).',
        check_tls_api_result_fail: 'TLS jest wyłączony na API Go (health.tls=false).',
        check_tls_api_fix: 'Włącz TLS przed API Go (reverse proxy) albo certyfikaty TLS na serwerze Go, zrestartuj usługi i ponów kontrolę.',

        check_api_key_age_name: 'Rotacja kluczy API (< 90 dni)',
        check_api_key_age_result_ok: 'Wszystkie klucze API ({total_keys}) są młodsze niż {threshold_days} dni.',
        check_api_key_age_result_fail: '{old_keys} z {total_keys} kluczy API jest starszych niż {threshold_days} dni.',
        check_api_key_age_fix: 'Otwórz Klucze i zrotuj lub wymień klucze starsze niż 90 dni. W produkcji preferuj krótsze cykle rotacji.',

        check_failed_logins_name: 'Niski wskaźnik nieudanych logowań',
        check_failed_logins_result_ok: '{count} nieudanych logowań w ciągu {window_hours} h (próg: {threshold}).',
        check_failed_logins_result_fail: '{count} nieudanych logowań w ciągu {window_hours} h przekracza próg {threshold}.',
        check_failed_logins_fix: 'Przejrzyj Zdarzenia audytu, zbadaj źródłowe IP, włącz 2FA i w razie potrzeby użyj blocklisty.',

        check_no_bans_name: 'Brak aktywnych blokad',
        check_no_bans_result_ok: 'Brak aktywnych wpisów blocklisty.',
        check_no_bans_result_fail: 'Aktywne wpisy blocklisty: {count}.',
        check_no_bans_fix: 'Przejrzyj aktywne banów/blocklistę, zbadaj pierwotne incydenty i usuń nieaktualne wpisy, gdy jest to bezpieczne.',

        check_audit_log_name: 'Rejestrowanie audytu',
        check_audit_log_result_ok: 'API zdarzeń audytu jest dostępne.',
        check_audit_log_result_fail: 'Nie udało się wczytać zdarzeń audytu z serwera Go.',
        check_audit_log_fix: 'Upewnij się, że serwer Go działa i konsola ma do niego dostęp. Sprawdź /audit/events oraz logi usług.',

        check_blocklist_name: 'Blocklista dostępna',
        check_blocklist_result_ok: 'API blocklisty jest dostępne.',
        check_blocklist_result_fail: 'Nie udało się wczytać blocklisty z serwera Go.',
        check_blocklist_fix: 'Upewnij się, że serwer Go działa i endpoint blocklisty odpowiada. Sprawdź health usług oraz sieć między konsolą a Go.'
    },
    de: {
        check_detail_title: 'Ergebnis der Sicherheitsprüfung',
        check_detail_status: 'Status',
        check_detail_result: 'Testergebnis',
        check_detail_fix: 'So beheben',
        check_detail_ok_note: 'Für diese Prüfung ist keine Aktion erforderlich.',
        check_detail_close: 'Schließen',
        check_tls_api_name: 'API TLS',
        check_tls_api_result_ok: 'TLS ist für die Go-API aktiviert (health.tls=true).',
        check_tls_api_result_fail: 'TLS ist für die Go-API deaktiviert (health.tls=false).',
        check_tls_api_fix: 'TLS vor der Go-API (Reverse Proxy) oder Zertifikate am Go-Server aktivieren, Dienste neu starten und erneut prüfen.',
        check_api_key_age_name: 'API-Schlüssel-Rotation (< 90 Tage)',
        check_api_key_age_result_ok: 'Alle {total_keys} API-Schlüssel sind jünger als {threshold_days} Tage.',
        check_api_key_age_result_fail: '{old_keys} von {total_keys} API-Schlüsseln sind älter als {threshold_days} Tage.',
        check_api_key_age_fix: 'Öffnen Sie Schlüssel und rotieren oder ersetzen Sie Schlüssel älter als 90 Tage.',
        check_failed_logins_name: 'Niedrige Fehlanmeldungsrate',
        check_failed_logins_result_ok: '{count} Fehlanmeldungen in den letzten {window_hours} Stunden (Schwelle: {threshold}).',
        check_failed_logins_result_fail: '{count} Fehlanmeldungen in den letzten {window_hours} Stunden überschreiten die Schwelle {threshold}.',
        check_failed_logins_fix: 'Prüfen Sie Audit-Ereignisse, untersuchen Sie Quell-IPs, aktivieren Sie 2FA und nutzen Sie bei Bedarf die Blockliste.',
        check_no_bans_name: 'Keine aktiven Sperren',
        check_no_bans_result_ok: 'Keine aktiven Blocklisteneinträge.',
        check_no_bans_result_fail: '{count} aktive Blocklisteneinträge.',
        check_no_bans_fix: 'Aktive Sperren prüfen, Vorfälle untersuchen und veraltete Einträge entfernen.',
        check_audit_log_name: 'Audit-Protokollierung',
        check_audit_log_result_ok: 'Audit-Ereignis-API ist erreichbar.',
        check_audit_log_result_fail: 'Audit-Ereignisse vom Go-Server konnten nicht geladen werden.',
        check_audit_log_fix: 'Stellen Sie sicher, dass der Go-Server läuft und die Konsole die API erreicht.',
        check_blocklist_name: 'Blockliste verfügbar',
        check_blocklist_result_ok: 'Blocklisten-API ist erreichbar.',
        check_blocklist_result_fail: 'Blockliste vom Go-Server konnte nicht geladen werden.',
        check_blocklist_fix: 'Stellen Sie sicher, dass der Go-Server läuft und der Blocklisten-Endpunkt antwortet.'
    },
    fr: {
        check_detail_title: 'Résultat du contrôle de sécurité',
        check_detail_status: 'Statut',
        check_detail_result: 'Résultat du test',
        check_detail_fix: 'Comment corriger',
        check_detail_ok_note: 'Aucune action requise pour ce contrôle.',
        check_detail_close: 'Fermer',
        check_tls_api_name: 'API TLS',
        check_tls_api_result_ok: 'TLS est activé sur l’API Go (health.tls=true).',
        check_tls_api_result_fail: 'TLS est désactivé sur l’API Go (health.tls=false).',
        check_tls_api_fix: 'Activez TLS devant l’API Go (proxy inverse) ou les certificats TLS du serveur Go, redémarrez, puis revérifiez.',
        check_api_key_age_name: 'Rotation des clés API (< 90 jours)',
        check_api_key_age_result_ok: 'Les {total_keys} clés API ont moins de {threshold_days} jours.',
        check_api_key_age_result_fail: '{old_keys} clés API sur {total_keys} ont plus de {threshold_days} jours.',
        check_api_key_age_fix: 'Ouvrez Clés et faites tourner ou remplacez les clés de plus de 90 jours.',
        check_failed_logins_name: 'Faible taux d’échecs de connexion',
        check_failed_logins_result_ok: '{count} échecs de connexion sur {window_hours} h (seuil : {threshold}).',
        check_failed_logins_result_fail: '{count} échecs de connexion sur {window_hours} h dépassent le seuil {threshold}.',
        check_failed_logins_fix: 'Examinez les événements d’audit, les IP sources, activez la 2FA et utilisez la liste de blocage si besoin.',
        check_no_bans_name: 'Aucune ban active',
        check_no_bans_result_ok: 'Aucune entrée active dans la liste de blocage.',
        check_no_bans_result_fail: '{count} entrées actives dans la liste de blocage.',
        check_no_bans_fix: 'Examinez les bans actifs, les incidents d’origine, puis retirez les entrées obsolètes.',
        check_audit_log_name: 'Journal d’audit',
        check_audit_log_result_ok: 'L’API des événements d’audit est joignable.',
        check_audit_log_result_fail: 'Impossible de charger les événements d’audit depuis le serveur Go.',
        check_audit_log_fix: 'Vérifiez que le serveur Go tourne et que la console atteint son API.',
        check_blocklist_name: 'Liste de blocage disponible',
        check_blocklist_result_ok: 'L’API de liste de blocage est joignable.',
        check_blocklist_result_fail: 'Impossible de charger la liste de blocage depuis le serveur Go.',
        check_blocklist_fix: 'Vérifiez que le serveur Go tourne et que l’endpoint de liste de blocage répond.'
    },
    es: {
        check_detail_title: 'Resultado del control de seguridad',
        check_detail_status: 'Estado',
        check_detail_result: 'Resultado de la prueba',
        check_detail_fix: 'Cómo solucionarlo',
        check_detail_ok_note: 'No se requiere ninguna acción para este control.',
        check_detail_close: 'Cerrar',
        check_tls_api_name: 'API TLS',
        check_tls_api_result_ok: 'TLS está habilitado en la API Go (health.tls=true).',
        check_tls_api_result_fail: 'TLS está deshabilitado en la API Go (health.tls=false).',
        check_tls_api_fix: 'Habilite TLS delante de la API Go (proxy inverso) o certificados en el servidor Go, reinicie y vuelva a comprobar.',
        check_api_key_age_name: 'Rotación de claves API (< 90 días)',
        check_api_key_age_result_ok: 'Las {total_keys} claves API tienen menos de {threshold_days} días.',
        check_api_key_age_result_fail: '{old_keys} de {total_keys} claves API tienen más de {threshold_days} días.',
        check_api_key_age_fix: 'Abra Claves y rote o reemplace las claves con más de 90 días.',
        check_failed_logins_name: 'Tasa baja de inicios fallidos',
        check_failed_logins_result_ok: '{count} inicios fallidos en {window_hours} h (umbral: {threshold}).',
        check_failed_logins_result_fail: '{count} inicios fallidos en {window_hours} h superan el umbral {threshold}.',
        check_failed_logins_fix: 'Revise eventos de auditoría, IPs de origen, active 2FA y use la blocklist si hace falta.',
        check_no_bans_name: 'Sin bloqueos activos',
        check_no_bans_result_ok: 'No hay entradas activas en la blocklist.',
        check_no_bans_result_fail: '{count} entradas activas en la blocklist.',
        check_no_bans_fix: 'Revise bloqueos activos, investigue incidentes y elimine entradas obsoletas.',
        check_audit_log_name: 'Registro de auditoría',
        check_audit_log_result_ok: 'La API de eventos de auditoría es accesible.',
        check_audit_log_result_fail: 'No se pudieron cargar los eventos de auditoría del servidor Go.',
        check_audit_log_fix: 'Asegúrese de que el servidor Go esté en marcha y la consola alcance su API.',
        check_blocklist_name: 'Blocklist disponible',
        check_blocklist_result_ok: 'La API de blocklist es accesible.',
        check_blocklist_result_fail: 'No se pudo cargar la blocklist del servidor Go.',
        check_blocklist_fix: 'Asegúrese de que el servidor Go esté en marcha y el endpoint de blocklist responda.'
    }
};

const keys = Object.keys(en);

for (const file of fs.readdirSync(langDir).filter((f) => f.endsWith('.json'))) {
    const locale = file.slice(0, -5);
    const filePath = path.join(langDir, file);
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, ''));
    if (!data.security_audit) data.security_audit = {};
    const pack = translations[locale] || en;
    for (const key of keys) {
        data.security_audit[key] = pack[key] || en[key];
    }
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + '\n', 'utf8');
    console.log('patched', locale);
}
