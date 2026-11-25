'use strict';
const languages = require('./languages.json');
function normalizeLanguage(value) { return languages.some(language => language.code === value) ? value : 'en'; }
module.exports = { languages, normalizeLanguage };
