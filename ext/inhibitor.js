import Gio from 'gi://Gio';

const INHIBIT_IDLE = 8;
const APP_ID = 'sylepsign@alecromano.com';
const REASON = 'Sylepsign video signage playing';

const SESSION_MANAGER_XML = `
<node>
    <interface name="org.gnome.SessionManager">
        <method name="Inhibit">
            <arg type="s" direction="in"/>
            <arg type="u" direction="in"/>
            <arg type="s" direction="in"/>
            <arg type="u" direction="in"/>
            <arg type="u" direction="out"/>
        </method>
        <method name="Uninhibit">
            <arg type="u" direction="in"/>
        </method>
    </interface>
</node>
`;

const SessionManagerProxy = Gio.DBusProxy.makeProxyWrapper(SESSION_MANAGER_XML);

export class Inhibitor {
    constructor() {
        this.proxy = null;
        this.cookie = 0;
        try {
            this.proxy = SessionManagerProxy(
                Gio.DBus.session,
                'org.gnome.SessionManager',
                '/org/gnome/SessionManager'
            );
        } catch (e) {
            this.proxy = null;
        }
    }

    acquire() {
        if (this.cookie !== 0 || !this.proxy) return;
        try {
            const [cookie] = this.proxy.InhibitSync(APP_ID, 0, REASON, INHIBIT_IDLE);
            this.cookie = cookie;
        } catch (e) {
            this.cookie = 0;
        }
    }

    release() {
        if (this.cookie === 0 || !this.proxy) return;
        const c = this.cookie;
        this.cookie = 0;
        try {
            this.proxy.UninhibitSync(c);
        } catch (e) {
            // release fallback
        }
    }
}
