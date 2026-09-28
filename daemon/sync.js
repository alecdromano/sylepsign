import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Soup from 'gi://Soup?version=3.0';

export class AssetSync {
    constructor(poolManager, mdnsManager, intervalSeconds = 60) {
        this.pool = poolManager;
        this.mdns = mdnsManager;
        this.interval = intervalSeconds;
        this.timerId = 0;
        this.syncing = false;
        this.session = null;
    }

    start() {
        if (this.timerId) return;
        this.session = new Soup.Session();
        this.syncCycle();
        this.timerId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, this.interval, () => {
            this.syncCycle();
            return GLib.SOURCE_CONTINUE;
        });
    }

    stop() {
        if (this.timerId) {
            GLib.source_remove(this.timerId);
            this.timerId = 0;
        }
        if (this.session) {
            this.session.abort();
            this.session = null;
        }
    }

    syncCycle() {
        if (this.syncing) return;
        this.syncing = true;

        this.mdns.discoverPeers(peers => {
            if (!peers || peers.length === 0) {
                this.syncing = false;
                return;
            }
            this.queryPeersSequentially(peers, 0);
        });
    }

    queryPeersSequentially(peers, index) {
        if (index >= peers.length) {
            this.syncing = false;
            return;
        }

        const peer = peers[index];
        const uri = `http://${peer.ip}:${peer.port}/api/videos`;
        const msg = Soup.Message.new('GET', uri);

        this.session.send_and_read_async(msg, GLib.PRIORITY_DEFAULT, null, (s, res) => {
            try {
                const bytes = s.send_and_read_finish(res);
                if (msg.get_status() === 200 && bytes) {
                    const text = new TextDecoder().decode(bytes.get_data());
                    const remoteVideos = JSON.parse(text);
                    this.reconcileMissingVideos(peer, remoteVideos, () => {
                        this.queryPeersSequentially(peers, index + 1);
                    });
                    return;
                }
            } catch (e) {
                // peer query error
            }
            this.queryPeersSequentially(peers, index + 1);
        });
    }

    reconcileMissingVideos(peer, remoteVideos, doneCallback) {
        const localVideos = this.pool.getAllVideos();
        const localNames = new Set(localVideos.map(v => v.name));
        const missing = remoteVideos.filter(v => !localNames.has(v.name));

        if (missing.length === 0) {
            doneCallback();
            return;
        }

        // Trickle download one video at a time to prevent bandwidth saturation
        const target = missing[0];
        this.downloadVideo(peer, target.name, doneCallback);
    }

    downloadVideo(peer, filename, callback) {
        const url = `http://${peer.ip}:${peer.port}/${encodeURIComponent(filename)}`;
        const targetPath = GLib.build_filenamev([this.pool.cacheDir, filename]);
        const tempPath = `${targetPath}.tmp-${Date.now()}`;

        const msg = Soup.Message.new('GET', url);
        this.session.send_and_read_async(msg, GLib.PRIORITY_LOW, null, (s, res) => {
            try {
                const bytes = s.send_and_read_finish(res);
                if (msg.get_status() === 200 && bytes) {
                    const tmpFile = Gio.File.new_for_path(tempPath);
                    tmpFile.replace_contents(
                        bytes.get_data(),
                        null,
                        false,
                        Gio.FileCreateFlags.REPLACE_DESTINATION,
                        null
                    );
                    const destFile = Gio.File.new_for_path(targetPath);
                    tmpFile.move(destFile, Gio.FileCopyFlags.OVERWRITE, null, null);
                }
            } catch (e) {
                try {
                    Gio.File.new_for_path(tempPath).delete(null);
                } catch (_err) {}
            }
            callback();
        });
    }
}
