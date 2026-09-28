import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Gtk from 'gi://Gtk';
import { _, escapeMarkup, formatString } from './translate.js';

const GITHUB_URL = 'https://github.com/alecdromano/sylepsign';
const DONATION_URL = 'https://ko-fi.com/alecromano';

function queryMpv() {
    const p = GLib.find_program_in_path('mpv');
    if (!p) return { ok: false, text: _('Not found — required for video playback') };
    try {
        const [success, stdout] = GLib.spawn_command_line_sync('mpv --version');
        if (success && stdout) {
            const ver = new TextDecoder().decode(stdout).split('\n')[0].trim();
            return { ok: true, text: `${ver} (${p})` };
        }
    } catch (_e) {}
    return { ok: true, text: `mpv (${p})` };
}

function queryAvahi() {
    const daemon = GLib.find_program_in_path('avahi-daemon') ||
        (GLib.file_test('/usr/sbin/avahi-daemon', GLib.FileTest.IS_EXECUTABLE) ? '/usr/sbin/avahi-daemon' : '');
    const browse = GLib.find_program_in_path('avahi-browse');
    if (!daemon && !browse) {
        return { ok: false, text: _('Not found — required for network discovery') };
    }
    return { ok: true, text: _('Avahi discovery service active') };
}

function readInstalledVersion() {
    try {
        const file = Gio.File.new_for_uri(import.meta.url).get_parent().get_parent().get_child('metadata.json');
        const [ok, bytes] = file.load_contents(null);
        if (ok) {
            const parsed = JSON.parse(new TextDecoder('utf-8').decode(bytes));
            if (parsed['version-name']) return parsed['version-name'];
        }
    } catch (_e) {}
    return null;
}

export function wireProgram(client, dynamicRefs, groupsMap, messages = {}) {
    const versionRef = dynamicRefs.get('installed_version');
    if (versionRef?.row) {
        const localVersion = readInstalledVersion();
        if (localVersion) {
            versionRef.row.set_subtitle(escapeMarkup(localVersion));
        }
        client?.getStatus((status, err) => {
            if (!err && status?.version) {
                versionRef.row.set_subtitle(escapeMarkup(status.version));
            }
        });
    }
    const checkRef = dynamicRefs.get('check_updates');
    const updateStatusRef = dynamicRefs.get('update_status');
    const upgradeRef = dynamicRefs.get('apply_upgrade');
    const upgradeGroup = groupsMap.get('upgrade_section');
    const mpvRef = dynamicRefs.get('dep_mpv');
    const avahiRef = dynamicRefs.get('dep_avahi');
    const githubRef = dynamicRefs.get('github_link');
    const donateRef = dynamicRefs.get('donate_bubble_tea');

    const mpvInfo = queryMpv();
    if (mpvRef?.row) {
        mpvRef.row.set_subtitle(escapeMarkup(mpvInfo.text));
        const img = new Gtk.Image({ icon_name: mpvInfo.ok ? 'emblem-ok-symbolic' : 'dialog-warning-symbolic' });
        if (!mpvInfo.ok) {
            img.add_css_class('warning');
            mpvRef.row.add_css_class('warning');
        }
        mpvRef.row.add_prefix(img);
    }

    const avahiInfo = queryAvahi();
    if (avahiRef?.row) {
        avahiRef.row.set_subtitle(escapeMarkup(avahiInfo.text));
        const img = new Gtk.Image({ icon_name: avahiInfo.ok ? 'emblem-ok-symbolic' : 'dialog-warning-symbolic' });
        if (!avahiInfo.ok) {
            img.add_css_class('warning');
            avahiRef.row.add_css_class('warning');
        }
        avahiRef.row.add_prefix(img);
    }

    if (githubRef?.btn) {
        githubRef.btn.connect('clicked', () => {
            try { Gio.AppInfo.launch_default_for_uri(GITHUB_URL, null); } catch (_e) {}
        });
    }

    if (donateRef?.btn) {
        donateRef.btn.connect('clicked', () => {
            try { Gio.AppInfo.launch_default_for_uri(DONATION_URL, null); } catch (_e) {}
        });
    }

    if (checkRef?.btn) {
        const spec = checkRef.spec;
        checkRef.btn.connect('clicked', () => {
            checkRef.btn.set_sensitive(false);
            checkRef.btn.set_label(_(spec.loading_label));
            client?.update((info, err) => {
                checkRef.btn.set_sensitive(true);
                checkRef.btn.set_label(_(spec.repeat_label));
                if (err || !info) {
                    updateStatusRef?.row.set_subtitle(escapeMarkup(_(messages.update_failed)));
                    return;
                }
                if (versionRef) versionRef.row.set_subtitle(escapeMarkup(info.currentVersion));
                if (info.available) {
                    const statusText = formatString(_(messages.update_available), { version: info.latestVersion });
                    const readyText = formatString(_(messages.upgrade_ready), { version: info.latestVersion });
                    updateStatusRef?.row.set_subtitle(escapeMarkup(statusText));
                    upgradeRef?.row.set_subtitle(escapeMarkup(readyText));
                    upgradeGroup?.set_visible(true);
                } else {
                    updateStatusRef?.row.set_subtitle(escapeMarkup(_(messages.up_to_date)));
                    upgradeGroup?.set_visible(false);
                }
            });
        });
    }

    if (upgradeRef?.btn) {
        const spec = upgradeRef.spec;
        upgradeRef.btn.connect('clicked', () => {
            upgradeRef.btn.set_sensitive(false);
            upgradeRef.btn.set_label(_(spec.loading_label));
            client?.upgrade((res, err) => {
                if (!err && res?.success) {
                    upgradeRef.btn.set_label(_(spec.success_label));
                    updateStatusRef?.row.set_subtitle(escapeMarkup(_(messages.upgrade_success)));
                } else {
                    upgradeRef.btn.set_sensitive(true);
                    upgradeRef.btn.set_label(_(spec.retry_label));
                    const errDetail = res?.output || err?.message || 'unknown error';
                    updateStatusRef?.row.set_subtitle(escapeMarkup(formatString(_(messages.upgrade_failed), { error: errDetail })));
                }
            });
        });
    }
}
