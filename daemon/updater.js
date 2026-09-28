import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Soup from 'gi://Soup?version=3.0';

export class UpdateManager {
    constructor(repo = 'alecdromano/sylepsign', branch = 'main') {
        this.repo = repo;
        this.branch = branch;
        this.session = new Soup.Session();
        this.currentVersion = this.readCurrentVersion();
    }

    readCurrentVersion() {
        const candidatePaths = [
            '/usr/local/share/gnome-shell/extensions/sylepsign@alecromano.com/metadata.json',
        ];
        try {
            const currentDir = Gio.File.new_for_uri(import.meta.url).get_parent();
            const repoMeta = currentDir.get_parent().get_child('ext').get_child('metadata.json');
            const repoPath = repoMeta.get_path();
            if (repoPath) candidatePaths.push(repoPath);
        } catch (_e) {}

        for (const metaPath of candidatePaths) {
            if (GLib.file_test(metaPath, GLib.FileTest.EXISTS)) {
                try {
                    const [ok, content] = GLib.file_get_contents(metaPath);
                    if (ok) {
                        const parsed = JSON.parse(new TextDecoder().decode(content));
                        if (parsed['version-name']) return parsed['version-name'];
                    }
                } catch (_e) {}
            }
        }
        return 'unknown';
    }

    fetchUrl(url, callback) {
        const msg = Soup.Message.new('GET', url);
        msg.get_request_headers().append('User-Agent', 'Sylepsign-Updater');
        this.session.send_and_read_async(msg, GLib.PRIORITY_DEFAULT, null, (s, res) => {
            try {
                const bytes = s.send_and_read_finish(res);
                const status = msg.get_status();
                const text = bytes ? new TextDecoder().decode(bytes.get_data()) : '';
                callback(status, text);
            } catch (_e) {
                callback(0, null);
            }
        });
    }

    checkForUpdate(callback) {
        this.fetchUrl(`https://api.github.com/repos/${this.repo}/releases/latest`, (status, text) => {
            if (status === 200 && text) {
                try {
                    const data = JSON.parse(text);
                    const latestVersion = (data.tag_name || '').replace(/^v/, '');
                    callback({
                        available: this.compareVersions(this.currentVersion, latestVersion) < 0,
                        currentVersion: this.currentVersion,
                        latestVersion: latestVersion || this.currentVersion,
                        url: data.html_url || `https://github.com/${this.repo}`,
                        notes: data.body || '',
                    });
                    return;
                } catch (_e) {}
            }

            if (status === 404) {
                this.fetchUrl(`https://api.github.com/repos/${this.repo}/tags`, (tStatus, tText) => {
                    if (tStatus === 200 && tText) {
                        try {
                            const tags = JSON.parse(tText);
                            if (Array.isArray(tags) && tags.length > 0) {
                                const latestTag = (tags[0].name || '').replace(/^v/, '');
                                callback({
                                    available: this.compareVersions(this.currentVersion, latestTag) < 0,
                                    currentVersion: this.currentVersion,
                                    latestVersion: latestTag || this.currentVersion,
                                    url: `https://github.com/${this.repo}`,
                                    notes: '',
                                });
                                return;
                            }
                        } catch (_e) {}
                    }
                    callback({
                        available: false,
                        currentVersion: this.currentVersion,
                        latestVersion: this.currentVersion,
                        error: 'No releases found on GitHub',
                    });
                });
                return;
            }

            callback({
                available: false,
                currentVersion: this.currentVersion,
                latestVersion: this.currentVersion,
                error: 'Could not connect to update server',
            });
        });
    }

    compareVersions(v1, v2) {
        const p1 = (v1 || '').split('.').map(x => parseInt(x, 10) || 0);
        const p2 = (v2 || '').split('.').map(x => parseInt(x, 10) || 0);
        const len = Math.max(p1.length, p2.length);

        for (let i = 0; i < len; i++) {
            const num1 = p1[i] || 0;
            const num2 = p2[i] || 0;
            if (num1 < num2) return -1;
            if (num1 > num2) return 1;
        }
        return 0;
    }

    applyUpdate(callback) {
        const updateScript = [
            'bash',
            '-c',
            [
                'set -e',
                'TMP="$(mktemp -d)"',
                'trap "rm -rf \'$TMP\'" EXIT',
                `URL="https://github.com/${this.repo}/releases/latest/download/sylepsign.tar.gz"`,
                'if curl -fsSL "$URL" -o "$TMP/sylepsign.tar.gz" 2>/dev/null; then',
                '  tar -xzf "$TMP/sylepsign.tar.gz" -C "$TMP"',
                '  cd "$TMP/sylepsign" && ./install.sh --update',
                'else',
                `  curl -fsSL "https://raw.githubusercontent.com/${this.repo}/${this.branch}/install.sh" | bash -s -- --update`,
                'fi',
            ].join('\n')
        ];

        try {
            const proc = new Gio.Subprocess({
                argv: updateScript,
                flags: Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_MERGE,
            });
            proc.init(null);

            proc.communicate_utf8_async(null, null, (p, res) => {
                try {
                    const [, stdout] = p.communicate_utf8_finish(res);
                    const success = p.get_successful();
                    callback({ success, output: stdout || '' });
                } catch (e) {
                    callback({ success: false, output: e.message });
                }
            });
        } catch (e) {
            callback({ success: false, output: e.message });
        }
    }
}
