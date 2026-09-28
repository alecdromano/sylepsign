import Gtk from 'gi://Gtk';
import { _ } from './translate.js';

export class ChangeNotice {
    constructor() {
        this.revealer = new Gtk.Revealer({
            transition_type: Gtk.RevealerTransitionType.SLIDE_UP,
            reveal_child: false,
            visible: false,
            valign: Gtk.Align.END,
            halign: Gtk.Align.CENTER,
            margin_bottom: 24,
        });

        this.revealer.connect('notify::child-revealed', () => {
            if (!this.revealer.get_reveal_child()) {
                this.revealer.set_visible(false);
            }
        });

        const box = new Gtk.Box({
            orientation: Gtk.Orientation.HORIZONTAL,
            spacing: 16,
            margin_top: 8,
            margin_bottom: 8,
            margin_start: 16,
            margin_end: 16,
        });
        box.add_css_class('card');
        box.add_css_class('app-notification');

        const icon = new Gtk.Image({
            icon_name: 'dialog-information-symbolic',
            pixel_size: 20,
            margin_start: 4,
        });

        const label = new Gtk.Label({
            label: _('Changes need to be applied'),
            hexpand: true,
            xalign: 0,
            margin_top: 8,
            margin_bottom: 8,
        });
        label.add_css_class('title-4');

        this.cancelBtn = new Gtk.Button({
            label: _('_Cancel'),
            use_underline: true,
            valign: Gtk.Align.CENTER,
            margin_end: 4,
        });
        this.cancelBtn.add_css_class('flat');

        this.applyBtn = new Gtk.Button({
            label: _('_Apply'),
            use_underline: true,
            valign: Gtk.Align.CENTER,
            margin_end: 12,
        });
        this.applyBtn.add_css_class('suggested-action');

        box.append(icon);
        box.append(label);
        box.append(this.cancelBtn);
        box.append(this.applyBtn);

        this.revealer.set_child(box);
    }

    get widget() {
        return this.revealer;
    }

    reveal() {
        this.revealer.set_visible(true);
        this.revealer.set_reveal_child(true);
    }

    dismiss() {
        this.revealer.set_reveal_child(false);
    }

    setLoading(isLoading) {
        this.applyBtn.set_sensitive(!isLoading);
        this.cancelBtn.set_sensitive(!isLoading);
        this.applyBtn.set_label(isLoading ? _('Applying…') : _('_Apply'));
    }

    onApply(callback) {
        this.applyBtn.connect('clicked', () => callback?.());
    }

    onCancel(callback) {
        this.cancelBtn.connect('clicked', () => callback?.());
    }

    bindWindowKeys(win) {
        if (!win?.add_controller) return;
        const controller = new Gtk.EventControllerKey();
        controller.connect('key-pressed', (_c, keyval, _keycode, state) => {
            if (!this.revealer.get_reveal_child()) return false;
            // Escape key (0xff1b) -> cancel
            if (keyval === 0xff1b) {
                this.cancelBtn.emit('clicked');
                return true;
            }
            // Ctrl+Enter (0xff0d / 0xff8d) -> apply
            const isCtrl = (state & 0x4) !== 0;
            if (isCtrl && (keyval === 0xff0d || keyval === 0xff8d)) {
                this.applyBtn.emit('clicked');
                return true;
            }
            return false;
        });
        win.add_controller(controller);
    }
}
