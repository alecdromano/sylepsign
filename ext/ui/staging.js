import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import { _ } from './translate.js';

const GDM_FILE = '/etc/dconf/db/gdm.d/10-sylepsign';
const HELPER_PATHS = [
    '/usr/local/share/sylepsign/helper',
    '/usr/local/bin/helper',
];
const SHELL_SCHEMA = 'org.gnome.shell';
const EXTENSIONS_KEY = 'enabled-extensions';
const EXTENSION_UUID = 'sylepsign@alecromano.com';

export class StagingManager {
    constructor(settings) {
        this.settings = settings;
        this.controls = new Map();
        this.actualState = {};
        this.stagedState = {};
        this.notices = [];
        this.subservients = [];
        this.window = null;
        this.isReverting = false;
    }

    setWindow(win) {
        this.window = win;
    }

    registerNotice(notice) {
        this.notices.push(notice);
        notice.onCancel(() => this.revertAll());
        notice.onApply(() => this.applyAll());
    }

    addSubservientCallback(cb) {
        this.subservients.push(cb);
    }

    notifySubservients() {
        for (const cb of this.subservients) {
            try { cb(); } catch (_e) {}
        }
    }

    registerControl(key, row, getter, setter) {
        const initialVal = this.readActualValue(key);
        this.actualState[key] = initialVal;
        this.stagedState[key] = initialVal;

        this.controls.set(key, { row, getter, setter });
        this.isReverting = true;
        try {
            setter(initialVal);
        } finally {
            this.isReverting = false;
        }
    }

    readActualValue(key) {
        if (key === 'enable-gdm-signage') {
            const f = Gio.File.new_for_path(GDM_FILE);
            if (f.query_exists(null)) {
                try {
                    const [ok, bytes] = f.load_contents(null);
                    if (ok) {
                        const txt = new TextDecoder().decode(bytes);
                        return txt.includes("['sylepsign@alecromano.com']");
                    }
                } catch (_e) {}
            }
            return this.settings.get_boolean('enable-gdm-signage');
        }

        try {
            const variant = this.settings.get_value(key);
            const typeStr = variant.get_type_string();
            if (typeStr === 'b') return variant.get_boolean();
            if (typeStr === 'i') return variant.get_int32();
            if (typeStr === 'd') return variant.get_double();
            if (typeStr === 's') return variant.get_string()[0];
        } catch (_e) {}
        return null;
    }

    onControlChanged(key) {
        if (this.isReverting) return;
        const ctrl = this.controls.get(key);
        if (!ctrl) return;

        this.stagedState[key] = ctrl.getter();
        this.updateNoticeVisibility();

        if (key === 'enable-gdm-signage') {
            this.notifySubservients();
        }
    }

    hasChanges() {
        for (const [key, val] of Object.entries(this.stagedState)) {
            const actual = this.actualState[key];
            if (typeof val === 'number' && typeof actual === 'number') {
                if (Math.abs(actual - val) > 0.0001) return true;
            } else if (actual !== val) {
                return true;
            }
        }
        return false;
    }

    updateNoticeVisibility() {
        const dirty = this.hasChanges();
        for (const notice of this.notices) {
            if (dirty) notice.reveal();
            else notice.dismiss();
        }
    }

    revertAll() {
        this.isReverting = true;
        try {
            for (const [key, ctrl] of this.controls.entries()) {
                const orig = this.actualState[key];
                this.stagedState[key] = orig;
                ctrl.setter(orig);
            }
        } finally {
            this.isReverting = false;
        }
        this.updateNoticeVisibility();
        this.notifySubservients();
    }

    resolveHelper() {
        for (const p of HELPER_PATHS) {
            if (GLib.file_test(p, GLib.FileTest.IS_EXECUTABLE)) return p;
        }
        return '/usr/local/share/sylepsign/helper';
    }

    buildConfigString() {
        const pairs = [];
        for (const [key, val] of Object.entries(this.stagedState)) {
            if (key === 'enable-gdm-signage') continue;
            if (typeof val === 'string') pairs.push(`${key}='${val}'`);
            else if (typeof val === 'boolean') pairs.push(`${key}=${val}`);
            else if (typeof val === 'number') pairs.push(`${key}=${val}`);
        }
        return pairs.join(';');
    }

    applyAll() {
        const helper = this.resolveHelper();
        const gdmEnabled = Boolean(this.stagedState['enable-gdm-signage']);
        const configStr = this.buildConfigString();

        for (const notice of this.notices) notice.setLoading(true);

        try {
            const proc = new Gio.Subprocess({
                argv: ['pkexec', helper, 'sync-gdm', String(gdmEnabled), configStr],
                flags: Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_MERGE,
            });
            proc.init(null);
            proc.communicate_utf8_async(null, null, (p, res) => {
                for (const notice of this.notices) notice.setLoading(false);
                let ok = false;
                try {
                    const [success, stdout] = p.communicate_utf8_finish(res);
                    ok = success && (stdout || '').includes('SYNC_OK');
                } catch (_err) {}

                if (ok) {
                    this.actualState = { ...this.stagedState };
                    this.saveStagedToSettings();

                    if (!gdmEnabled) {
                        this.disableUserSessionLock();
                    }

                    for (const notice of this.notices) notice.dismiss();
                    this.notifySubservients();
                    this.showToast(_('System and GDM settings updated successfully.'));
                } else {
                    this.revertAll();
                    this.showToast(_('Authentication required to apply GDM settings.'));
                }
            });
        } catch (e) {
            for (const notice of this.notices) notice.setLoading(false);
            this.revertAll();
            this.showToast(_('Failed to start authentication process.'));
        }
    }

    disableUserSessionLock() {
        try {
            const shellSettings = new Gio.Settings({ schema_id: SHELL_SCHEMA });
            const list = shellSettings.get_strv(EXTENSIONS_KEY) || [];
            if (list.includes(EXTENSION_UUID)) {
                shellSettings.set_strv(EXTENSIONS_KEY, list.filter(id => id !== EXTENSION_UUID));
            }
        } catch (_e) {}
        try {
            this.settings.set_boolean('enable-user-lockscreen', false);
        } catch (_e) {}
    }

    saveStagedToSettings() {
        for (const [key, val] of Object.entries(this.stagedState)) {
            try {
                if (typeof val === 'boolean') {
                    this.settings.set_boolean(key, val);
                } else if (typeof val === 'number') {
                    const typeStr = this.settings.get_value(key).get_type_string();
                    if (typeStr === 'd') this.settings.set_double(key, val);
                    else this.settings.set_int(key, val);
                } else if (typeof val === 'string') {
                    this.settings.set_string(key, val);
                }
            } catch (_e) {}
        }
    }

    showToast(message) {
        if (!this.window?.add_toast) return;
        try {
            this.window.add_toast(new Adw.Toast({ title: message, timeout: 3 }));
        } catch (_e) {}
    }
}
