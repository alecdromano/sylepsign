import GLib from 'gi://GLib';
import GLibUnix from 'gi://GLibUnix';
import { PoolManager } from './pool.js';
import { MeshServer } from './server.js';
import { MdnsManager } from './mdns.js';
import { AssetSync } from './sync.js';
import { UpdateManager } from './updater.js';
import { AdminManager } from './admin.js';
import { BusService } from './bus.js';

export class SylepsignDaemon {
    constructor() {
        this.pool = new PoolManager();
        this.server = new MeshServer(this.pool);
        this.mdns = new MdnsManager();
        this.sync = new AssetSync(this.pool, this.mdns);
        this.updater = new UpdateManager();
        this.admin = new AdminManager();
        this.bus = new BusService(this);
        this.loop = null;
    }

    start() {
        this.server.start();
        this.mdns.startPublishing();
        this.sync.start();
        this.bus.start();

        this.loop = new GLib.MainLoop(null, false);
        this.setupSignals();
        this.loop.run();
    }

    stop() {
        this.sync.stop();
        this.mdns.stopPublishing();
        this.server.stop();
        this.bus.stop();
        if (this.loop && this.loop.is_running()) {
            this.loop.quit();
        }
    }

    setupSignals() {
        const signalAdd = GLibUnix?.signal_add || GLib.unix_signal_add;
        signalAdd(GLib.PRIORITY_HIGH, 15, () => {
            this.stop();
            return GLib.SOURCE_REMOVE;
        });
        signalAdd(GLib.PRIORITY_HIGH, 2, () => {
            this.stop();
            return GLib.SOURCE_REMOVE;
        });
    }

    getStatus() {
        const stats = this.pool.getStats();
        return {
            daemon: 'running',
            version: this.updater.currentVersion,
            serverListening: this.server.listening,
            port: this.server.port,
            peers: this.mdns.peers.length,
            poolVideos: stats.poolCount,
            cacheVideos: stats.cacheCount,
            totalBytes: stats.poolBytes + stats.cacheBytes,
        };
    }
}

const daemon = new SylepsignDaemon();
daemon.start();
