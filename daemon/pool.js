import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

const VIDEO_EXTENSIONS = new Set(['.mp4', '.mkv', '.webm', '.mov', '.m4v']);
const DEFAULT_POOL_DIR = '/var/lib/signage-pool';
const DEFAULT_CACHE_DIR = '/var/cache/signage-videos';

export class PoolManager {
    constructor() {
        this.poolDir = DEFAULT_POOL_DIR;
        this.cacheDir = DEFAULT_CACHE_DIR;
        this.ensureDirectories();
    }

    ensureDirectories() {
        for (const dir of [this.poolDir, this.cacheDir]) {
            try {
                GLib.mkdir_with_parents(dir, 0o755);
            } catch (e) {
                // directory creation fallback
            }
        }
    }

    scanDirectory(dirPath, isPool = false) {
        const results = [];
        const dir = Gio.File.new_for_path(dirPath);
        if (!dir.query_exists(null)) return results;

        try {
            const enumerator = dir.enumerate_children(
                'standard::name,standard::size,time::modified',
                Gio.FileQueryInfoFlags.NONE,
                null
            );

            let info;
            while ((info = enumerator.next_file(null)) !== null) {
                const name = info.get_name();
                const dot = name.lastIndexOf('.');
                if (dot === -1) continue;
                const ext = name.slice(dot).toLowerCase();
                if (!VIDEO_EXTENSIONS.has(ext)) continue;

                results.push({
                    name,
                    path: GLib.build_filenamev([dirPath, name]),
                    size: info.get_size(),
                    mtime: info.get_modification_date_time()?.to_unix() ?? 0,
                    isPool,
                });
            }
        } catch (e) {
            // scan error handled
        }
        return results;
    }

    getAllVideos() {
        const poolVideos = this.scanDirectory(this.poolDir, true);
        const cacheVideos = this.scanDirectory(this.cacheDir, false);
        const seen = new Set();
        const combined = [];

        for (const video of [...poolVideos, ...cacheVideos]) {
            if (!seen.has(video.name)) {
                seen.add(video.name);
                combined.push(video);
            }
        }
        return combined;
    }

    getStats() {
        const poolVideos = this.scanDirectory(this.poolDir, true);
        const cacheVideos = this.scanDirectory(this.cacheDir, false);
        const poolBytes = poolVideos.reduce((sum, v) => sum + v.size, 0);
        const cacheBytes = cacheVideos.reduce((sum, v) => sum + v.size, 0);

        return {
            poolCount: poolVideos.length,
            poolBytes,
            cacheCount: cacheVideos.length,
            cacheBytes,
            totalVideos: poolVideos.length + cacheVideos.length,
        };
    }
}
