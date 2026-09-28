import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

export class MdnsManager {
    constructor(port = 8765, serviceType = '_signage-pool._tcp') {
        this.port = port;
        this.serviceType = serviceType;
        this.publishProc = null;
        this.peers = [];
    }

    startPublishing() {
        if (this.publishProc) return;
        const hostname = GLib.get_host_name();
        const serviceName = `Sylepsign-${hostname}`;

        try {
            this.publishProc = new Gio.Subprocess({
                argv: ['avahi-publish-service', serviceName, this.serviceType, String(this.port)],
                flags: Gio.SubprocessFlags.NONE,
            });
            this.publishProc.init(null);
        } catch (e) {
            this.publishProc = null;
        }
    }

    stopPublishing() {
        if (!this.publishProc) return;
        try {
            this.publishProc.force_exit();
        } catch (e) {
            // proc exited
        }
        this.publishProc = null;
    }

    discoverPeers(callback) {
        try {
            const proc = new Gio.Subprocess({
                argv: ['avahi-browse', '-r', '-p', '-t', this.serviceType],
                flags: Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_SILENCE,
            });
            proc.init(null);

            proc.communicate_utf8_async(null, null, (p, res) => {
                try {
                    const [, stdout] = p.communicate_utf8_finish(res);
                    const discovered = this.parseAvahiOutput(stdout || '');
                    this.peers = discovered;
                    callback?.(discovered);
                } catch (e) {
                    callback?.([]);
                }
            });
        } catch (e) {
            callback?.([]);
        }
    }

    parseAvahiOutput(output) {
        const peers = [];
        const lines = output.split('\n');
        const selfHost = GLib.get_host_name().toLowerCase();

        for (const line of lines) {
            if (!line.startsWith('=')) continue;
            const parts = line.split(';');
            if (parts.length < 9) continue;

            const hostname = (parts[6] || '').trim();
            const ip = (parts[7] || '').trim();
            const port = parseInt(parts[8], 10);

            if (!ip || isNaN(port)) continue;
            if (hostname.toLowerCase().startsWith(selfHost)) continue;

            const exists = peers.some(p => p.ip === ip && p.port === port);
            if (!exists) {
                peers.push({ hostname, ip, port });
            }
        }
        return peers;
    }
}
