import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Gtk from 'gi://Gtk';
import { _, escapeMarkup, formatString } from './translate.js';
import { HELPER_PATH } from './pool.js';

export const IMAGE_EXTS = ['.png', '.svg', '.jpg', '.jpeg', '.webp'];

export function wireLogo(client, dynamicRefs, groupsMap, messages = {}, settings = null) {
    const logoRef = dynamicRefs?.get('greeter_logo');
    if (!logoRef?.row) return;

    const row = logoRef.row;
    const prefSettings = settings || new Gio.Settings({ schema_id: 'org.gnome.shell.extensions.sylepsign' });

    const icon = new Gtk.Image({
        pixel_size: 32,
        valign: Gtk.Align.CENTER,
    });
    row.add_prefix(icon);

    const resetBtn = new Gtk.Button({
        label: _(messages.logo_reset || 'Restore Stock Logo'),
        icon_name: 'edit-clear-symbolic',
        valign: Gtk.Align.CENTER,
    });

    const changeBtn = new Gtk.Button({
        label: _(messages.logo_change || 'Change Logo…'),
        icon_name: 'document-open-symbolic',
        valign: Gtk.Align.CENTER,
    });
    changeBtn.add_css_class('suggested-action');

    row.add_suffix(resetBtn);
    row.add_suffix(changeBtn);

    const updateLogoDisplay = () => {
        let currentPath = '';
        try {
            currentPath = prefSettings.get_string('greeter-logo-path') || '';
        } catch (_e) {}

        const hasCustom = Boolean(currentPath && GLib.file_test(currentPath, GLib.FileTest.EXISTS));

        if (hasCustom) {
            const baseName = GLib.path_get_basename(currentPath);
            const tmpl = messages.logo_custom || 'Custom logo: {file}';
            row.set_subtitle(escapeMarkup(formatString(_(tmpl), { file: baseName })));
            try {
                icon.set_from_file(currentPath);
            } catch (_e) {
                icon.set_from_icon_name('image-x-generic-symbolic');
            }
            resetBtn.set_sensitive(true);
        } else {
            row.set_subtitle(escapeMarkup(_(messages.logo_stock || 'Using stock operating system logo')));
            icon.set_from_icon_name('image-x-generic-symbolic');
            resetBtn.set_sensitive(false);
        }
    };

    updateLogoDisplay();

    try {
        prefSettings.connect('changed::greeter-logo-path', updateLogoDisplay);
    } catch (_e) {}

    changeBtn.connect('clicked', () => {
        const win = changeBtn.get_root?.() || null;
        const chooser = new Gtk.FileChooserNative({
            title: _(messages.logo_dialog_title || 'Select Greeter Logo Image'),
            transient_for: win,
            action: Gtk.FileChooserAction.OPEN,
            accept_label: _('Set Logo'),
            cancel_label: _('Cancel'),
        });

        const filter = new Gtk.FileFilter();
        filter.set_name(_(messages.logo_filter_images || 'Image Files (*.png, *.svg, *.jpg, *.webp)'));
        for (const ext of IMAGE_EXTS) {
            filter.add_pattern(`*${ext}`);
            filter.add_pattern(`*${ext.toUpperCase()}`);
        }
        chooser.add_filter(filter);

        chooser.connect('response', (_dlg, responseId) => {
            if (responseId === Gtk.ResponseType.ACCEPT) {
                const file = chooser.get_file();
                const srcPath = file?.get_path();
                if (srcPath) {
                    changeBtn.set_sensitive(false);
                    resetBtn.set_sensitive(false);
                    try {
                        const proc = new Gio.Subprocess({
                            argv: ['pkexec', HELPER_PATH, 'set-logo', srcPath],
                            flags: Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_MERGE,
                        });
                        proc.init(null);
                        proc.communicate_utf8_async(null, null, (p, res) => {
                            changeBtn.set_sensitive(true);
                            try {
                                const [ok, stdout] = p.communicate_utf8_finish(res);
                                if (ok && stdout && stdout.includes('SET_LOGO_OK:')) {
                                    const dest = stdout.split('SET_LOGO_OK:')[1].trim().split('\n')[0];
                                    prefSettings.set_string('greeter-logo-path', dest);
                                }
                            } catch (_err) {}
                            updateLogoDisplay();
                        });
                    } catch (_e) {
                        changeBtn.set_sensitive(true);
                        updateLogoDisplay();
                    }
                }
            }
            chooser.destroy();
        });
        chooser.show();
    });

    resetBtn.connect('clicked', () => {
        changeBtn.set_sensitive(false);
        resetBtn.set_sensitive(false);
        try {
            const proc = new Gio.Subprocess({
                argv: ['pkexec', HELPER_PATH, 'reset-logo'],
                flags: Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_MERGE,
            });
            proc.init(null);
            proc.communicate_utf8_async(null, null, (p, res) => {
                changeBtn.set_sensitive(true);
                try {
                    const [ok, stdout] = p.communicate_utf8_finish(res);
                    if (ok && stdout && stdout.includes('RESET_LOGO_OK')) {
                        prefSettings.set_string('greeter-logo-path', '');
                    }
                } catch (_err) {}
                updateLogoDisplay();
            });
        } catch (_e) {
            changeBtn.set_sensitive(true);
            updateLogoDisplay();
        }
    });
}
