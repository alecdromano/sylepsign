import Adw from 'gi://Adw';
import Gtk from 'gi://Gtk';
import { _, escapeMarkup } from './translate.js';
import { bindSessionLockRow } from './session.js';
import { createSliderRow } from './slider.js';
import { createColorRow } from './color.js';

const UNSTAGED_KEYS = new Set([
    'enable-user-lockscreen',
    'minutes-after-idle',
    'greeter-logo-path',
]);

function isStaged(key, staging) {
    return Boolean(staging && key && !UNSTAGED_KEYS.has(key));
}

function makeRowProps(spec) {
    const props = { title: _(spec.title) };
    if (spec.subtitle) props.subtitle = _(spec.subtitle);
    return props;
}

export function createSwitchRow(spec, settings, staging = null) {
    const row = new Adw.SwitchRow(makeRowProps(spec));
    if (spec.key === 'enable-user-lockscreen') {
        bindSessionLockRow(row, settings, staging);
    } else if (isStaged(spec.key, staging)) {
        staging.registerControl(spec.key, row, () => row.get_active(), (v) => row.set_active(Boolean(v)));
        row.connect('notify::active', () => staging.onControlChanged(spec.key));
    } else if (spec.key) {
        settings.bind(spec.key, row, 'active', 0);
    }
    return [row];
}

export function createSpinRow(spec, settings, staging = null) {
    const initialVal = spec.key ? settings.get_int(spec.key) : (spec.min ?? 0);
    const adjustment = new Gtk.Adjustment({
        lower: spec.min ?? 0,
        upper: spec.max ?? 100,
        step_increment: spec.step ?? 1,
        page_increment: spec.page ?? 10,
        value: initialVal,
    });

    const row = new Adw.SpinRow({
        ...makeRowProps(spec),
        adjustment,
    });

    if (isStaged(spec.key, staging)) {
        staging.registerControl(spec.key, row, () => row.get_value(), (v) => row.set_value(Number(v)));
        row.connect('notify::value', () => staging.onControlChanged(spec.key));
    } else if (spec.key) {
        row.connect('notify::value', () => settings.set_int(spec.key, row.get_value()));
    }
    return [row];
}

export function createComboRow(spec, settings, staging = null) {
    const model = new Gtk.StringList();
    const isDouble = spec.value_type === 'double';
    const curVal = isDouble ? settings.get_double(spec.key) : settings.get_string(spec.key);

    let selectedIdx = 0;
    (spec.options || []).forEach((opt, idx) => {
        model.append(_(opt.label));
        const matches = isDouble ? Math.abs(opt.value - curVal) < 0.001 : opt.value === curVal;
        if (matches) selectedIdx = idx;
    });

    const row = new Adw.ComboRow({
        ...makeRowProps(spec),
        model,
        selected: selectedIdx,
    });

    if (isStaged(spec.key, staging)) {
        staging.registerControl(
            spec.key,
            row,
            () => {
                const opt = (spec.options || [])[row.selected];
                return isDouble ? Number(opt?.value ?? 1.0) : String(opt?.value ?? '');
            },
            (val) => {
                const idx = (spec.options || []).findIndex(opt =>
                    isDouble ? Math.abs(opt.value - val) < 0.001 : opt.value === val
                );
                if (idx !== -1) row.set_selected(idx);
            }
        );
        row.connect('notify::selected', () => staging.onControlChanged(spec.key));
    } else if (spec.key) {
        row.connect('notify::selected', () => {
            const opt = (spec.options || [])[row.selected];
            if (!opt) return;
            if (isDouble) settings.set_double(spec.key, Number(opt.value));
            else settings.set_string(spec.key, String(opt.value));
        });
    }
    return [row];
}

export function createEntryRow(spec, settings, staging = null) {
    const row = new Adw.EntryRow({
        ...makeRowProps(spec),
        text: spec.key ? settings.get_string(spec.key) : '',
    });
    if (isStaged(spec.key, staging)) {
        staging.registerControl(spec.key, row, () => row.get_text(), (v) => row.set_text(String(v || '')));
        row.connect('notify::text', () => staging.onControlChanged(spec.key));
    } else if (spec.key) {
        row.connect('notify::text', () => settings.set_string(spec.key, row.get_text()));
    }
    return [row];
}

export function createActionRow(spec, dynamicRefs) {
    const row = new Adw.ActionRow(makeRowProps(spec));
    if (spec.action_id && dynamicRefs) dynamicRefs.set(spec.action_id, { row });
    return [row];
}

export function createButtonRow(spec, dynamicRefs) {
    const btn = new Gtk.Button({
        label: _(spec.button_label),
        valign: Gtk.Align.CENTER,
    });

    if (Array.isArray(spec.button_css)) {
        for (const cssClass of spec.button_css) btn.add_css_class(cssClass);
    }

    const row = new Adw.ActionRow(makeRowProps(spec));
    row.add_suffix(btn);

    if (spec.action_id && dynamicRefs) {
        dynamicRefs.set(spec.action_id, { row, btn, spec });
    }
    return [row];
}

export function createRow(spec, settings, dynamicRefs, staging = null) {
    switch (spec.type) {
        case 'switch': return createSwitchRow(spec, settings, staging);
        case 'slider': return createSliderRow(spec, settings, staging, isStaged);
        case 'spin': return createSpinRow(spec, settings, staging);
        case 'combo': return createComboRow(spec, settings, staging);
        case 'entry': return createEntryRow(spec, settings, staging);
        case 'color': return createColorRow(spec, settings, staging, isStaged);
        case 'action': return createActionRow(spec, dynamicRefs);
        case 'button': return createButtonRow(spec, dynamicRefs);
        default: return [];
    }
}
