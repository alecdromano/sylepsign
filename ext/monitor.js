import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

const GDM_BUS = 'org.gnome.DisplayManager';
const GDM_FACTORY_PATH = '/org/gnome/DisplayManager/LocalDisplayFactory';
const GDM_FACTORY_IFACE = 'org.gnome.DisplayManager.LocalDisplayFactory';

export class Monitor {
    constructor(cfg = {}, player = null) {
        this.cfg = cfg;
        this.player = player;
        this.idleWatchId = 0;
        this.userActiveWatchId = 0;
        this.lockedChangedId = 0;
        this.switchInFlight = false;
        this.coreMonitor = null;
    }

    enable() {
        if (Main.sessionMode?.isGreeter) {
            this.player?.start();
            return;
        }

        this.coreMonitor = global.backend?.get_core_idle_monitor?.() || null;
        if (this.coreMonitor) {
            this.armIdleWatch();
        }

        if (Main.screenShield && !this.lockedChangedId) {
            this.lockedChangedId = Main.screenShield.connect('locked-changed', () => {
                if (Main.screenShield.locked) {
                    this.switchToGreeter();
                } else {
                    this.switchInFlight = false;
                    this.armIdleWatch();
                }
            });
        }
    }

    disable() {
        if (this.coreMonitor) {
            if (this.idleWatchId) {
                try { this.coreMonitor.remove_watch(this.idleWatchId); } catch (e) {}
                this.idleWatchId = 0;
            }
            if (this.userActiveWatchId) {
                try { this.coreMonitor.remove_watch(this.userActiveWatchId); } catch (e) {}
                this.userActiveWatchId = 0;
            }
            this.coreMonitor = null;
        }

        if (this.lockedChangedId && Main.screenShield) {
            try { Main.screenShield.disconnect(this.lockedChangedId); } catch (e) {}
            this.lockedChangedId = 0;
        }

        this.switchInFlight = false;
    }

    armIdleWatch() {
        if (!this.coreMonitor || this.idleWatchId) return;

        const minutes = this.cfg.idle_minutes || 5;
        const idleMs = Math.max(1000, minutes * 60 * 1000);

        try {
            this.idleWatchId = this.coreMonitor.add_idle_watch(idleMs, (_m, id) => {
                this.onIdleFired(id);
            });
        } catch (e) {}
    }

    onIdleFired(id) {
        if (id !== this.idleWatchId) return;
        this.idleWatchId = 0;

        if (Main.screenShield) {
            try { Main.screenShield.lock(true); } catch (e) {}
        }

        this.switchToGreeter();

        if (this.coreMonitor && !this.userActiveWatchId) {
            try {
                this.userActiveWatchId = this.coreMonitor.add_user_active_watch((_m, actId) => {
                    this.onUserActive(actId);
                });
            } catch (e) {}
        }
    }

    onUserActive(actId) {
        if (actId !== this.userActiveWatchId) return;
        if (this.coreMonitor && this.userActiveWatchId) {
            try { this.coreMonitor.remove_watch(this.userActiveWatchId); } catch (e) {}
            this.userActiveWatchId = 0;
        }
        this.switchInFlight = false;
        this.armIdleWatch();
    }

    switchToGreeter() {
        if (this.switchInFlight) return;
        this.switchInFlight = true;
        this.requestTransientDisplay(3);
    }

    requestTransientDisplay(retries) {
        Gio.DBus.system.call(
            GDM_BUS,
            GDM_FACTORY_PATH,
            GDM_FACTORY_IFACE,
            'CreateTransientDisplay',
            null,
            null,
            Gio.DBusCallFlags.NONE,
            5000,
            null,
            (conn, res) => {
                try {
                    conn.call_finish(res);
                } catch (e) {
                    if (retries > 1) {
                        GLib.timeout_add(GLib.PRIORITY_DEFAULT, 300, () => {
                            this.requestTransientDisplay(retries - 1);
                            return GLib.SOURCE_REMOVE;
                        });
                        return;
                    }
                }
                this.switchInFlight = false;
            }
        );
    }
}
