import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Gtk from 'gi://Gtk';
import { _, escapeMarkup, formatString } from './translate.js';
import {
    POOL_DIR,
    HELPER_PATH,
    VIDEO_EXTS,
    formatBytes,
    createPoolModel,
    createPoolColumnView,
    createEmptyCard,
    getSelectedFileNames,
    getPoolSummary,
} from './pool.js';

export function wireMedia(client, dynamicRefs, groupsMap, messages = {}) {
    const filesGroup = groupsMap.get('pool_files');
    const uncacheRef = dynamicRefs.get('uncache');
    const meshRef = dynamicRefs.get('mesh_status');

    if (meshRef) {
        client?.getStatus((status, err) => {
            if (!err && status) {
                const msg = status.peers === 1 ? messages.mesh_peer_single : messages.mesh_peer_multi;
                const text = formatString(_(msg), { port: status.port, peers: status.peers });
                meshRef.row.set_subtitle(escapeMarkup(text));
            }
        });
    }

    if (!filesGroup) return;

    const toolbar = new Gtk.Box({
        orientation: Gtk.Orientation.HORIZONTAL,
        spacing: 8,
        margin_bottom: 8,
        hexpand: true,
    });

    const statusLabel = new Gtk.Label({
        label: _('Scanning pool…'),
        xalign: 0,
        hexpand: true,
    });
    statusLabel.add_css_class('dim-label');
    statusLabel.add_css_class('caption');

    const openBtn = new Gtk.Button({
        icon_name: 'folder-open-symbolic',
        tooltip_text: _('Open media folder in file manager'),
        valign: Gtk.Align.CENTER,
    });
    openBtn.add_css_class('flat');

    const addBtn = new Gtk.Button({
        label: _('Add Videos…'),
        icon_name: 'list-add-symbolic',
        valign: Gtk.Align.CENTER,
    });
    addBtn.add_css_class('suggested-action');

    const deleteBtn = new Gtk.Button({
        label: _('Delete'),
        icon_name: 'user-trash-symbolic',
        valign: Gtk.Align.CENTER,
        sensitive: false,
    });
    deleteBtn.add_css_class('destructive-action');

    toolbar.append(statusLabel);
    toolbar.append(openBtn);
    toolbar.append(addBtn);
    toolbar.append(deleteBtn);
    filesGroup.add(toolbar);

    const { dirList, filtered, selection } = createPoolModel();
    const columnView = createPoolColumnView(selection);

    const scroll = new Gtk.ScrolledWindow({
        hscrollbar_policy: Gtk.PolicyType.NEVER,
        vscrollbar_policy: Gtk.PolicyType.AUTOMATIC,
        min_content_height: 140,
        max_content_height: 220,
        propagate_natural_height: false,
    });
    scroll.add_css_class('card');
    scroll.set_child(columnView);

    const stack = new Gtk.Stack({
        transition_type: Gtk.StackTransitionType.CROSSFADE,
    });
    stack.add_named(scroll, 'list');
    stack.add_named(createEmptyCard(), 'empty');
    filesGroup.add(stack);

    const updatePoolStatus = () => {
        const { count, totalBytes } = getPoolSummary(filtered);
        statusLabel.set_label(formatString(_('{count} video(s) in pool ({size})'), {
            count,
            size: formatBytes(totalBytes),
        }));
        stack.set_visible_child_name(count === 0 ? 'empty' : 'list');
    };

    const updateDeleteButton = () => {
        const count = selection.get_selection().get_size();
        if (count === 0) {
            deleteBtn.set_sensitive(false);
            deleteBtn.set_label(_('Delete'));
        } else {
            deleteBtn.set_sensitive(true);
            deleteBtn.set_label(formatString(_('Delete ({count})'), { count }));
        }
    };

    selection.connect('selection-changed', updateDeleteButton);
    filtered.connect('items-changed', () => {
        updatePoolStatus();
        updateDeleteButton();
    });
    dirList.connect('notify::loading', () => {
        if (!dirList.loading) {
            updatePoolStatus();
            updateDeleteButton();
        }
    });

    const keyCtrl = new Gtk.EventControllerKey();
    keyCtrl.connect('key-pressed', (_c, keyval) => {
        if (keyval === 0xffff && deleteBtn.get_sensitive()) {
            deleteBtn.emit('clicked');
            return true;
        }
        return false;
    });
    columnView.add_controller(keyCtrl);

    const reloadPool = () => {
        dirList.set_file(Gio.File.new_for_path(POOL_DIR));
    };

    openBtn.connect('clicked', () => {
        try {
            GLib.mkdir_with_parents(POOL_DIR, 0o755);
            const f = Gio.File.new_for_path(POOL_DIR);
            Gio.AppInfo.launch_default_for_uri(f.get_uri(), null);
        } catch (_e) {}
    });

    addBtn.connect('clicked', () => {
        const win = addBtn.get_root?.() || null;
        const chooser = new Gtk.FileChooserNative({
            title: _('Select Videos to Add to Pool'),
            transient_for: win,
            action: Gtk.FileChooserAction.OPEN,
            accept_label: _('Add to Pool'),
            cancel_label: _('Cancel'),
        });
        chooser.set_select_multiple(true);

        const filter = new Gtk.FileFilter();
        filter.set_name(_('Video Files (*.mp4, *.mkv, *.webm, *.mov, *.m4v)'));
        for (const ext of VIDEO_EXTS) filter.add_pattern(`*${ext}`);
        chooser.add_filter(filter);

        chooser.connect('response', (_dlg, responseId) => {
            if (responseId === Gtk.ResponseType.ACCEPT) {
                const files = chooser.get_files();
                const paths = [];
                for (let i = 0; i < files.get_n_items(); i++) {
                    paths.push(files.get_item(i).get_path());
                }
                if (paths.length > 0) {
                    try {
                        const proc = new Gio.Subprocess({
                            argv: ['pkexec', HELPER_PATH, 'add-to-pool', ...paths],
                            flags: Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_MERGE,
                        });
                        proc.init(null);
                        proc.communicate_utf8_async(null, null, () => reloadPool());
                    } catch (_e) {}
                }
            }
            chooser.destroy();
        });
        chooser.show();
    });

    deleteBtn.connect('clicked', () => {
        const names = getSelectedFileNames(selection);
        if (names.length === 0) return;

        deleteBtn.set_sensitive(false);
        deleteBtn.set_label(_('Deleting…'));
        try {
            const proc = new Gio.Subprocess({
                argv: ['pkexec', HELPER_PATH, 'remove-from-pool', ...names],
                flags: Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_MERGE,
            });
            proc.init(null);
            proc.communicate_utf8_async(null, null, () => reloadPool());
        } catch (_e) {
            updateDeleteButton();
        }
    });

    if (uncacheRef?.btn) {
        const spec = uncacheRef.spec;
        uncacheRef.btn.connect('clicked', () => {
            uncacheRef.btn.set_sensitive(false);
            uncacheRef.btn.set_label(_(spec.loading_label));
            client?.uncache((res, err) => {
                uncacheRef.btn.set_sensitive(true);
                if (!err && res?.success) {
                    uncacheRef.btn.set_label(_(spec.success_label));
                    uncacheRef.row.set_subtitle(escapeMarkup(formatString(_(messages.uncache_cleared), { count: res.cleared })));
                } else {
                    uncacheRef.btn.set_label(_(spec.failure_label));
                }
            });
        });
    }
}
