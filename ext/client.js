import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

export class DaemonClient {
    constructor() {
        this.proxy = null;
        this.initProxy();
    }

    initProxy() {
        try {
            this.proxy = Gio.DBusProxy.new_for_bus_sync(
                Gio.BusType.SYSTEM,
                Gio.DBusProxyFlags.NONE,
                null,
                'org.sylepsign.Daemon',
                '/org/sylepsign/Daemon',
                'org.sylepsign.Daemon',
                null
            );
        } catch (e) {
            try {
                this.proxy = Gio.DBusProxy.new_for_bus_sync(
                    Gio.BusType.SESSION,
                    Gio.DBusProxyFlags.NONE,
                    null,
                    'org.sylepsign.Daemon',
                    '/org/sylepsign/Daemon',
                    'org.sylepsign.Daemon',
                    null
                );
            } catch (_err) {
                this.proxy = null;
            }
        }
    }

    call(method, params = null, callback = null) {
        if (!this.proxy) this.initProxy();
        if (!this.proxy) {
            callback?.(null, new Error('Daemon unreachable'));
            return;
        }

        const variantParams = params ? new GLib.Variant('(' + params.map(() => 'v').join('') + ')', params) : null;
        this.proxy.call(
            method,
            variantParams,
            Gio.DBusCallFlags.NONE,
            -1,
            null,
            (p, res) => {
                try {
                    const resultVariant = p.call_finish(res);
                    const [jsonStr] = resultVariant.deep_unpack();
                    const parsed = JSON.parse(jsonStr);
                    callback?.(parsed, null);
                } catch (err) {
                    callback?.(null, err);
                }
            }
        );
    }

    getStatus(callback) {
        this.call('GetStatus', null, callback);
    }

    listVideos(callback) {
        this.call('ListVideos', null, callback);
    }

    checkUpdate(callback) {
        this.call('Update', null, callback);
    }

    update(callback) {
        this.call('Update', null, callback);
    }

    applyUpdate(callback) {
        this.call('Upgrade', null, callback);
    }

    upgrade(callback) {
        this.call('Upgrade', null, callback);
    }

    clearCache(callback) {
        this.call('Uncache', null, callback);
    }

    uncache(callback) {
        this.call('Uncache', null, callback);
    }

    setGdmEnabled(enabled, callback) {
        if (!this.proxy) this.initProxy();
        if (!this.proxy) {
            callback?.(null, new Error('Daemon unreachable'));
            return;
        }

        this.proxy.call(
            'SetGdmEnabled',
            new GLib.Variant('(b)', [enabled]),
            Gio.DBusCallFlags.NONE,
            -1,
            null,
            (p, res) => {
                try {
                    const resultVariant = p.call_finish(res);
                    const [jsonStr] = resultVariant.deep_unpack();
                    callback?.(JSON.parse(jsonStr), null);
                } catch (err) {
                    callback?.(null, err);
                }
            }
        );
    }
}
