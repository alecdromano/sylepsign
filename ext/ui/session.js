import Gio from 'gi://Gio';
import { _ } from './translate.js';

const EXTENSION_UUID = 'sylepsign@alecromano.com';
const SHELL_SCHEMA = 'org.gnome.shell';
const EXTENSIONS_KEY = 'enabled-extensions';

export function bindSessionLockRow(row, settings, staging = null) {
    let shellSettings = null;
    try {
        shellSettings = new Gio.Settings({ schema_id: SHELL_SCHEMA });
    } catch (_err) {
        return;
    }

    let isUpdating = false;

    const isExtensionEnabled = () => {
        const list = shellSettings.get_strv(EXTENSIONS_KEY) || [];
        return list.includes(EXTENSION_UUID);
    };

    const isMasterEnabled = () => {
        if (staging) {
            const staged = staging.stagedState['enable-gdm-signage'];
            if (staged !== undefined) return Boolean(staged);
            const actual = staging.actualState['enable-gdm-signage'];
            if (actual !== undefined) return Boolean(actual);
        }
        return settings.get_boolean('enable-gdm-signage');
    };

    const syncToRow = () => {
        isUpdating = true;
        try {
            const masterOn = isMasterEnabled();
            if (!masterOn) {
                row.set_active(false);
                row.set_sensitive(false);
                row.set_subtitle(_('Disabled — requires master system signage to be enabled on Program tab'));
            } else {
                row.set_sensitive(shellSettings.is_writable(EXTENSIONS_KEY));
                row.set_subtitle(_('Bypass standard GNOME lock screen on idle/lock and activate video signage'));
                row.set_active(isExtensionEnabled());
            }
        } finally {
            isUpdating = false;
        }
    };

    syncToRow();

    row.connect('notify::active', () => {
        if (isUpdating) return;
        if (!isMasterEnabled()) {
            row.set_active(false);
            return;
        }

        const active = row.get_active();
        settings.set_boolean('enable-user-lockscreen', active);

        const current = shellSettings.get_strv(EXTENSIONS_KEY) || [];
        const exists = current.includes(EXTENSION_UUID);

        if (active && !exists) {
            shellSettings.set_strv(EXTENSIONS_KEY, [...current, EXTENSION_UUID]);
        } else if (!active && exists) {
            shellSettings.set_strv(EXTENSIONS_KEY, current.filter(id => id !== EXTENSION_UUID));
        }
    });

    const changedId = shellSettings.connect(`changed::${EXTENSIONS_KEY}`, () => {
        syncToRow();
    });

    const settingsChangedId = settings.connect('changed::enable-gdm-signage', () => {
        syncToRow();
    });

    if (staging) {
        staging.addSubservientCallback(() => {
            syncToRow();
        });
    }

    row.connect('destroy', () => {
        if (changedId && shellSettings) {
            try { shellSettings.disconnect(changedId); } catch (_e) {}
        }
        if (settingsChangedId && settings) {
            try { settings.disconnect(settingsChangedId); } catch (_e) {}
        }
    });
}
