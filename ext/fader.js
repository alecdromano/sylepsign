import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

const IDLE_MONITOR_BUS = 'org.gnome.Mutter.IdleMonitor';
const IDLE_MONITOR_PATH = '/org/gnome/Mutter/IdleMonitor/Core';
const IDLE_MONITOR_IFACE = 'org.gnome.Mutter.IdleMonitor';
const FADE_FRAME_MS = 16;

function hexToRgba(hex, alpha) {
    let clean = (hex || '#000000').replace('#', '').trim();
    if (clean.length === 3) {
        clean = clean.split('').map(c => c + c).join('');
    }
    const num = parseInt(clean, 16) || 0;
    const r = (num >> 16) & 255;
    const g = (num >> 8) & 255;
    const b = num & 255;
    return `rgba(${r}, ${g}, ${b}, ${alpha.toFixed(2)})`;
}

export class Fader {
    constructor(cfg = {}) {
        this.idleMs = (cfg.chrome_fade_seconds || 30) * 1000;
        this.fadeMs = cfg.chrome_fade_duration_ms || 800;
        this.dimAlpha = (cfg.dim_alpha ?? 50) / 100;
        this.dimColor = cfg.dim_color || '#000000';
        this.minOpacity = Math.round(((cfg.chrome_fade_min_opacity || 0) / 100) * 255);
        this.proxy = null;
        this.pollId = 0;
        this.initSnapId = 0;
        this.dimOverlay = null;
        this.animations = new Map();
        this.faded = false;
        this.callInFlight = false;
    }

    enable() {
        if (!Main.sessionMode?.isGreeter) return;

        try {
            this.proxy = new Gio.DBusProxy({
                g_connection: Gio.DBus.session,
                g_interface_name: IDLE_MONITOR_IFACE,
                g_name: IDLE_MONITOR_BUS,
                g_object_path: IDLE_MONITOR_PATH,
                g_flags: Gio.DBusProxyFlags.DO_NOT_AUTO_START,
            });
            this.proxy.init_async(GLib.PRIORITY_DEFAULT, null, (p, res) => {
                try { p.init_finish(res); } catch (e) { this.proxy = null; }
            });
        } catch (e) {
            this.proxy = null;
            return;
        }

        this.pollId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 500, () => {
            this.poll();
            return GLib.SOURCE_CONTINUE;
        });

        this.ensureDimOverlay();
        this.snapToVisible();
    }

    disable() {
        if (this.pollId) {
            GLib.source_remove(this.pollId);
            this.pollId = 0;
        }
        if (this.initSnapId) {
            GLib.source_remove(this.initSnapId);
            this.initSnapId = 0;
        }
        for (const state of this.animations.values()) {
            if (state.timeoutId) {
                try { GLib.source_remove(state.timeoutId); } catch (_e) {}
            }
        }
        this.animations.clear();
        if (!global.is_closing) {
            for (const actor of this.getChromeActors()) {
                try { if (actor) actor.opacity = 255; } catch (_e) {}
            }
            if (this.dimOverlay) {
                try {
                    this.dimOverlay.get_parent()?.remove_child(this.dimOverlay);
                    this.dimOverlay.destroy();
                } catch (_e) {}
            }
        }
        this.dimOverlay = null;
        this.proxy = null;
    }

    snapToVisible() {
        const apply = () => {
            for (const actor of this.getChromeActors()) {
                try { actor.opacity = 255; } catch (_e) {}
            }
        };
        apply();
        let count = 0;
        this.initSnapId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 100, () => {
            apply();
            count++;
            return count < 40 ? GLib.SOURCE_CONTINUE : GLib.SOURCE_REMOVE;
        });
    }

    ensureDimOverlay() {
        const shield = Main.layoutManager?.screenShieldGroup;
        if (!shield) return;

        if (!this.dimOverlay) {
            this.dimOverlay = new St.Widget({
                style_class: 'sylepsign-fader-dimmer',
                reactive: false,
                x: 0,
                y: 0,
                width: global.stage?.width || 1920,
                height: global.stage?.height || 1080,
            });
        }
        this.dimOverlay.set_style(`background-color: ${hexToRgba(this.dimColor, this.dimAlpha)};`);

        const parent = this.dimOverlay.get_parent();
        if (!parent) shield.add_child(this.dimOverlay);
        const lockDialog = shield.get_children().find(c => c.name === 'lockDialogGroup');
        if (lockDialog) shield.set_child_below_sibling(this.dimOverlay, lockDialog);
    }

    getChromeActors() {
        const actors = [];
        if (this.dimOverlay) actors.push(this.dimOverlay);
        if (!this.dialog)
            this.dialog = Main.screenShield?._dialog ?? Main.screenShield?._loginDialog ?? null;
        if (this.dialog) actors.push(this.dialog);
        const shield = Main.layoutManager?.screenShieldGroup;
        const lockDialog = shield?.get_children().find(c => c.name === 'lockDialogGroup');
        if (lockDialog) actors.push(lockDialog);
        const panelActor = Main.panel?.actor ?? Main.panel ?? null;
        if (panelActor) actors.push(panelActor);
        return [...new Set(actors.filter(Boolean))];
    }

    poll() {
        if (!this.proxy || this.callInFlight) return;
        this.callInFlight = true;
        this.proxy.call(
            'GetIdletime',
            null,
            Gio.DBusCallFlags.NONE,
            -1,
            null,
            (p, res) => {
                this.callInFlight = false;
                try {
                    const variant = p.call_finish(res);
                    const [idleTimeMs] = variant.deep_unpack();
                    const shouldFade = idleTimeMs >= this.idleMs;
                    if (shouldFade !== this.faded) {
                        this.faded = shouldFade;
                        this.animateFade(shouldFade ? this.minOpacity : 255);
                    }
                } catch (e) {
                    // poll error
                }
            }
        );
    }

    animateFade(targetOpacity) {
        for (const actor of this.getChromeActors()) {
            this.animateActor(actor, targetOpacity);
        }
    }

    animateActor(actor, target) {
        if (!actor) return;
        const current = actor.opacity;
        if (current === target) return;

        const start = GLib.get_monotonic_time();
        const durationUs = this.fadeMs * 1000;

        const step = () => {
            const now = GLib.get_monotonic_time();
            const elapsed = now - start;
            const progress = Math.min(1, elapsed / durationUs);
            actor.opacity = Math.round(current + (target - current) * progress);

            if (progress < 1) {
                return GLib.SOURCE_CONTINUE;
            }
            this.animations.delete(actor);
            return GLib.SOURCE_REMOVE;
        };

        const existing = this.animations.get(actor);
        if (existing?.timeoutId) GLib.source_remove(existing.timeoutId);

        const timeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, FADE_FRAME_MS, step);
        this.animations.set(actor, { timeoutId });
    }
}
