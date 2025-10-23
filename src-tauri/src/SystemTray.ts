import {SystemTray, SystemTrayIcon} from tauri;

export const systemTray = new SystemTray({
  icon: SystemTrayIcon.App,
  menu: [
    { label: 'Quit XBAR', id: 'quit' },
  ]
});