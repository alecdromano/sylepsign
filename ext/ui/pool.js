import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Gtk from 'gi://Gtk';
import Pango from 'gi://Pango';
import { _ } from './translate.js';

export const POOL_DIR = '/var/lib/signage-pool';
export const HELPER_PATH = '/usr/local/share/sylepsign/helper';
export const VIDEO_EXTS = new Set(['.mp4', '.mkv', '.webm', '.mov', '.m4v']);

export function formatBytes(bytes) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1073741824) return `${(bytes / 1048576).toFixed(1)} MB`;
    return `${(bytes / 1073741824).toFixed(2)} GB`;
}

export function createPoolModel() {
    try {
        GLib.mkdir_with_parents(POOL_DIR, 0o755);
    } catch (_e) {}

    const dirList = new Gtk.DirectoryList({
        file: Gio.File.new_for_path(POOL_DIR),
        attributes: 'standard::name,standard::display-name,standard::size,standard::icon',
        monitored: true,
    });

    const filter = new Gtk.CustomFilter();
    filter.set_filter_func(item => {
        if (!item) return false;
        const name = item.get_name();
        if (!name || name.startsWith('.')) return false;
        const dot = name.lastIndexOf('.');
        return dot !== -1 && VIDEO_EXTS.has(name.slice(dot).toLowerCase());
    });

    const filtered = new Gtk.FilterListModel({
        model: dirList,
        filter: filter,
    });

    const selection = new Gtk.MultiSelection({
        model: filtered,
    });

    return { dirList, filtered, selection };
}

export function createPoolColumnView(selection) {
    const cv = new Gtk.ColumnView({
        model: selection,
        show_row_separators: true,
        enable_rubberband: true,
        focusable: true,
        can_focus: true,
    });

    const nameFac = new Gtk.SignalListItemFactory();
    nameFac.connect('setup', (_f, item) => {
        const box = new Gtk.Box({
            orientation: Gtk.Orientation.HORIZONTAL,
            spacing: 8,
            margin_start: 6,
            margin_end: 6,
            margin_top: 4,
            margin_bottom: 4,
        });
        const icon = Gtk.Image.new_from_icon_name('video-x-generic-symbolic');
        icon.set_pixel_size(16);
        icon.add_css_class('dim-label');
        const label = new Gtk.Label({
            xalign: 0,
            hexpand: true,
            ellipsize: Pango.EllipsizeMode.MIDDLE,
        });
        box.append(icon);
        box.append(label);
        item.set_child(box);
    });
    nameFac.connect('bind', (_f, item) => {
        const info = item.get_item();
        const box = item.get_child();
        box.get_last_child().set_label(info ? info.get_name() : '');
    });
    cv.append_column(new Gtk.ColumnViewColumn({
        title: _('File Name'),
        factory: nameFac,
        expand: true,
    }));

    const sizeFac = new Gtk.SignalListItemFactory();
    sizeFac.connect('setup', (_f, item) => {
        const label = new Gtk.Label({
            xalign: 1,
            margin_end: 8,
            margin_top: 4,
            margin_bottom: 4,
        });
        label.add_css_class('caption');
        label.add_css_class('dim-label');
        item.set_child(label);
    });
    sizeFac.connect('bind', (_f, item) => {
        const info = item.get_item();
        const size = info ? info.get_size() : 0;
        item.get_child().set_label(formatBytes(size));
    });
    cv.append_column(new Gtk.ColumnViewColumn({
        title: _('Size'),
        factory: sizeFac,
        expand: false,
    }));

    return cv;
}

export function createEmptyCard() {
    const box = new Gtk.Box({
        orientation: Gtk.Orientation.VERTICAL,
        spacing: 6,
        valign: Gtk.Align.CENTER,
        halign: Gtk.Align.CENTER,
        margin_top: 24,
        margin_bottom: 24,
    });
    const icon = Gtk.Image.new_from_icon_name('video-x-generic-symbolic');
    icon.set_pixel_size(32);
    icon.add_css_class('dim-label');
    const title = new Gtk.Label({ label: _('No video files in pool') });
    title.add_css_class('title-4');
    const sub = new Gtk.Label({
        label: _('Click "Add Videos…" above to import media into /var/lib/signage-pool'),
    });
    sub.add_css_class('dim-label');
    sub.add_css_class('caption');
    box.append(icon);
    box.append(title);
    box.append(sub);

    const frame = new Gtk.Frame();
    frame.add_css_class('card');
    frame.set_child(box);
    return frame;
}

export function getSelectedFileNames(selection) {
    const model = selection.get_model();
    const n = model ? model.get_n_items() : 0;
    const names = [];
    for (let i = 0; i < n; i++) {
        if (selection.is_selected(i)) {
            const info = model.get_item(i);
            const name = info?.get_name();
            if (name) names.push(name);
        }
    }
    return names;
}

export function getPoolSummary(model) {
    const n = model ? model.get_n_items() : 0;
    let totalBytes = 0;
    for (let i = 0; i < n; i++) {
        const info = model.get_item(i);
        if (info) totalBytes += info.get_size();
    }
    return { count: n, totalBytes };
}
