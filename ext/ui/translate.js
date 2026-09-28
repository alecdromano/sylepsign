import GLib from 'gi://GLib';
import * as Gettext from 'gettext';

let activeTranslator = null;
let customCatalog = null;

export function initTranslator(translatorFn = null, catalog = null) {
    activeTranslator = translatorFn;
    customCatalog = catalog;
}

export function _(str) {
    if (!str || typeof str !== 'string') {
        return str;
    }
    if (customCatalog && Object.prototype.hasOwnProperty.call(customCatalog, str)) {
        return customCatalog[str];
    }
    if (typeof activeTranslator === 'function') {
        return activeTranslator(str);
    }
    try {
        return Gettext.gettext(str);
    } catch (_) {
        return str;
    }
}

export function escapeMarkup(text) {
    if (!text || typeof text !== 'string') {
        return text || '';
    }
    return GLib.markup_escape_text(text, -1);
}

export function formatString(template, vars = {}) {
    if (!template || typeof template !== 'string') {
        return '';
    }
    return template.replace(/\{(\w+)\}/g, (match, key) => {
        return Object.prototype.hasOwnProperty.call(vars, key) ? vars[key] : match;
    });
}

export function extractTranslatableStrings(layout) {
    const strings = new Set();

    if (layout.pages) {
        for (const page of layout.pages) {
            if (page.title) strings.add(page.title);

            if (page.groups) {
                for (const group of page.groups) {
                    if (group.title) strings.add(group.title);

                    if (group.rows) {
                        for (const row of group.rows) {
                            if (row.title) strings.add(row.title);
                            if (row.subtitle) strings.add(row.subtitle);
                            if (row.custom_title) strings.add(row.custom_title);
                            if (row.button_label) strings.add(row.button_label);
                            if (row.loading_label) strings.add(row.loading_label);
                            if (row.success_label) strings.add(row.success_label);
                            if (row.failure_label) strings.add(row.failure_label);
                            if (row.retry_label) strings.add(row.retry_label);
                            if (row.repeat_label) strings.add(row.repeat_label);

                            if (row.options) {
                                for (const opt of row.options) {
                                    if (opt.label) strings.add(opt.label);
                                }
                            }
                            if (row.presets) {
                                for (const preset of row.presets) {
                                    if (preset.label) strings.add(preset.label);
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    if (layout.messages) {
        for (const msg of Object.values(layout.messages)) {
            if (typeof msg === 'string') strings.add(msg);
        }
    }

    return Array.from(strings);
}
