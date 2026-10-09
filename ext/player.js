import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

const VIDEO_EXTENSIONS = new Set(['.mp4', '.mkv', '.webm', '.mov', '.m4v']);
const DEFAULT_POOL_DIR = '/var/lib/signage-pool';
const DEFAULT_CACHE_DIR = '/var/cache/signage-videos';

export class Player {
    constructor(cfg = {}) {
        this.cfg = cfg;
        this.processes = [];
        this.running = false;
        this.stopping = false;
    }

    start() {
        if (this.running || this.stopping) return true;
        const playableFiles = this.getPlayableFiles();
        if (playableFiles.length === 0) return false;

        if (this.cfg.order === 'alphabetical') {
            playableFiles.sort((a, b) => a.localeCompare(b));
        } else if (this.cfg.order === 'random' || this.cfg.order === 'shuffle') {
            for (let i = playableFiles.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                [playableFiles[i], playableFiles[j]] = [playableFiles[j], playableFiles[i]];
            }
        }

        const monitors = this.getMonitors();
        const targetMonitors = this.cfg.multi_monitor === 'mirror' ? [monitors[0]] : monitors;
        const vo = this.resolveVo();
        const hwdec = this.resolveHwdec();
        const fit = this.cfg.fit || 'cover';

        this.running = true;
        this.processes = [];

        const commonArgs = [
            'mpv',
            '--fs',
            '--loop-playlist=inf',
            '--no-osc',
            '--no-osd-bar',
            '--no-input-default-bindings',
            '--stop-screensaver=no',
            '--cursor-autohide=always',
            `--hwdec=${hwdec}`,
            `--vo=${vo}`,
            '--msg-level=all=error',
            '--idle=no',
            '--keep-open=no',
            '--no-config',
            '--force-window=yes',
            '--title=fleet-signage',
            '--no-audio',
            '--audio-device=null',
        ];

        if (fit === 'stretch') {
            commonArgs.push('--keepaspect=no', '--panscan=0.0');
        } else if (fit === 'fill') {
            commonArgs.push('--keepaspect=yes', '--panscan=0.0');
        } else {
            commonArgs.push('--keepaspect=yes', '--panscan=1.0');
        }

        if (this.cfg.order === 'random' || this.cfg.order === 'shuffle') {
            commonArgs.push('--shuffle');
        }

        const speed = Number(this.cfg.playback_speed || 1.0);
        if (speed && speed !== 1.0) {
            commonArgs.push(`--speed=${speed.toFixed(2)}`);
        }

        for (let i = 0; i < targetMonitors.length; i++) {
            const mon = targetMonitors[i];
            const argv = [...commonArgs];
            if (mon.connector) {
                argv.push(`--fs-screen-name=${mon.connector}`);
            } else if (typeof mon.index === 'number') {
                argv.push(`--fs-screen=${mon.index}`);
            }

            let monitorFiles = playableFiles;
            if (this.cfg.multi_monitor !== 'mirror' && playableFiles.length > 1) {
                const offset = i % playableFiles.length;
                monitorFiles = [...playableFiles.slice(offset), ...playableFiles.slice(0, offset)];
            }
            argv.push(...monitorFiles);

            try {
                const launcher = new Gio.SubprocessLauncher({ flags: Gio.SubprocessFlags.NONE });
                const proc = launcher.spawnv(argv);
                this.processes.push(proc);

                proc.wait_check_async(null, () => {
                    if (this.running && !this.stopping) {
                        this.stop();
                    }
                });
            } catch (e) {}
        }

        return this.processes.length > 0;
    }

    stop() {
        if (!this.running && this.processes.length === 0) {
            try {
                GLib.spawn_command_line_async('pkill -f "title=fleet-signage"');
                GLib.spawn_command_line_async('pkill -f "signage-pool"');
            } catch (e) {}
            return;
        }
        this.stopping = true;
        this.running = false;

        for (const proc of this.processes) {
            try { proc.send_signal(15); } catch (e) {}
        }

        const toKill = [...this.processes];
        this.processes = [];

        GLib.timeout_add(GLib.PRIORITY_DEFAULT, 200, () => {
            for (const p of toKill) {
                try { p.send_signal(9); } catch (e) {}
            }
            try {
                GLib.spawn_command_line_async('pkill -f "title=fleet-signage"');
                GLib.spawn_command_line_async('pkill -f "signage-pool"');
            } catch (e) {}
            this.stopping = false;
            return GLib.SOURCE_REMOVE;
        });
    }

    getPlayableFiles() {
        const dirs = [DEFAULT_POOL_DIR, DEFAULT_CACHE_DIR];
        const files = [];
        const seen = new Set();

        for (const d of dirs) {
            const dir = Gio.File.new_for_path(d);
            if (!dir.query_exists(null)) continue;
            try {
                const enumerator = dir.enumerate_children('standard::name', Gio.FileQueryInfoFlags.NONE, null);
                let info;
                while ((info = enumerator.next_file(null)) !== null) {
                    const name = info.get_name();
                    if (name.startsWith('.')) continue;
                    const dot = name.lastIndexOf('.');
                    if (dot === -1) continue;
                    const ext = name.slice(dot).toLowerCase();
                    if (VIDEO_EXTENSIONS.has(ext) && !seen.has(name)) {
                        seen.add(name);
                        files.push(GLib.build_filenamev([d, name]));
                    }
                }
            } catch (e) {}
        }
        return files;
    }

    getMonitors() {
        const monitors = Main.layoutManager?.monitors || [];
        if (monitors.length === 0) return [{ connector: '', index: 0 }];
        return monitors.map((m, idx) => ({
            connector: m.connector || '',
            index: m.index ?? idx,
        }));
    }

    resolveVo() {
        if (this.cfg.vo && this.cfg.vo !== 'auto') return this.cfg.vo;
        try {
            const [ok, out] = GLib.spawn_command_line_sync('systemd-detect-virt');
            if (ok && out && new TextDecoder().decode(out).trim() !== 'none') {
                return 'wlshm';
            }
        } catch (e) {}
        return 'gpu';
    }

    resolveHwdec() {
        if (this.cfg.hwdec && this.cfg.hwdec !== 'auto') return this.cfg.hwdec;
        try {
            const [ok, out] = GLib.spawn_command_line_sync('systemd-detect-virt');
            if (ok && out && new TextDecoder().decode(out).trim() !== 'none') {
                return 'no';
            }
        } catch (e) {}
        return 'auto';
    }
}
