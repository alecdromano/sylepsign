import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import Soup from 'gi://Soup?version=3.0';

const MIME_MAP = {
    '.mp4': 'video/mp4',
    '.mkv': 'video/x-matroska',
    '.webm': 'video/webm',
    '.mov': 'video/quicktime',
    '.m4v': 'video/x-m4v',
};

export class MeshServer {
    constructor(poolManager, port = 8765) {
        this.pool = poolManager;
        this.port = port;
        this.server = null;
        this.listening = false;
    }

    start() {
        if (this.server) return;
        try {
            this.server = new Soup.Server();
            this.server.add_handler('/', (server, msg, path) => this.handleRequest(msg, path));
            this.server.listen_all(this.port, Soup.ServerListenOptions.NONE);
            this.listening = true;
        } catch (e) {
            this.listening = false;
        }
    }

    stop() {
        if (!this.server) return;
        this.server.disconnect_by_func?.(this.handleRequest);
        this.server = null;
        this.listening = false;
    }

    handleRequest(msg, path) {
        const method = msg.get_method();

        if (path === '/' || path === '/index.html') {
            this.serveListing(msg);
            return;
        }

        if (path === '/api/videos') {
            this.serveJsonListing(msg);
            return;
        }

        const filename = path.startsWith('/') ? path.slice(1) : path;
        if (filename.includes('/') || filename.includes('..') || filename.includes('\\')) {
            msg.set_status(400, null);
            return;
        }

        this.serveFile(msg, filename, method);
    }

    serveListing(msg) {
        const videos = this.pool.getAllVideos();
        let body = '<!DOCTYPE html><html><head><title>Sylepsign Mesh</title></head><body>';
        body += '<h1>Sylepsign Asset Mesh</h1><hr/><ul>';
        for (const v of videos) {
            body += `<li><a href="/${encodeURIComponent(v.name)}">${v.name}</a> (${v.size} bytes)</li>`;
        }
        body += '</ul></body></html>';

        msg.set_status(200, null);
        msg.get_response_headers().set_content_type('text/html; charset=utf-8', null);
        msg.get_response_body().append(body);
    }

    serveJsonListing(msg) {
        const videos = this.pool.getAllVideos();
        const json = JSON.stringify(videos);
        msg.set_status(200, null);
        msg.get_response_headers().set_content_type('application/json', null);
        msg.get_response_body().append(json);
    }

    serveFile(msg, filename, method) {
        const videos = this.pool.getAllVideos();
        const match = videos.find(v => v.name === filename);
        if (!match || !GLib.file_test(match.path, GLib.FileTest.EXISTS)) {
            msg.set_status(404, null);
            return;
        }

        try {
            const file = Gio.File.new_for_path(match.path);
            const queryInfo = file.query_info('standard::size', Gio.FileQueryInfoFlags.NONE, null);
            const size = queryInfo.get_size();

            const dot = filename.lastIndexOf('.');
            const ext = dot !== -1 ? filename.slice(dot).toLowerCase() : '';
            const contentType = MIME_MAP[ext] || 'application/octet-stream';

            msg.set_status(200, null);
            msg.get_response_headers().set_content_type(contentType, null);
            msg.get_response_headers().set_content_length(size);

            if (method === 'HEAD') return;

            const [bytes] = file.load_bytes(null);
            msg.get_response_body().append_bytes(bytes);
        } catch (e) {
            msg.set_status(500, null);
        }
    }
}
