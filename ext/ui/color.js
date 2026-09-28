import Adw from 'gi://Adw';
import Gdk from 'gi://Gdk';
import Gtk from 'gi://Gtk';
import { _ } from './translate.js';

function rgbaToHex(rgba) {
    const r = Math.round(rgba.red * 255).toString(16).padStart(2, '0');
    const g = Math.round(rgba.green * 255).toString(16).padStart(2, '0');
    const b = Math.round(rgba.blue * 255).toString(16).padStart(2, '0');
    return `#${r}${g}${b}`.toLowerCase();
}

function hexToRgba(hexStr) {
    const rgba = new Gdk.RGBA();
    const str = hexStr && hexStr.trim() ? (hexStr.startsWith('#') ? hexStr : `#${hexStr}`) : '#000000';
    try {
        rgba.parse(str);
    } catch (_e) {
        rgba.parse('#000000');
    }
    return rgba;
}

export function createColorRow(spec, settings, staging = null, isStaged = null) {
    const dialog = new Gtk.ColorDialog({
        with_alpha: false,
        title: _(spec.title),
    });

    const btn = new Gtk.ColorDialogButton({
        dialog,
        valign: Gtk.Align.CENTER,
    });

    const initialHex = (spec.key ? settings.get_string(spec.key) : '#000000') || '#000000';
    btn.set_rgba(hexToRgba(initialHex));

    const rowProps = {
        title: _(spec.title),
        activatable: true,
    };
    if (spec.subtitle) rowProps.subtitle = _(spec.subtitle);
    const row = new Adw.ActionRow(rowProps);
    row.add_suffix(btn);
    row.set_activatable_widget(btn);

    const isKeyStaged = Boolean(isStaged && isStaged(spec.key, staging));

    if (isKeyStaged) {
        staging.registerControl(
            spec.key,
            row,
            () => rgbaToHex(btn.get_rgba()),
            (hexVal) => btn.set_rgba(hexToRgba(hexVal))
        );
        btn.connect('notify::rgba', () => staging.onControlChanged(spec.key));
    } else if (spec.key) {
        btn.connect('notify::rgba', () => {
            settings.set_string(spec.key, rgbaToHex(btn.get_rgba()));
        });
    }

    return [row];
}
