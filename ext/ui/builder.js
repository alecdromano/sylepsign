import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';
import Adw from 'gi://Adw';
import { _, escapeMarkup } from './translate.js';
import { createRow } from './controls.js';
import { wireActions } from './actions.js';
import { ChangeNotice } from './notice.js';
import { StagingManager } from './staging.js';

export function loadLayout(customSource = null) {
    if (customSource && typeof customSource === 'object') {
        return customSource;
    }

    const file = Gio.File.new_for_uri(import.meta.url).get_parent().get_child('layout.json');
    const [ok, bytes] = file.load_contents(null);
    if (!ok) {
        throw new Error('Failed to load preferences layout.json');
    }

    const jsonString = new TextDecoder('utf-8').decode(bytes);
    return JSON.parse(jsonString);
}

export function buildPageFromSpec(pageSpec, settings, dynamicRefs, groupsMap, staging = null) {
    const page = new Adw.PreferencesPage({
        title: _(pageSpec.title),
        icon_name: pageSpec.icon,
    });

    for (const groupSpec of (pageSpec.groups || [])) {
        const group = new Adw.PreferencesGroup({
            title: escapeMarkup(_(groupSpec.title)),
        });

        if (groupSpec.visible === false) {
            group.set_visible(false);
        }
        if (groupSpec.id) {
            groupsMap.set(groupSpec.id, group);
        }

        page.add(group);

        for (const rowSpec of (groupSpec.rows || [])) {
            const rows = createRow(rowSpec, settings, dynamicRefs, staging);
            for (const row of rows) {
                group.add(row);
            }
        }
    }

    return page;
}

export function attachBottomNotice(window, staging) {
    if (!window?.get_content || !staging) return;
    const content = window.get_content();
    if (!content?.get_child) return;

    const notice = new ChangeNotice();
    notice.bindWindowKeys(window);
    staging.registerNotice(notice);

    const origChild = content.get_child();
    const overlay = new Gtk.Overlay();
    content.set_child(overlay);
    overlay.set_child(origChild);
    overlay.add_overlay(notice.widget);
}

export function bindNavigationShortcuts(window, pages) {
    if (!window?.add_controller || !pages?.length) return;
    const controller = new Gtk.EventControllerKey();
    controller.connect('key-pressed', (_c, keyval, _kc, state) => {
        const isAlt = (state & 0x8) !== 0 || (state & 0x18) !== 0;
        const isCtrl = (state & 0x4) !== 0;

        if (isAlt && keyval >= 0x31 && keyval <= 0x35) {
            const idx = keyval - 0x31;
            if (pages[idx]) {
                window.set_visible_page(pages[idx]);
                return true;
            }
        }
        if (isCtrl && keyval === 0xff56) {
            const cur = window.get_visible_page();
            const idx = pages.indexOf(cur);
            if (idx !== -1 && idx + 1 < pages.length) {
                window.set_visible_page(pages[idx + 1]);
                return true;
            }
        }
        if (isCtrl && keyval === 0xff55) {
            const cur = window.get_visible_page();
            const idx = pages.indexOf(cur);
            if (idx > 0) {
                window.set_visible_page(pages[idx - 1]);
                return true;
            }
        }
        return false;
    });
    window.add_controller(controller);
}

export function buildPreferences(settings, client, customLayout = null, window = null) {
    const layout = loadLayout(customLayout);
    const dynamicRefs = new Map();
    const groupsMap = new Map();
    const pages = [];
    const staging = new StagingManager(settings);
    if (window) {
        staging.setWindow(window);
    }

    for (const pageSpec of (layout.pages || [])) {
        const page = buildPageFromSpec(pageSpec, settings, dynamicRefs, groupsMap, staging);
        pages.push(page);
    }

    wireActions(client, dynamicRefs, groupsMap, layout.messages || {}, settings);
    pages.staging = staging;
    return pages;
}

export function buildPage(pageId, settings, client, customLayout = null) {
    const layout = loadLayout(customLayout);
    const pageSpec = (layout.pages || []).find(p => p.id === pageId);
    if (!pageSpec) {
        throw new Error(`Page '${pageId}' not found in layout specification`);
    }

    const dynamicRefs = new Map();
    const groupsMap = new Map();
    const page = buildPageFromSpec(pageSpec, settings, dynamicRefs, groupsMap);

    wireActions(client, dynamicRefs, groupsMap, layout.messages || {}, settings);
    return page;
}
