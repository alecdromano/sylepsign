import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';

import { Inhibitor } from './inhibitor.js';
import { Injector } from './injector.js';
import { Fader } from './fader.js';
import { Player } from './player.js';
import { Monitor } from './monitor.js';
import { DaemonClient } from './client.js';

export default class SylepsignExtension extends Extension {
    enable() {
        this.settings = this.getSettings('org.gnome.shell.extensions.sylepsign');
        this.client = new DaemonClient();
        this.inhibitor = new Inhibitor();

        const cfg = this.readConfig();
        this.injector = new Injector(this.inhibitor, cfg);
        this.fader = new Fader(cfg);
        this.player = new Player(cfg);
        this.monitor = new Monitor(cfg, this.player);

        this.settingsChangedId = this.settings.connect('changed', () => {
            const updated = this.readConfig();
            this.injector.cfg = updated;
            this.player.cfg = updated;
            this.syncState();
        });

        this.mapId = global.window_manager.connect('map', (_wm, windowActor) => {
            this.inspectWindow(windowActor);
        });

        this.modeChangedId = Main.sessionMode?.connect('updated', () => {
            this.syncState();
            this.injector.mountForCurrentMode();
        });

        this.syncState();
        this.sweepWindows();
    }

    disable() {
        if (this.mapId) {
            global.window_manager.disconnect(this.mapId);
            this.mapId = 0;
        }

        if (this.modeChangedId) {
            try { Main.sessionMode?.disconnect(this.modeChangedId); } catch (e) {}
            this.modeChangedId = 0;
        }

        if (this.settingsChangedId && this.settings) {
            try { this.settings.disconnect(this.settingsChangedId); } catch (e) {}
            this.settingsChangedId = 0;
        }
        this.settings = null;

        this.monitor?.disable();
        this.monitor = null;

        this.player?.stop();
        this.player = null;

        this.fader?.disable();
        this.fader = null;

        this.injector?.releaseAll();
        this.injector = null;
        this.inhibitor = null;
        this.client = null;
    }

    syncState() {
        const isMaster = this.settings?.get_boolean('enabled') ?? true;
        if (!isMaster) {
            this.player?.stop();
            this.monitor?.disable();
            this.fader?.disable();
            return;
        }

        const isGreeter = Boolean(Main.sessionMode?.isGreeter);
        if (isGreeter) {
            const enableGdm = this.settings?.get_boolean('enable-gdm-signage') ?? true;
            if (enableGdm) {
                this.fader?.enable();
                this.monitor?.enable();
                this.player?.start();
            } else {
                this.fader?.disable();
                this.player?.stop();
            }
        } else {
            this.fader?.disable();
            const enableLock = this.settings?.get_boolean('enable-user-lockscreen') ?? true;
            if (isMaster && enableLock) {
                this.monitor?.enable();
            } else {
                this.monitor?.disable();
                this.player?.stop();
            }
        }
    }

    inspectWindow(windowActor) {
        const mw = windowActor?.get_meta_window?.();
        if (!mw) return;
        const title = mw.get_title?.() || '';
        const wmClass = mw.get_wm_class?.() || '';
        if (title.includes('fleet-signage') || wmClass.includes('fleet-signage') || wmClass.toLowerCase().includes('mpv')) {
            this.injector.liftAbove(windowActor);
        }
    }

    sweepWindows() {
        const actors = global.get_window_actors?.() || [];
        for (const actor of actors) {
            this.inspectWindow(actor);
        }
    }

    readConfig() {
        if (!this.settings) return {};
        return {
            enabled: this.settings.get_boolean('enabled'),
            enable_gdm: this.settings.get_boolean('enable-gdm-signage'),
            enable_lockscreen: this.settings.get_boolean('enable-user-lockscreen'),
            order: this.settings.get_string('playback-order'),
            playback_speed: this.settings.get_double('playback-speed'),
            vo: this.settings.get_string('vo-driver'),
            hwdec: this.settings.get_string('hwdec-mode'),
            fit: this.settings.get_string('video-fit'),
            multi_monitor: this.settings.get_string('multi-monitor-mode'),
            idle_minutes: this.settings.get_int('minutes-after-idle'),
            chrome_fade_seconds: this.settings.get_int('chrome-fade-idle-seconds'),
            chrome_fade_duration_ms: this.settings.get_int('chrome-fade-duration-ms'),
            chrome_fade_min_opacity: this.settings.get_int('chrome-fade-min-opacity'),
            dim_alpha: this.settings.get_int('dim-alpha'),
            dim_color: this.settings.get_string('dim-color'),
        };
    }
}
