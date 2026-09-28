import { ExtensionPreferences, gettext as _ } from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';
import { DaemonClient } from './client.js';
import { buildPreferences, attachBottomNotice, bindNavigationShortcuts } from './ui/builder.js';
import { initTranslator } from './ui/translate.js';

export default class SylepsignPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        this.initTranslations();
        initTranslator(_);

        const settings = this.getSettings('org.gnome.shell.extensions.sylepsign');
        const client = new DaemonClient();

        window.set_default_size(680, 720);
        const pages = buildPreferences(settings, client, null, window);
        for (const page of pages) {
            window.add(page);
        }

        bindNavigationShortcuts(window, pages);

        if (pages.staging) {
            attachBottomNotice(window, pages.staging);
        }
    }
}
