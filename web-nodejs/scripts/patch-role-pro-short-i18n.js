#!/usr/bin/env node
/**
 * Shorten users.role_pro badge/option label (table fits "API Pro").
 * Full explanation remains in users.role_desc_pro / role_hint.
 * Run: node web-nodejs/scripts/patch-role-pro-short-i18n.js
 */
'use strict';

const fs = require('fs');
const path = require('path');

const langDir = path.join(__dirname, '..', 'lang');

// Short table/select label — keep product-like and compact in every locale.
const translations = {
    en: 'API Pro',
    pl: 'API Pro',
    de: 'API Pro',
    fr: 'API Pro',
    es: 'API Pro',
    it: 'API Pro',
    pt: 'API Pro',
    nl: 'API Pro',
    cs: 'API Pro',
    da: 'API Pro',
    fi: 'API Pro',
    hu: 'API Pro',
    nb: 'API Pro',
    ro: 'API Pro',
    sv: 'API Pro',
    tr: 'API Pro',
    uk: 'API Pro',
    vi: 'API Pro',
    ar: 'API Pro',
    hi: 'API Pro',
    id: 'API Pro',
    ja: 'API Pro',
    ko: 'API Pro',
    th: 'API Pro',
    zh: 'API Pro',
    'zh-TW': 'API Pro'
};

for (const file of fs.readdirSync(langDir).filter((f) => f.endsWith('.json'))) {
    const locale = file.slice(0, -5);
    const filePath = path.join(langDir, file);
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, ''));
    if (!data.users) data.users = {};
    data.users.role_pro = translations[locale] || translations.en;
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + '\n', 'utf8');
    console.log('patched', locale, '->', data.users.role_pro);
}
