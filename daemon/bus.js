import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

const INTROSPECTION_XML = `
<node>
    <interface name="org.sylepsign.Daemon">
        <method name="GetStatus">
            <arg type="s" direction="out" name="status"/>
        </method>
        <method name="ListVideos">
            <arg type="s" direction="out" name="videos"/>
        </method>
        <method name="CheckUpdate">
            <arg type="s" direction="out" name="update"/>
        </method>
        <method name="Update">
            <arg type="s" direction="out" name="update"/>
        </method>
        <method name="ApplyUpdate">
            <arg type="s" direction="out" name="result"/>
        </method>
        <method name="Upgrade">
            <arg type="s" direction="out" name="result"/>
        </method>
        <method name="ClearCache">
            <arg type="s" direction="out" name="result"/>
        </method>
        <method name="Uncache">
            <arg type="s" direction="out" name="result"/>
        </method>
        <method name="SetGdmEnabled">
            <arg type="b" direction="in" name="enabled"/>
            <arg type="s" direction="out" name="result"/>
        </method>
    </interface>
</node>
`;

export class BusService {
    constructor(daemon) {
        this.daemon = daemon;
        this.nodeInfo = Gio.DBusNodeInfo.new_for_xml(INTROSPECTION_XML);
        this.interfaceInfo = this.nodeInfo.interfaces[0];
        this.ownerId = 0;
        this.connection = null;
    }

    start() {
        this.ownerId = Gio.bus_own_name(
            Gio.BusType.SYSTEM,
            'org.sylepsign.Daemon',
            Gio.BusNameOwnerFlags.REPLACE,
            (conn) => this.onBusAcquired(conn),
            () => {},
            () => this.onNameLost()
        );
    }

    stop() {
        if (this.ownerId) {
            Gio.bus_unown_name(this.ownerId);
            this.ownerId = 0;
        }
    }

    onBusAcquired(conn) {
        this.connection = conn;
        conn.register_object(
            '/org/sylepsign/Daemon',
            this.interfaceInfo,
            (conn, sender, path, iface, method, params, invocation) => {
                this.handleMethod(method, params, invocation);
            },
            null,
            null
        );
    }

    onNameLost() {
        // Fallback to session bus for testing/unprivileged execution if system bus rejects
        if (!this.connection) {
            Gio.bus_own_name(
                Gio.BusType.SESSION,
                'org.sylepsign.Daemon',
                Gio.BusNameOwnerFlags.REPLACE,
                (conn) => this.onBusAcquired(conn),
                () => {},
                () => {}
            );
        }
    }

    handleMethod(method, params, invocation) {
        switch (method) {
            case 'GetStatus': {
                const status = this.daemon.getStatus();
                invocation.return_value(new GLib.Variant('(s)', [JSON.stringify(status)]));
                break;
            }
            case 'ListVideos': {
                const videos = this.daemon.pool.getAllVideos();
                invocation.return_value(new GLib.Variant('(s)', [JSON.stringify(videos)]));
                break;
            }
            case 'CheckUpdate':
            case 'Update': {
                this.daemon.updater.checkForUpdate(info => {
                    invocation.return_value(new GLib.Variant('(s)', [JSON.stringify(info)]));
                });
                break;
            }
            case 'ApplyUpdate':
            case 'Upgrade': {
                this.daemon.updater.applyUpdate(res => {
                    invocation.return_value(new GLib.Variant('(s)', [JSON.stringify(res)]));
                });
                break;
            }
            case 'ClearCache':
            case 'Uncache': {
                const count = this.daemon.admin.clearCache();
                const res = { success: true, cleared: count };
                invocation.return_value(new GLib.Variant('(s)', [JSON.stringify(res)]));
                break;
            }
            case 'SetGdmEnabled': {
                const [enabled] = params.deep_unpack();
                this.daemon.admin.setGdmEnabled(enabled, (ok, msg) => {
                    invocation.return_value(new GLib.Variant('(s)', [JSON.stringify({ success: ok, message: msg })]));
                });
                break;
            }
            default:
                invocation.return_error_literal(Gio.DBusError, Gio.DBusError.UNKNOWN_METHOD, 'Unknown method');
                break;
        }
    }
}
