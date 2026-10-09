import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

const DEFAULT_CACHE_DIR = '/var/cache/signage-videos';

export class AdminManager {
    constructor() {
        this.uuid = 'sylepsign@alecromano.com';
        this.gdmDir = '/etc/dconf/db/gdm.d';
        this.profileDir = '/etc/dconf/profile';
    }

    setGdmEnabled(enabled, callback) {
        try {
            GLib.mkdir_with_parents(this.gdmDir, 0o755);
            const confFile = `${this.gdmDir}/10-sylepsign`;
            const content = enabled
                ? `[org/gnome/shell]\nenabled-extensions=['${this.uuid}']\n\n[org/gnome/shell/extensions/sylepsign]\nenable-gdm-signage=true\nenabled=true\n`
                : `[org/gnome/shell]\nenabled-extensions=@as []\n\n[org/gnome/shell/extensions/sylepsign]\nenable-gdm-signage=false\nenabled=false\n`;

            GLib.file_set_contents(confFile, content);
            this.ensureDconfProfiles();
            if (!enabled) {
                try {
                    GLib.spawn_command_line_async('pkill -9 -f "title=fleet-signage"');
                    GLib.spawn_command_line_async('pkill -9 -f "signage-pool"');
                } catch (_e) {}
            }
            this.updateDconf(callback);
        } catch (e) {
            callback?.(false, e.message);
        }
    }

    ensureDconfProfiles() {
        GLib.mkdir_with_parents(this.profileDir, 0o755);
        for (const prof of ['gdm', 'Debian-gdm']) {
            const pfile = `${this.profileDir}/${prof}`;
            if (!GLib.file_test(pfile, GLib.FileTest.EXISTS)) {
                const defaultContent = 'user-db:user\nsystem-db:gdm\nfile-db:/var/lib/gdm3/greeter-dconf-defaults\n';
                GLib.file_set_contents(pfile, defaultContent);
            } else {
                const [ok, bytes] = GLib.file_get_contents(pfile);
                if (ok) {
                    const text = new TextDecoder().decode(bytes);
                    if (!text.includes('system-db:gdm')) {
                        GLib.file_set_contents(pfile, `${text}\nsystem-db:gdm\n`);
                    }
                }
            }
        }
    }

    updateDconf(callback) {
        try {
            const proc = new Gio.Subprocess({
                argv: ['dconf', 'update'],
                flags: Gio.SubprocessFlags.NONE,
            });
            proc.init(null);
            proc.wait_async(null, (p, res) => {
                const ok = p.get_successful();
                callback?.(ok, ok ? 'dconf updated' : 'dconf update failed');
            });
        } catch (e) {
            callback?.(false, e.message);
        }
    }

    clearCache() {
        const dir = Gio.File.new_for_path(DEFAULT_CACHE_DIR);
        if (!dir.query_exists(null)) return 0;

        let count = 0;
        try {
            const enumerator = dir.enumerate_children('standard::name', Gio.FileQueryInfoFlags.NONE, null);
            let info;
            while ((info = enumerator.next_file(null)) !== null) {
                const child = dir.get_child(info.get_name());
                child.delete(null);
                count++;
            }
        } catch (e) {
            // cleanup error
        }
        return count;
    }
}
