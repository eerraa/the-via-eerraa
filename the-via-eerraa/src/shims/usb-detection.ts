type USBMonitorEvent = 'remove' | 'change';
export class usbDetect {
  static _listeners: {change: Function[]; remove: Function[]} = {
    change: [],
    remove: [],
  };
  static shouldMonitor = false;
  private static monitorNavigator: HID | undefined;
  static startMonitoring() {
    this.shouldMonitor = true;
    const hid = navigator.hid;
    if (!hid || this.monitorNavigator === hid) {
      return;
    }
    this.monitorNavigator?.removeEventListener('connect', usbDetect.onConnect);
    this.monitorNavigator?.removeEventListener(
      'disconnect',
      usbDetect.onDisconnect,
    );
    hid.addEventListener('connect', usbDetect.onConnect);
    hid.addEventListener('disconnect', usbDetect.onDisconnect);
    this.monitorNavigator = hid;
  }
  static stopMonitoring() {
    this.shouldMonitor = false;
  }
  private static onConnect = ({device}: HIDConnectionEvent) => {
    console.log('Detected Connection');
    if (usbDetect.shouldMonitor) {
      usbDetect._listeners.change.forEach((f) => f(device));
    }
  };
  private static onDisconnect = ({device}: HIDConnectionEvent) => {
    console.log('Detected Disconnection');
    if (usbDetect.shouldMonitor) {
      usbDetect._listeners.change.forEach((f) => f(device));
      usbDetect._listeners.remove.forEach((f) => f(device));
    }
  };
  static on(eventName: USBMonitorEvent, cb: () => void) {
    this._listeners[eventName] = [...this._listeners[eventName], cb];
  }
  static off(eventName: USBMonitorEvent, cb: () => void) {
    this._listeners[eventName] = this._listeners[eventName].filter(
      (f) => f !== cb,
    );
  }
}
