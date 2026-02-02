import { Menu, shell, app } from 'electron'

export function buildAppMenu(handlers: {
  onCheckForUpdates: () => void
  onOpenSettings: () => void
}): Menu {
  const template: Electron.MenuItemConstructorOptions[] = [
    {
      label: app.name,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        {
          label: 'Check for Updates...',
          click: () => handlers.onCheckForUpdates(),
        },
        {
          label: 'Settings...',
          accelerator: 'CmdOrCtrl+,',
          click: () => handlers.onOpenSettings(),
        },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    { role: 'editMenu' },
    { role: 'viewMenu' },
    { role: 'windowMenu' },
    {
      role: 'help',
      submenu: [
        {
          label: 'tcpwatch on GitHub',
          click: () => {
            shell.openExternal('https://github.com/bbmorten/morzer')
          },
        },
      ],
    },
  ]

  return Menu.buildFromTemplate(template)
}
