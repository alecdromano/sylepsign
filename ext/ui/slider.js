import Adw from 'gi://Adw';
import Gtk from 'gi://Gtk';
import { _, escapeMarkup } from './translate.js';

export function createSliderRow(spec, settings, staging = null, isStaged = null) {
    const initialVal = spec.key ? settings.get_int(spec.key) : (spec.min ?? 0);
    const adjustment = new Gtk.Adjustment({
        lower: spec.min ?? 0,
        upper: spec.max ?? 100,
        step_increment: spec.step ?? 1,
        page_increment: spec.page ?? (spec.step ? spec.step * 2 : 10),
        value: initialVal,
    });

    const scale = new Gtk.Scale({
        orientation: Gtk.Orientation.HORIZONTAL,
        adjustment,
        draw_value: true,
        value_pos: Gtk.PositionType.RIGHT,
        valign: Gtk.Align.CENTER,
    });
    scale.set_size_request(180, -1);

    const unit = spec.unit || '';
    scale.set_format_value_func((_s, val) => {
        const rounded = Math.round(val);
        if (unit === '%') return `${rounded}%`;
        if (unit) return `${rounded} ${unit}`;
        return `${rounded}`;
    });

    if (spec.stepped) {
        const step = spec.step || 1;
        const markStep = spec.mark_step || step;
        const min = spec.min ?? 0;
        const max = spec.max ?? 100;
        for (let v = min; v <= max; v += markStep) {
            scale.add_mark(v, Gtk.PositionType.BOTTOM, null);
        }
        scale.connect('change-value', (_s, _scroll, val) => {
            const snapped = Math.round((val - min) / step) * step + min;
            scale.set_value(Math.min(max, Math.max(min, snapped)));
            return true;
        });
    }

    const rowProps = { title: _(spec.title) };
    if (spec.subtitle) rowProps.subtitle = _(spec.subtitle);
    const row = new Adw.ActionRow(rowProps);
    row.add_suffix(scale);
    row.set_activatable_widget(scale);

    const isKeyStaged = Boolean(isStaged && isStaged(spec.key, staging));

    if (isKeyStaged) {
        staging.registerControl(
            spec.key,
            row,
            () => Math.round(scale.get_value()),
            (v) => scale.set_value(Number(v))
        );
        scale.connect('value-changed', () => staging.onControlChanged(spec.key));
    } else if (spec.key) {
        scale.connect('value-changed', () => {
            settings.set_int(spec.key, Math.round(scale.get_value()));
        });
    }

    return [row];
}
