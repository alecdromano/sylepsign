import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

export class Injector {
    constructor(inhibitor = null, cfg = {}) {
        this.inhibitor = inhibitor;
        this.cfg = cfg;
        this.tracked = new Map();
        this.savedStyles = [];
        this.hiddenActors = [];
        this.chromeMounted = false;
        this.pollId = 0;
        this.pollAttempts = 0;
    }

    liftAbove(windowActor) {
        if (!windowActor || this.tracked.has(windowActor)) return;

        const destroyId = windowActor.connect('destroy', () => this.untrack(windowActor));
        const mw = windowActor.get_meta_window?.();
        let monitorNotifyId = 0;

        if (mw && typeof mw.connect === 'function') {
            try {
                monitorNotifyId = mw.connect('notify::monitor', () => this.repositionClone(windowActor));
            } catch (e) {}
        }

        this.tracked.set(windowActor, {
            destroyId,
            monitorNotifyId,
            metaWindow: mw || null,
            clones: [],
        });

        if (this.tracked.size === 1) {
            this.inhibitor?.acquire();
        }

        this.mountForCurrentMode();
    }

    releaseAll() {
        this.cancelPoll();
        if (global.is_closing) {
            this.tracked.clear();
            this.savedStyles = [];
            this.hiddenActors = [];
            this.inhibitor?.release();
            return;
        }
        for (const [actor, state] of this.tracked) {
            try { if (state.destroyId) actor.disconnect(state.destroyId); } catch (e) {}
            try { if (state.monitorNotifyId && state.metaWindow) state.metaWindow.disconnect(state.monitorNotifyId); } catch (e) {}
            for (const clone of state.clones) {
                try { clone.destroy(); } catch (e) {}
            }
        }
        this.tracked.clear();
        this.teardownChrome();
        this.inhibitor?.release();
    }

    untrack(windowActor) {
        const state = this.tracked.get(windowActor);
        if (!state) return;
        this.tracked.delete(windowActor);
        if (global.is_closing) return;
        try { if (state.destroyId) windowActor.disconnect(state.destroyId); } catch (e) {}
        try { if (state.monitorNotifyId && state.metaWindow) state.metaWindow.disconnect(state.monitorNotifyId); } catch (e) {}
        for (const clone of state.clones) {
            try { clone.destroy(); } catch (e) {}
        }
        if (this.tracked.size === 0) {
            this.teardownChrome();
            this.inhibitor?.release();
        }
    }

    repositionClone(windowActor) {
        const state = this.tracked.get(windowActor);
        if (!state) return;
        const shieldGroup = Main.layoutManager?.screenShieldGroup;
        if (!shieldGroup) return;

        for (const clone of state.clones) {
            try { clone.destroy(); } catch (e) {}
        }
        state.clones = this.addClonesForActor(shieldGroup, windowActor);
    }

    mountForCurrentMode() {
        const isGreeter = Boolean(Main.sessionMode?.isGreeter);
        const mode = Main.sessionMode?.currentMode;
        if (!isGreeter && mode !== 'unlock-dialog') return;

        const shieldGroup = Main.layoutManager?.screenShieldGroup;
        if (!shieldGroup) return;

        for (const [actor, state] of this.tracked) {
            if (state.clones.length > 0) continue;
            state.clones = this.addClonesForActor(shieldGroup, actor);
        }

        if (!this.chromeMounted) {
            this.hideLockScreenGroup(shieldGroup);
            this.ensureChromeTransparent();
            this.chromeMounted = true;
        }
    }

    teardownChrome() {
        if (global.is_closing) {
            this.savedStyles = [];
            this.hiddenActors = [];
            this.chromeMounted = false;
            return;
        }
        for (const [actor, style] of this.savedStyles) {
            try { actor.set_style(style); } catch (e) {}
        }
        this.savedStyles = [];

        for (const [actor, visible] of this.hiddenActors) {
            try { actor.visible = visible; } catch (e) {}
        }
        this.hiddenActors = [];
        this.chromeMounted = false;
    }

    addClonesForActor(shieldGroup, actor) {
        const monitors = Main.layoutManager?.monitors || [];
        if (monitors.length === 0) return [];

        const isMirror = this.cfg.multi_monitor === 'mirror';
        const targetMonitors = isMirror ? monitors : [this.getMonitorForActor(actor)].filter(Boolean);
        const clones = [];

        for (const monitor of targetMonitors) {
            const clone = new Clutter.Clone({
                source: actor,
                reactive: false,
                x: monitor.x,
                y: monitor.y,
                width: monitor.width,
                height: monitor.height,
                opacity: 255,
            });
            shieldGroup.insert_child_at_index(clone, 0);
            clones.push(clone);
        }
        return clones;
    }

    getMonitorForActor(actor) {
        const monitors = Main.layoutManager?.monitors || [];
        let idx = 0;
        for (const key of this.tracked.keys()) {
            if (key === actor) {
                return idx < monitors.length ? monitors[idx] : monitors[0];
            }
            idx++;
        }
        return Main.layoutManager?.primaryMonitor || monitors[0];
    }

    hideLockScreenGroup(shieldGroup) {
        for (const child of shieldGroup.get_children()) {
            if (child.name === 'lockScreenGroup' && child.visible) {
                this.hiddenActors.push([child, child.visible]);
                child.visible = false;
            }
        }
    }

    ensureChromeTransparent() {
        const shieldGroup = Main.layoutManager?.screenShieldGroup;
        if (!shieldGroup) return;

        for (const child of shieldGroup.get_children()) {
            if (child.name === 'lockDialogGroup') {
                this.paintTransparent(child);
            }
        }

        const dialog = Main.screenShield?._dialog;
        if (dialog) {
            this.transparencyFromDialog(dialog);
            return;
        }

        if (this.pollId) return;
        this.pollAttempts = 0;
        this.pollId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 100, () => {
            const d = Main.screenShield?._dialog;
            if (d) {
                this.pollId = 0;
                this.transparencyFromDialog(d);
                return GLib.SOURCE_REMOVE;
            }
            if (++this.pollAttempts >= 80) {
                this.pollId = 0;
                return GLib.SOURCE_REMOVE;
            }
            return GLib.SOURCE_CONTINUE;
        });
    }

    transparencyFromDialog(dialog) {
        if (!dialog) return;
        this.paintTransparent(dialog);
        const actor = dialog._dialogActor || dialog.actor;
        if (actor) this.paintTransparent(actor);
    }

    paintTransparent(actor) {
        if (!actor) return;
        const currentStyle = actor.get_style?.() || null;
        this.savedStyles.push([actor, currentStyle]);
        try {
            actor.set_style('background-color: transparent !important; background-image: none !important;');
        } catch (e) {}
    }

    cancelPoll() {
        if (this.pollId) {
            GLib.source_remove(this.pollId);
            this.pollId = 0;
        }
    }
}
